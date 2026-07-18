import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadRepositoryAnalysis, saveRepositoryAnalysis } from './store.js';

const ignoredDirectories = new Set(['.git', '.next', '.repoai-data', 'coverage', 'dist', 'node_modules', 'vendor']);
const textExtensions = new Set(['.c', '.cpp', '.css', '.go', '.html', '.java', '.js', '.json', '.jsx', '.md', '.mjs', '.py', '.rb', '.rs', '.sql', '.ts', '.tsx', '.yaml', '.yml']);
const languageNames = { '.css': 'CSS', '.go': 'Go', '.html': 'HTML', '.java': 'Java', '.js': 'JavaScript', '.jsx': 'JavaScript', '.json': 'JSON', '.md': 'Markdown', '.mjs': 'JavaScript', '.py': 'Python', '.rs': 'Rust', '.sql': 'SQL', '.ts': 'TypeScript', '.tsx': 'TypeScript', '.yaml': 'YAML', '.yml': 'YAML' };
const sourceExtensions = ['.js', '.mjs', '.jsx', '.ts', '.tsx', '.py', '.go', '.java', '.rb', '.rs', '.c', '.cpp'];
const queryAliases = {
  auth: ['authentication', 'login', 'jwt', 'token'],
  authentication: ['auth', 'login', 'jwt', 'token'],
  payment: ['checkout', 'billing', 'invoice', 'charge'],
  checkout: ['payment', 'cart', 'order'],
  test: ['spec', 'assert', 'coverage'],
  error: ['exception', 'failure', 'throw'],
  deploy: ['release', 'deployment', 'ci']
};

function normalizePath(value) {
  return value.replaceAll('\\', '/');
}

function safeRelative(root, filePath) {
  return normalizePath(path.relative(root, filePath));
}

async function collectFiles(root, directory = root, files = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) await collectFiles(root, entryPath, files);
      continue;
    }
    if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) files.push(entryPath);
  }
  return files;
}

function matches(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match.slice(1).filter(Boolean));
}

function createChunks(source) {
  const lines = source.split(/\r?\n/);
  const chunks = [];
  const chunkSize = 80;
  const overlap = 10;
  for (let start = 0; start < lines.length; start += chunkSize - overlap) {
    const chunkLines = lines.slice(start, start + chunkSize);
    if (chunkLines.length === 0) break;
    chunks.push({ startLine: start + 1, endLine: start + chunkLines.length, text: chunkLines.join('\n').slice(0, 8000) });
  }
  return chunks;
}

