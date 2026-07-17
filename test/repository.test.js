import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { analyzeRepository, searchRepository } from '../server/repository.js';
import { parseGitHubRepositoryUrl } from '../server/github.js';

const fixturePath = path.resolve('repoai-sample-commerce');

test('analyzes source files, endpoints, and functions', async () => {
  const repository = await analyzeRepository(fixturePath, 'sample-commerce');
  assert.ok(repository.summary.fileCount >= 10);
  assert.ok(repository.summary.functionCount >= 5);
  assert.ok(repository.endpoints.some((endpoint) => endpoint.path === '/v1/checkout'));
  assert.ok(repository.architecture.some((component) => component.id === 'src'));
});

test('returns grounded code evidence for a checkout query', async () => {
  const repository = await analyzeRepository(fixturePath, 'sample-commerce');
  const results = searchRepository(repository, 'payment authorization retry');
  assert.ok(results.length > 0);
  assert.ok(results.some((result) => result.path.includes('authorizePayment') || result.path.includes('retry')));
});

test('accepts a public GitHub repository URL without accepting credentials', () => {
  assert.deepEqual(parseGitHubRepositoryUrl('https://github.com/karpathy/micrograd'), { owner: 'karpathy', name: 'micrograd', url: 'https://github.com/karpathy/micrograd.git' });
  assert.throws(() => parseGitHubRepositoryUrl('https://token@github.com/karpathy/micrograd'), /public https/);
});
