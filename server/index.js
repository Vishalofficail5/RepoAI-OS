import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerRepositoryQuestion } from './ai.js';
import { createAuth } from './auth.js';
import { loadEnvironment } from './env.js';
import { clonePublicGitHubRepository, parseGitHubRepositoryUrl } from './github.js';
import { generateRepositoryDocumentation } from './documentation.js';
import { getDatabase, mongoConfigured } from './db.js';
import { analyzeGitImpact, analyzeRepository } from './repository.js';
import { scanRepositorySecurity } from './security.js';
import { loadInvestigations, loadMcpTokens, loadRepositories, loadSessions, saveInvestigations, saveMcpTokens, saveSessions, upsertRepository, upsertUser } from './store.js';

const rootDirectory = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
await loadEnvironment(rootDirectory);
const repositoryRoot = await realpath(path.resolve(process.env.REPOAI_REPOSITORY_ROOT ?? rootDirectory));
const cloneDirectory = path.join(rootDirectory, '.repoai-data', 'clones');
const port = Number(process.env.PORT ?? 3000);
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.jfif': 'image/jpeg', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
let repositories = await loadRepositories();
let investigations = await loadInvestigations();
let mcpTokens = await loadMcpTokens();
const rateLimits = new Map();
const auth = createAuth({
  loadSessions,
  saveSessions,
  saveUser: upsertUser,
  baseUrl: process.env.REPOAI_BASE_URL ?? `http://localhost:${port}`
});

function send(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(body));
}

function redirect(response, location, headers = {}) {
  response.writeHead(302, { location, ...headers });
  response.end();
}

function requestError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function enforceRateLimit(request, category, limit, windowMs) {
  const identifier = request.user?.id ?? request.socket.remoteAddress ?? 'unknown';
  const key = `${category}:${identifier}`;
  const now = Date.now();
  if (rateLimits.size > 10000) {
    for (const [entryKey, entryTimes] of rateLimits) {
      if (!entryTimes.some((time) => time > now - 60 * 60 * 1000)) rateLimits.delete(entryKey);
    }
  }
  const entries = (rateLimits.get(key) ?? []).filter((time) => time > now - windowMs);
  if (entries.length >= limit) throw requestError('Too many requests. Please try again later.', 429);
  entries.push(now);
  rateLimits.set(key, entries);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw requestError('Request body exceeds 1 MB', 413);
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw requestError('Request body must contain valid JSON', 400);
  }
}

function repositorySummary(repository) {
  return { id: repository.id, name: repository.name, relativePath: repository.relativePath, sourceUrl: repository.sourceUrl, analyzedAt: repository.analyzedAt, fingerprint: repository.fingerprint, summary: repository.summary, branch: repository.git.branch ?? 'not a git repository' };
}

function userRepositories(user) {
  return repositories.filter((repository) => repository.ownerId === user.id);
}

function findRepository(id, user) {
  return userRepositories(user).find((repository) => repository.id === id);
}

function githubOAuthConfigured() {
  return Boolean(process.env.SESSION_SECRET && process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

function visibleRepository(repository) {
  const { ownerId, ...data } = repository;
  return data;
}

function tokenDigest(token) {
  return createHash('sha256').update(token).digest('hex');
}

function mcpUser(request) {
  const token = (request.headers.authorization ?? '').match(/^Bearer\s+(repoai_[\w-]+)$/i)?.[1];
  if (!token) return null;
  const record = mcpTokens.find((item) => item.digest === tokenDigest(token) && Date.parse(item.expiresAt) > Date.now());
  return record ? { id: record.ownerId, provider: 'mcp', name: 'MCP client', avatarUrl: null } : null;
}

async function requireRepositoryAccess(request, response) {
  const session = await auth.getSession(request);
  if (session) {
    request.user = session.user;
    return session;
  }
  const user = mcpUser(request);
  if (user) {
    request.user = user;
    return { user };
  }
  response.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: 'Authentication is required' }));
  return null;
}

async function allowedRepositoryPath(inputPath) {
  const resolvedPath = path.resolve(inputPath);
  const prefix = `${repositoryRoot}${path.sep}`;
  if (resolvedPath !== repositoryRoot && !resolvedPath.startsWith(prefix)) throw new Error('Repository path is outside REPOAI_REPOSITORY_ROOT');
  const resolvedRealPath = await realpath(resolvedPath);
  if (resolvedRealPath !== repositoryRoot && !resolvedRealPath.startsWith(prefix)) throw new Error('Repository path is outside REPOAI_REPOSITORY_ROOT');
  return resolvedRealPath;
}

