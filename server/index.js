import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerRepositoryQuestion } from './ai.js';
import { loadEnvironment } from './env.js';
import { clonePublicGitHubRepository, parseGitHubRepositoryUrl } from './github.js';
import { analyzeRepository } from './repository.js';
import { loadRepositories, saveRepositories } from './store.js';

const rootDirectory = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
await loadEnvironment(rootDirectory);
const repositoryRoot = path.resolve(process.env.REPOAI_REPOSITORY_ROOT ?? rootDirectory);
const cloneDirectory = path.join(rootDirectory, '.repoai-data', 'clones');
const port = Number(process.env.PORT ?? 3000);
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
let repositories = await loadRepositories();

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
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

function findRepository(id) {
  return repositories.find((repository) => repository.id === id);
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
    const pathname = request.url?.split('?')[0] ?? '/';
    if (request.method === 'GET' && pathname === '/api/health') return send(response, 200, { status: 'ok', repositoryCount: repositories.length, openaiConfigured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) });
    if (request.method === 'GET' && pathname === '/api/repositories') return send(response, 200, { repositories: repositories.map(repositorySummary) });
    if (request.method === 'POST' && pathname === '/api/repositories') {
      const body = await readJson(request);
      if (!body.path?.trim()) return send(response, 400, { error: 'Enter a local repository path or a public GitHub repository URL' });
      const githubRepository = parseGitHubRepositoryUrl(body.path.trim());
      const sourcePath = githubRepository ? await clonePublicGitHubRepository(githubRepository, cloneDirectory) : allowedRepositoryPath(body.path);
      const repository = await analyzeRepository(sourcePath, body.name || githubRepository?.name);
      repository.sourceUrl = githubRepository?.url;
      repositories = [...repositories.filter((item) => item.path !== repository.path), repository];
      await saveRepositories(repositories);
      return send(response, 201, { repository: repositorySummary(repository) });
    }
    const match = pathname.match(/^\/api\/repositories\/([^/]+)(?:\/(search|investigations|refresh))?$/);
    if (match) {
      const repository = findRepository(match[1]);
      if (!repository) return send(response, 404, { error: 'Repository not found' });
      if (request.method === 'GET' && !match[2]) return send(response, 200, { repository });
      if (request.method === 'POST' && match[2] === 'search') {
        const body = await readJson(request);
        if (!body.question?.trim()) return send(response, 400, { error: 'A question is required' });
        return send(response, 200, await answerRepositoryQuestion(repository, body.question.trim()));
      }
      if (request.method === 'POST' && match[2] === 'investigations') {
        const body = await readJson(request);
        const question = body.question?.trim() || 'What changed recently and what is affected?';
        const analysis = await answerRepositoryQuestion(repository, question);
        return send(response, 200, { title: question, likelyRootCause: analysis.answer, confidence: analysis.confidence, evidence: analysis.evidence, commits: repository.git.commits.slice(0, 5) });
      }
      if (request.method === 'POST' && match[2] === 'refresh') {
        const refreshed = await analyzeRepository(repository.path, repository.name);
        refreshed.id = repository.id;
        repositories = repositories.map((item) => item.id === repository.id ? refreshed : item);
        await saveRepositories(repositories);
        return send(response, 200, { repository: repositorySummary(refreshed) });
      }
    }
    return serveStatic(request, response);
  } catch (error) {
    return send(response, 400, { error: error.message });
  }
});

server.listen(port, () => console.log(`RepoAI running at http://localhost:${port}`));