function parseFile(root, filePath, source) {
  const extension = path.extname(filePath).toLowerCase();
  const imports = matches(source, /(?:from\s+|require\s*\()['"]([^'"]+)['"]/g).map(([value]) => value);
  const functions = matches(source, /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g).map(([name]) => name);
  const endpoints = [
    ...matches(source, /(?:app|router|server)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/gi).map(([method, route]) => ({ method: method.toUpperCase(), path: route })),
    ...matches(source, /request\.method\s*===\s*['"](GET|POST|PUT|PATCH|DELETE)['"][\s\S]{0,180}?request\.url\s*===\s*['"]([^'"]+)['"]/gi).map(([method, route]) => ({ method: method.toUpperCase(), path: route }))
  ];
  return {
    path: safeRelative(root, filePath),
    extension,
    language: languageNames[extension] ?? 'Text',
    imports,
    functions,
    endpoints,
    lines: source.split(/\r?\n/).length,
    searchText: source.slice(0, 24000),
    chunks: createChunks(source)
  };
}

function createArchitecture(files) {
  const components = new Map();
  for (const file of files) {
    const [directory = 'root'] = file.path.split('/');
    const current = components.get(directory) ?? { id: directory, label: directory, fileCount: 0, files: [], imports: new Set() };
    current.fileCount += 1;
    current.files.push(file.path);
    file.imports.forEach((item) => current.imports.add(item));
    components.set(directory, current);
  }
  return [...components.values()].map((component) => ({ ...component, imports: [...component.imports].slice(0, 12), files: component.files.slice(0, 12) }));
}

function getGitMetadata(repositoryPath) {
  if (!existsSync(path.join(repositoryPath, '.git'))) return { commits: [] };
  try {
    const headCommit = execFileSync('git', ['-C', repositoryPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const log = execFileSync('git', ['-C', repositoryPath, 'log', '--format=%h%x1f%an%x1f%ad%x1f%s', '--date=iso', '-n', '12'], { encoding: 'utf8' });
    const commits = log.trim().split('\n').filter(Boolean).map((line) => {
      const [sha, author, date, message] = line.split('\x1f');
      return { sha, author, date, message };
    });
    const branch = execFileSync('git', ['-C', repositoryPath, 'branch', '--show-current'], { encoding: 'utf8' }).trim() || 'detached';
    const workingTreeStatus = execFileSync('git', ['-C', repositoryPath, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
    return { branch, commits, headCommit, isClean: workingTreeStatus.length === 0 };
  } catch {
    return { commits: [] };
  }
}

function importedPath(filePath, imported, availablePaths) {
  if (!imported.startsWith('.')) return null;
  const base = path.posix.dirname(filePath);
  const target = path.posix.normalize(path.posix.join(base, imported));
  const candidates = [target, ...sourceExtensions.map((extension) => `${target}${extension}`), ...sourceExtensions.map((extension) => `${target}/index${extension}`)];
  return candidates.find((candidate) => availablePaths.has(candidate)) ?? null;
}

function isTestFile(file) {
  return /(?:^|\/)(?:test|tests|__tests__)\//i.test(file.path) || /(?:\.test|\.spec)\.[^.]+$/i.test(file.path);
}

function createTestIntelligence(files) {
  const availablePaths = new Set(files.map((file) => file.path));
  const testFiles = files.filter(isTestFile);
  const sourceFiles = files.filter((file) => !isTestFile(file) && sourceExtensions.includes(file.extension));
  const testsBySource = new Map();
  for (const testFile of testFiles) {
    for (const imported of testFile.imports) {
      const target = importedPath(testFile.path, imported, availablePaths);
      if (!target) continue;
      testsBySource.set(target, [...(testsBySource.get(target) ?? []), testFile.path]);
    }
  }
  const coveredFileCount = sourceFiles.filter((file) => testsBySource.has(file.path)).length;
  return {
    testFileCount: testFiles.length,
    sourceFileCount: sourceFiles.length,
    coveredFileCount,
    coveragePercent: sourceFiles.length === 0 ? 100 : Math.round((coveredFileCount / sourceFiles.length) * 100),
    gaps: sourceFiles.filter((file) => !testsBySource.has(file.path)).map((file) => file.path).slice(0, 50),
    testsBySource: Object.fromEntries([...testsBySource].map(([source, tests]) => [source, tests.slice(0, 8)]))
  };
}

function searchTerms(question) {
  const terms = [...new Set(question.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [])];
  return [...new Set(terms.flatMap((term) => [term, ...(queryAliases[term] ?? [])]))];
}

function chunkScore(chunk, pathName, terms) {
  const target = chunk.text.toLowerCase();
  const matchedTerms = terms.filter((term) => target.includes(term));
  const pathBonus = terms.filter((term) => pathName.toLowerCase().includes(term)).length * 3;
  return { score: matchedTerms.length + pathBonus, terms: matchedTerms };
}

export async function analyzeRepository(repositoryPath, label) {
  const root = path.resolve(repositoryPath);
  const details = await stat(root);
  if (!details.isDirectory()) throw new Error('Repository path must be a directory');
  const git = getGitMetadata(root);
  const cached = git.isClean ? await loadRepositoryAnalysis(root, git.headCommit) : null;
  if (cached) return cached;
  const paths = await collectFiles(root);
  const files = [];
  for (const filePath of paths) {
    const source = await readFile(filePath, 'utf8').catch(() => '');
    if (source.includes('\u0000')) continue;
    files.push(parseFile(root, filePath, source));
  }
  const languageCounts = files.reduce((counts, file) => ({ ...counts, [file.language]: (counts[file.language] ?? 0) + 1 }), {});
  const endpoints = files.flatMap((file) => file.endpoints.map((endpoint) => ({ ...endpoint, file: file.path })));
  const functionCount = files.reduce((count, file) => count + file.functions.length, 0);
  const importCount = files.reduce((count, file) => count + file.imports.length, 0);
  const relativePath = safeRelative(process.cwd(), root);
  const fingerprint = createHash('sha256').update(files.map((file) => `${file.path}:${file.lines}`).join('|')).digest('hex').slice(0, 12);
  const repository = {
    id: randomUUID(),
    name: label?.trim() || path.basename(root),
    path: root,
    relativePath,
    analyzedAt: new Date().toISOString(),
    fingerprint,
    summary: { fileCount: files.length, functionCount, importCount, endpointCount: endpoints.length, languageCounts },
    files,
    endpoints,
    architecture: createArchitecture(files),
    testIntelligence: createTestIntelligence(files),
    git
  };
  if (git.isClean) await saveRepositoryAnalysis(repository);
  return repository;
}

export function searchRepository(repository, question, limit = 6) {
  const terms = searchTerms(question);
  const results = repository.files.flatMap((file) => {
    const chunks = file.chunks?.length > 0 ? file.chunks : [{ startLine: 1, endLine: file.lines, text: file.searchText ?? '' }];
    return chunks.map((chunk) => ({ file, chunk, ...chunkScore(chunk, file.path, terms) }));
  }).filter((result) => result.score > 0).sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path) || left.chunk.startLine - right.chunk.startLine).slice(0, limit);
  return results.map(({ file, chunk, score, terms: termsMatched }) => ({
    path: file.path,
    language: file.language,
    score,
    terms: termsMatched,
    functions: file.functions.slice(0, 6),
    endpoints: file.endpoints,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    excerpt: chunk.text.slice(0, 1800)
  }));
}

function resolvedGitReference(repositoryPath, reference) {
  if (typeof reference !== 'string' || !reference.trim() || reference.startsWith('-') || /\s/.test(reference)) throw new Error('Git references must be non-empty revision names');
  try {
    return execFileSync('git', ['-C', repositoryPath, 'rev-parse', '--verify', `${reference}^{commit}`], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error(`Git revision “${reference}” was not found`);
  }
}

function gitDiff(repositoryPath, base, head, argumentsList) {
  return execFileSync('git', ['-C', repositoryPath, 'diff', ...argumentsList, `${base}...${head}`], { encoding: 'utf8' }).trim();
}

export function analyzeGitImpact(repository, baseReference = 'HEAD~1', headReference = 'HEAD') {
  if (!repository.git?.headCommit) throw new Error('Git history is unavailable for this repository');
  const head = resolvedGitReference(repository.path, headReference);
  let base;
  try {
    base = resolvedGitReference(repository.path, baseReference);
  } catch (error) {
    if (baseReference !== 'HEAD~1') throw error;
    return { baseReference, headReference, changedFiles: [], affectedFiles: [], endpoints: [], testGaps: [], message: 'A previous commit is required before change impact can be calculated.' };
  }
  const numberStats = gitDiff(repository.path, base, head, ['--numstat']).split('\n').filter(Boolean);
  const status = gitDiff(repository.path, base, head, ['--name-status']).split('\n').filter(Boolean);
  const changes = new Map(numberStats.map((line) => {
    const [additions, deletions, filePath] = line.split('\t');
    return [filePath, { additions: additions === '-' ? null : Number(additions), deletions: deletions === '-' ? null : Number(deletions) }];
  }));
  const changedPaths = new Set(status.map((line) => line.split('\t').at(-1)));
  const availablePaths = new Set(repository.files.map((file) => file.path));
  const affected = new Map();
  changedPaths.forEach((filePath) => affected.set(filePath, { path: filePath, reason: 'Changed in comparison' }));
  let frontier = new Set(changedPaths);
  for (let depth = 0; depth < 3 && frontier.size > 0; depth += 1) {
    const dependents = repository.files.filter((file) => file.imports.some((imported) => frontier.has(importedPath(file.path, imported, availablePaths))));
    frontier = new Set();
    for (const file of dependents) {
      if (affected.has(file.path)) continue;
      affected.set(file.path, { path: file.path, reason: depth === 0 ? 'Imports a changed module' : 'Depends on an affected module' });
      frontier.add(file.path);
    }
  }
  const affectedFiles = [...affected.values()].map((item) => {
    const file = repository.files.find((candidate) => candidate.path === item.path);
    return { ...item, endpoints: file?.endpoints ?? [], tests: repository.testIntelligence?.testsBySource?.[item.path] ?? [] };
  });
  return {
    baseReference,
    headReference,
    changedFiles: [...changedPaths].map((pathName) => ({ path: pathName, ...changes.get(pathName) })),
    affectedFiles,
    endpoints: affectedFiles.flatMap((item) => item.endpoints.map((endpoint) => ({ ...endpoint, file: item.path }))),
    testGaps: affectedFiles.filter((item) => item.tests.length === 0 && sourceExtensions.includes(path.extname(item.path))).map((item) => item.path)
  };
}
