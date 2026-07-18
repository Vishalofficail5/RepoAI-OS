import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeGitImpact, analyzeRepository, searchRepository } from '../server/repository.js';
import { scanRepositorySecurity } from '../server/security.js';

async function createRepository() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'repoai-intelligence-'));
  await mkdir(path.join(directory, 'src'));
  await mkdir(path.join(directory, 'test'));
  await writeFile(path.join(directory, 'src', 'payment.js'), "export function charge() { return 'ok'; }\n");
  await writeFile(path.join(directory, 'src', 'checkout.js'), "import { charge } from './payment.js';\nexport function checkout() { return charge(); }\n");
  await writeFile(path.join(directory, 'test', 'checkout.test.js'), "import { checkout } from '../src/checkout.js';\ncheckout();\n");
  execFileSync('git', ['init', directory], { stdio: 'ignore' });
  execFileSync('git', ['-C', directory, 'config', 'user.name', 'RepoAI Test']);
  execFileSync('git', ['-C', directory, 'config', 'user.email', 'repoai@example.com']);
  execFileSync('git', ['-C', directory, 'add', '.']);
  execFileSync('git', ['-C', directory, 'commit', '-m', 'Initial version'], { stdio: 'ignore' });
  await writeFile(path.join(directory, 'src', 'payment.js'), "export function charge() { return 'updated'; }\n");
  execFileSync('git', ['-C', directory, 'add', '.']);
  execFileSync('git', ['-C', directory, 'commit', '-m', 'Update payment'], { stdio: 'ignore' });
  return directory;
}

test('returns line-level code evidence and test linkage', async () => {
  const directory = await createRepository();
  try {
    const repository = await analyzeRepository(directory);
    const [result] = searchRepository(repository, 'checkout payment');
    assert.ok(result.startLine >= 1);
    assert.ok(result.endLine >= result.startLine);
    assert.equal(repository.testIntelligence.testsBySource['src/checkout.js'][0], 'test/checkout.test.js');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('maps changed files to affected dependents', async () => {
  const directory = await createRepository();
  try {
    const repository = await analyzeRepository(directory);
    const impact = analyzeGitImpact(repository);
    assert.deepEqual(impact.changedFiles.map((file) => file.path), ['src/payment.js']);
    assert.ok(impact.affectedFiles.some((file) => file.path === 'src/checkout.js'));
    assert.ok(impact.affectedFiles.some((file) => file.path === 'test/checkout.test.js'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('returns actionable local security findings', () => {
  const scan = scanRepositorySecurity({
    files: [{ path: 'src/config.js', lines: 2, chunks: [{ startLine: 1, endLine: 2, text: "const apiKey = 'super-secret-key';\neval(input);" }] }]
  });
  assert.equal(scan.summary.high, 2);
  assert.ok(scan.findings.every((finding) => finding.remediation));
});
