import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadMcpTokens, loadRepositories, loadSessions, saveMcpTokens, saveRepositories, saveSessions } from '../server/store.js';

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('uses local JSON storage when MongoDB is not configured', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'repoai-store-'));
  const previousDataDirectory = process.env.REPOAI_DATA_DIRECTORY;
  const previousMongoUri = process.env.MONGODB_URI;
  process.env.REPOAI_DATA_DIRECTORY = directory;
  delete process.env.MONGODB_URI;
  try {
    const repositories = [{ id: 'repository-1', ownerId: 'github:1', path: 'C:/projects/demo' }];
    const sessions = [{ id: 'session-1', type: 'session', expiresAt: '2030-01-01T00:00:00.000Z' }];
    const tokens = [{ id: 'token-1', ownerId: 'github:1', expiresAt: '2030-01-01T00:00:00.000Z' }];
    await saveRepositories(repositories);
    await saveSessions(sessions);
    await saveMcpTokens(tokens);
    assert.deepEqual(await loadRepositories(), repositories);
    assert.deepEqual(await loadSessions(), sessions);
    assert.deepEqual(await loadMcpTokens(), tokens);
  } finally {
    restoreEnvironment('REPOAI_DATA_DIRECTORY', previousDataDirectory);
    restoreEnvironment('MONGODB_URI', previousMongoUri);
    await rm(directory, { recursive: true, force: true });
  }
});
