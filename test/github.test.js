import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clonePublicGitHubRepository, getCloneDestination, parseGitHubRepositoryUrl } from '../server/github.js';

test('parses public GitHub URLs into clone details', () => {
  assert.deepEqual(parseGitHubRepositoryUrl('https://github.com/openai/openai-node.git'), {
    owner: 'openai',
    name: 'openai-node',
    url: 'https://github.com/openai/openai-node.git'
  });
});

test('rejects unsupported GitHub repository URLs', () => {
  assert.equal(parseGitHubRepositoryUrl('git@github.com:openai/openai-node.git'), null);
  assert.throws(() => parseGitHubRepositoryUrl('http://github.com/openai/openai-node'), /public https/);
  assert.throws(() => parseGitHubRepositoryUrl('https://token@github.com/openai/openai-node'), /public https/);
  assert.throws(() => parseGitHubRepositoryUrl('https://github.com/openai/openai-node/issues'), /owner\/repository/);
});

test('clones public repositories into a deterministic destination', async () => {
  const cloneDirectory = await mkdtemp(path.join(os.tmpdir(), 'repoai-github-'));
  const repository = parseGitHubRepositoryUrl('https://github.com/openai/openai-node');
  const destination = getCloneDestination(repository, cloneDirectory);
  const calls = [];
  try {
    await clonePublicGitHubRepository(repository, cloneDirectory, async (...args) => calls.push(args));
    assert.match(path.basename(destination), /^openai--openai-node-[a-f0-9]{10}$/);
    assert.deepEqual(calls, [['git', ['clone', '--depth', '1', repository.url, destination], { windowsHide: true }]]);
  } finally {
    await rm(cloneDirectory, { recursive: true, force: true });
  }
});

test('updates an existing clone instead of cloning it again', async () => {
  const cloneDirectory = await mkdtemp(path.join(os.tmpdir(), 'repoai-github-'));
  const repository = parseGitHubRepositoryUrl('https://github.com/openai/openai-node');
  const destination = getCloneDestination(repository, cloneDirectory);
  const calls = [];
  try {
    await mkdir(path.join(destination, '.git'), { recursive: true });
    await clonePublicGitHubRepository(repository, cloneDirectory, async (...args) => calls.push(args));
    assert.deepEqual(calls, [['git', ['-C', destination, 'fetch', '--depth', '1', 'origin'], { windowsHide: true }]]);
  } finally {
    await rm(cloneDirectory, { recursive: true, force: true });
  }
});