async function serveStatic(request, response) {
  const urlPath = request.url === '/' ? '/index.html' : request.url.split('?')[0];
  const targetPath = path.resolve(rootDirectory, `.${urlPath}`);
  if (!targetPath.startsWith(`${rootDirectory}${path.sep}`)) return send(response, 403, { error: 'Forbidden' });
  try {
    const details = await stat(targetPath);
    if (!details.isFile()) throw new Error('Not a file');
    response.writeHead(200, { 'content-type': mimeTypes[path.extname(targetPath)] ?? 'application/octet-stream' });
    response.end(await readFile(targetPath));
  } catch {
    send(response, 404, { error: 'Not found' });
  }
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? `localhost:${port}`}`);
    const { pathname } = requestUrl;
    if (request.method === 'GET' && pathname === '/auth/github') {
      enforceRateLimit(request, 'oauth-start', 20, 60 * 60 * 1000);
      try {
        const result = await auth.beginOAuth(pathname.split('/').at(-1));
        return redirect(response, result.location, result.headers);
      } catch (error) {
        return redirect(response, `/?auth_error=${encodeURIComponent(error.message)}`);
      }
    }
    if (request.method === 'GET' && pathname === '/auth/github/callback') {
      enforceRateLimit(request, 'oauth-callback', 20, 60 * 60 * 1000);
      try {
        const result = await auth.completeOAuth(pathname.split('/')[2], requestUrl.searchParams, request.headers.cookie);
        return redirect(response, '/', result.headers);
      } catch (error) {
        return redirect(response, `/?auth_error=${encodeURIComponent(error.message)}`);
      }
    }
    if (request.method === 'POST' && pathname === '/auth/logout') {
      enforceRateLimit(request, 'logout', 30, 60 * 60 * 1000);
      const result = await auth.logout(request);
      return send(response, 200, { ok: true }, result.headers);
    }
    if (request.method === 'GET' && pathname === '/api/session') {
      enforceRateLimit(request, 'session', 120, 60 * 1000);
      const session = await auth.getSession(request);
      return send(response, 200, { user: session?.user ?? null });
    }
    if (request.method === 'GET' && pathname === '/api/auth/providers') {
      enforceRateLimit(request, 'auth-providers', 60, 60 * 1000);
      return send(response, 200, { github: githubOAuthConfigured() });
    }
    if (request.method === 'POST' && pathname === '/api/mcp/tokens') {
      const session = await auth.requireSession(request, response);
      if (!session) return;
      enforceRateLimit(request, 'mcp-token', 5, 60 * 60 * 1000);
      const token = `repoai_${randomBytes(32).toString('base64url')}`;
      const record = { id: randomUUID(), ownerId: request.user.id, digest: tokenDigest(token), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() };
      mcpTokens = [...mcpTokens.filter((item) => Date.parse(item.expiresAt) > Date.now()), record];
      await saveMcpTokens(mcpTokens);
      return send(response, 201, { token, expiresAt: record.expiresAt });
    }
    if (request.method === 'GET' && pathname === '/api/mcp/tokens') {
      const session = await auth.requireSession(request, response);
      if (!session) return;
      return send(response, 200, { tokens: mcpTokens.filter((item) => item.ownerId === request.user.id && Date.parse(item.expiresAt) > Date.now()).map(({ digest, ownerId, ...token }) => token) });
    }
    const mcpTokenMatch = pathname.match(/^\/api\/mcp\/tokens\/([^/]+)$/);
    if (request.method === 'DELETE' && mcpTokenMatch) {
      const session = await auth.requireSession(request, response);
      if (!session) return;
      const token = mcpTokens.find((item) => item.id === mcpTokenMatch[1] && item.ownerId === request.user.id);
      if (!token) return send(response, 404, { error: 'MCP token not found' });
      mcpTokens = mcpTokens.filter((item) => item.id !== token.id);
      await saveMcpTokens(mcpTokens);
      return send(response, 200, { ok: true });
    }
    if (pathname.startsWith('/api/repositories')) {
      const session = await requireRepositoryAccess(request, response);
      if (!session) return;
    }
    if (request.method === 'GET' && pathname === '/api/health') {
      enforceRateLimit(request, 'health', 120, 60 * 1000);
      return send(response, 200, { status: 'ok', repositoryCount: repositories.length, storage: mongoConfigured() ? 'mongodb' : 'local-json', openaiConfigured: process.env.REPOAI_OPENAI_ENABLED === 'true' && Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) });
    }
    if (request.method === 'GET' && pathname === '/api/ready') {
      enforceRateLimit(request, 'ready', 120, 60 * 1000);
      try {
        if (mongoConfigured()) await getDatabase();
        return send(response, 200, { status: 'ready' });
      } catch {
        return send(response, 503, { status: 'unavailable' });
      }
    }
    if (request.method === 'GET' && pathname === '/api/repositories') return send(response, 200, { repositories: userRepositories(request.user).map(repositorySummary) });
    if (request.method === 'POST' && pathname === '/api/repositories') {
      enforceRateLimit(request, 'repository-analysis', 10, 60 * 60 * 1000);
      const body = await readJson(request);
      if (!body.path?.trim()) return send(response, 400, { error: 'Enter a local repository path or a public GitHub repository URL' });
      const githubRepository = parseGitHubRepositoryUrl(body.path.trim());
      const sourcePath = githubRepository ? await clonePublicGitHubRepository(githubRepository, cloneDirectory) : await allowedRepositoryPath(body.path);
      const repository = await analyzeRepository(sourcePath, body.name || githubRepository?.name);
      repository.sourceUrl = githubRepository?.url;
      repository.ownerId = request.user.id;
      const savedRepository = await upsertRepository(repository);
      repositories = [...repositories.filter((item) => item.ownerId !== request.user.id || item.path !== savedRepository.path), savedRepository];
      return send(response, 201, { repository: repositorySummary(savedRepository) });
    }
    const match = pathname.match(/^\/api\/repositories\/([^/]+)(?:\/(search|investigations|refresh|impact|security|documentation))?$/);
    if (match) {
      const repository = findRepository(match[1], request.user);
      if (!repository) return send(response, 404, { error: 'Repository not found' });
      if (request.method === 'GET' && !match[2]) return send(response, 200, { repository: visibleRepository(repository) });
      if (request.method === 'POST' && match[2] === 'search') {
        enforceRateLimit(request, 'repository-search', 60, 60 * 1000);
        const body = await readJson(request);
        if (!body.question?.trim()) return send(response, 400, { error: 'A question is required' });
        return send(response, 200, await answerRepositoryQuestion(repository, body.question.trim()));
      }
      if (request.method === 'POST' && match[2] === 'investigations') {
        enforceRateLimit(request, 'repository-investigation', 20, 60 * 60 * 1000);
        const body = await readJson(request);
        const question = body.question?.trim() || 'What changed recently and what is affected?';
        const analysis = await answerRepositoryQuestion(repository, question);
        const investigation = { id: randomUUID(), repositoryId: repository.id, ownerId: request.user.id, title: question, likelyRootCause: analysis.answer, confidence: analysis.confidence, evidence: analysis.evidence, commits: repository.git.commits.slice(0, 5), createdAt: new Date().toISOString() };
        investigations = [investigation, ...investigations.filter((item) => item.repositoryId !== repository.id || item.ownerId !== request.user.id)].slice(0, 200);
        await saveInvestigations(investigations);
        return send(response, 201, { investigation: visibleRepository(investigation) });
      }
      if (request.method === 'GET' && match[2] === 'investigations') return send(response, 200, { investigations: investigations.filter((item) => item.repositoryId === repository.id && item.ownerId === request.user.id).map(visibleRepository) });
      if (request.method === 'POST' && match[2] === 'impact') {
        enforceRateLimit(request, 'repository-impact', 30, 60 * 60 * 1000);
        const body = await readJson(request);
        return send(response, 200, { impact: analyzeGitImpact(repository, body.baseReference || 'HEAD~1', body.headReference || 'HEAD') });
      }
      if ((request.method === 'GET' || request.method === 'POST') && match[2] === 'security') {
        enforceRateLimit(request, 'repository-security', 30, 60 * 60 * 1000);
        return send(response, 200, { scan: scanRepositorySecurity(repository) });
      }
      if ((request.method === 'GET' || request.method === 'POST') && match[2] === 'documentation') {
        enforceRateLimit(request, 'repository-documentation', 30, 60 * 60 * 1000);
        return send(response, 200, { documents: generateRepositoryDocumentation(repository) });
      }
      if (request.method === 'POST' && match[2] === 'refresh') {
        enforceRateLimit(request, 'repository-refresh', 10, 60 * 60 * 1000);
        const refreshed = await analyzeRepository(repository.path, repository.name);
        refreshed.id = repository.id;
        refreshed.ownerId = repository.ownerId;
        refreshed.sourceUrl = repository.sourceUrl;
        const savedRepository = await upsertRepository(refreshed);
        repositories = repositories.map((item) => item.id === repository.id && item.ownerId === request.user.id ? savedRepository : item);
        return send(response, 200, { repository: repositorySummary(savedRepository) });
      }
    }
    return serveStatic(request, response);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', method: request.method, path: request.url?.split('?')[0], status: error.status ?? 400, message: error.message }));
    return send(response, error.status ?? 400, { error: error.message });
  }
});

server.listen(port, () => console.log(`RepoAI running at http://localhost:${port}`));

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
