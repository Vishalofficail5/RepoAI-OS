import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerRepositoryQuestion } from './ai.js';
import { createAuth } from './auth.js';
import { loadEnvironment } from './env.js';
import { clonePublicGitHubRepository, parseGitHubRepositoryUrl } from './github.js';
import { generateRepositoryDocumentation } from './documentation.js';
import { mongoConfigured } from './db.js';
import { analyzeGitImpact, analyzeRepository } from './repository.js';
import { scanRepositorySecurity } from './security.js';
import { loadInvestigations, loadMcpTokens, loadRepositories, loadSessions, saveInvestigations, saveMcpTokens, saveRepositories, saveSessions, upsertUser } from './store.js';

const rootDirectory = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
await loadEnvironment(rootDirectory);
const repositoryRoot = path.resolve(process.env.REPOAI_REPOSITORY_ROOT ?? rootDirectory);
const cloneDirectory = path.join(rootDirectory, '.repoai-data', 'clones');
const port = Number(process.env.PORT ?? 3000);
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
let repositories = await loadRepositories();
let investigations = await loadInvestigations();
let mcpTokens = await loadMcpTokens();
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

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
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

function allowedRepositoryPath(inputPath) {
  const resolvedPath = path.resolve(inputPath);
  const prefix = `${repositoryRoot}${path.sep}`;
  if (resolvedPath !== repositoryRoot && !resolvedPath.startsWith(prefix)) throw new Error('Repository path is outside REPOAI_REPOSITORY_ROOT');
  return resolvedPath;
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
      try {
        const result = await auth.beginOAuth(pathname.split('/').at(-1));
        return redirect(response, result.location, result.headers);
      } catch (error) {
        return redirect(response, `/?auth_error=${encodeURIComponent(error.message)}`);
      }
    }
    if (request.method === 'GET' && pathname === '/auth/github/callback') {
      try {
        const result = await auth.completeOAuth(pathname.split('/')[2], requestUrl.searchParams, request.headers.cookie);
        return redirect(response, '/', result.headers);
      } catch (error) {
        return redirect(response, `/?auth_error=${encodeURIComponent(error.message)}`);
      }
    }
    if (request.method === 'POST' && pathname === '/auth/logout') {
      const result = await auth.logout(request);
      return send(response, 200, { ok: true }, result.headers);
    }
    if (request.method === 'GET' && pathname === '/api/session') {
      const session = await auth.getSession(request);
      return send(response, 200, { user: session?.user ?? null });
    }
    if (request.method === 'GET' && pathname === '/api/auth/providers') {
      return send(response, 200, { github: githubOAuthConfigured() });
    }
    if (request.method === 'POST' && pathname === '/api/mcp/tokens') {
      const session = await auth.requireSession(request, response);
      if (!session) return;
      const token = `repoai_${randomBytes(32).toString('base64url')}`;
      const record = { id: randomUUID(), ownerId: request.user.id, digest: tokenDigest(token), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() };
      mcpTokens = [...mcpTokens.filter((item) => item.ownerId !== record.ownerId || Date.parse(item.expiresAt) > Date.now()), record];
      await saveMcpTokens(mcpTokens);
      return send(response, 201, { token, expiresAt: record.expiresAt });
    }
    if (pathname.startsWith('/api/repositories')) {
      const session = await requireRepositoryAccess(request, response);
      if (!session) return;
    }
    if (request.method === 'GET' && pathname === '/api/health') return send(response, 200, { status: 'ok', repositoryCount: repositories.length, storage: mongoConfigured() ? 'mongodb' : 'local-json', openaiConfigured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) });
    if (request.method === 'GET' && pathname === '/api/repositories') return send(response, 200, { repositories: userRepositories(request.user).map(repositorySummary) });
    if (request.method === 'POST' && pathname === '/api/repositories') {
      const body = await readJson(request);
      if (!body.path?.trim()) return send(response, 400, { error: 'Enter a local repository path or a public GitHub repository URL' });
      const githubRepository = parseGitHubRepositoryUrl(body.path.trim());
      const sourcePath = githubRepository ? await clonePublicGitHubRepository(githubRepository, cloneDirectory) : allowedRepositoryPath(body.path);
      const repository = await analyzeRepository(sourcePath, body.name || githubRepository?.name);
      repository.sourceUrl = githubRepository?.url;
      repository.ownerId = request.user.id;
      repositories = [...repositories.filter((item) => item.ownerId !== request.user.id || item.path !== repository.path), repository];
      await saveRepositories(repositories);
      return send(response, 201, { repository: repositorySummary(repository) });
    }
    const match = pathname.match(/^\/api\/repositories\/([^/]+)(?:\/(search|investigations|refresh|impact|security|documentation))?$/);
    if (match) {
      const repository = findRepository(match[1], request.user);
      if (!repository) return send(response, 404, { error: 'Repository not found' });
      if (request.method === 'GET' && !match[2]) return send(response, 200, { repository: visibleRepository(repository) });
      if (request.method === 'POST' && match[2] === 'search') {
        const body = await readJson(request);
        if (!body.question?.trim()) return send(response, 400, { error: 'A question is required' });
        return send(response, 200, await answerRepositoryQuestion(repository, body.question.trim()));
      }
      if (request.method === 'POST' && match[2] === 'investigations') {
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
        const body = await readJson(request);
        return send(response, 200, { impact: analyzeGitImpact(repository, body.baseReference || 'HEAD~1', body.headReference || 'HEAD') });
      }
      if ((request.method === 'GET' || request.method === 'POST') && match[2] === 'security') return send(response, 200, { scan: scanRepositorySecurity(repository) });
      if ((request.method === 'GET' || request.method === 'POST') && match[2] === 'documentation') return send(response, 200, { documents: generateRepositoryDocumentation(repository) });
      if (request.method === 'POST' && match[2] === 'refresh') {
        const refreshed = await analyzeRepository(repository.path, repository.name);
        refreshed.id = repository.id;
        refreshed.ownerId = repository.ownerId;
        refreshed.sourceUrl = repository.sourceUrl;
        repositories = repositories.map((item) => item.id === repository.id && item.ownerId === request.user.id ? refreshed : item);
        await saveRepositories(repositories);
        return send(response, 200, { repository: repositorySummary(refreshed) });
      }
    }
    return serveStatic(request, response);
  } catch (error) {
    return send(response, error.status ?? 400, { error: error.message });
  }
});

server.listen(port, () => console.log(`RepoAI running at http://localhost:${port}`));
