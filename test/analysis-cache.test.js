import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeRepository } from '../server/repository.js';

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('reuses clean analysis and invalidates it for uncommitted changes', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'repoai-analysis-'));
  const repositoryPath = path.join(temporaryDirectory, 'repository');
  const dataDirectory = path.join(temporaryDirectory, 'data');
  const previousDataDirectory = process.env.REPOAI_DATA_DIRECTORY;
  process.env.REPOAI_DATA_DIRECTORY = dataDirectory;
  try {
    await mkdir(repositoryPath);
    await writeFile(path.join(repositoryPath, 'index.js'), 'export function checkout() { return true; }\n');
    execFileSync('git', ['init', repositoryPath], { stdio: 'ignore' });
    execFileSync('git', ['-C', repositoryPath, 'config', 'core.autocrlf', 'false']);
    execFileSync('git', ['-C', repositoryPath, 'config', 'user.name', 'RepoAI Test']);
    execFileSync('git', ['-C', repositoryPath, 'config', 'user.email', 'repoai@example.com']);
    execFileSync('git', ['-C', repositoryPath, 'add', '.']);
    execFileSync('git', ['-C', repositoryPath, 'commit', '-m', 'Initial analysis fixture'], { stdio: 'ignore' });

    const first = await analyzeRepository(repositoryPath);
    const cleanCached = await analyzeRepository(repositoryPath);
    await writeFile(path.join(repositoryPath, 'uncommitted.js'), 'export function ignoredByHeadCache() { return true; }\n');
    const changed = await analyzeRepository(repositoryPath);

    assert.match(first.git.headCommit, /^[a-f0-9]{40}$/);
    assert.equal(cleanCached.id, first.id);
    assert.notEqual(changed.id, first.id);
    assert.equal(changed.summary.fileCount, first.summary.fileCount + 1);
  } finally {
    restoreEnvironment('REPOAI_DATA_DIRECTORY', previousDataDirectory);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
