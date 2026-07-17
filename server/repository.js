import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ignoredDirectories = new Set(['.git', '.next', '.repoai-data', 'coverage', 'dist', 'node_modules', 'vendor']);
const textExtensions = new Set(['.c', '.cpp', '.css', '.go', '.html', '.java', '.js', '.json', '.jsx', '.md', '.mjs', '.py', '.rb', '.rs', '.sql', '.ts', '.tsx', '.yaml', '.yml']);
const languageNames = { '.css': 'CSS', '.go': 'Go', '.html': 'HTML', '.java': 'Java', '.js': 'JavaScript', '.jsx': 'JavaScript', '.json': 'JSON', '.md': 'Markdown', '.mjs': 'JavaScript', '.py': 'Python', '.rs': 'Rust', '.sql': 'SQL', '.ts': 'TypeScript', '.tsx': 'TypeScript', '.yaml': 'YAML', '.yml': 'YAML' };

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
    searchText: source.slice(0, 24000)
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
    const log = execFileSync('git', ['-C', repositoryPath, 'log', '--format=%h%x1f%an%x1f%ad%x1f%s', '--date=iso', '-n', '12'], { encoding: 'utf8' });
    const commits = log.trim().split('\n').filter(Boolean).map((line) => {
      const [sha, author, date, message] = line.split('\x1f');
      return { sha, author, date, message };
    });
    const branch = execFileSync('git', ['-C', repositoryPath, 'branch', '--show-current'], { encoding: 'utf8' }).trim() || 'detached';
    return { branch, commits };
  } catch {
    return { commits: [] };
  }
}

export async function analyzeRepository(repositoryPath, label) {
  const root = path.resolve(repositoryPath);
  const details = await stat(root);
  if (!details.isDirectory()) throw new Error('Repository path must be a directory');
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
  return {
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
    git: getGitMetadata(root)
  };
}

export function searchRepository(repository, question, limit = 6) {
  const terms = [...new Set(question.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [])];
  const results = repository.files.map((file) => {
    const target = `${file.path}\n${file.searchText}`.toLowerCase();
    const matches = terms.filter((term) => target.includes(term));
    const pathBonus = terms.filter((term) => file.path.toLowerCase().includes(term)).length * 3;
    return { file, score: matches.length + pathBonus, matches };
  }).filter((result) => result.score > 0).sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path)).slice(0, limit);
  return results.map(({ file, score, matches: termsMatched }) => ({
    path: file.path,
    language: file.language,
    score,
    terms: termsMatched,
    functions: file.functions.slice(0, 6),
    endpoints: file.endpoints,
    excerpt: file.searchText.slice(0, 900)
  }));
}
