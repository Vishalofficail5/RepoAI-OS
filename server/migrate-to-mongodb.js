import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mongoConfigured } from './db.js';
import { loadEnvironment } from './env.js';
import { saveInvestigations, saveMcpTokens, saveRepositories, saveRepositoryAnalysis, saveSessions, upsertUser } from './store.js';

const rootDirectory = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
await loadEnvironment(rootDirectory);

if (!mongoConfigured()) throw new Error('Set MONGODB_URI before running the MongoDB migration.');

const dataDirectory = path.resolve(process.env.REPOAI_DATA_DIRECTORY ?? path.join(rootDirectory, '.repoai-data'));

async function readLocalData(name) {
  try {
    return JSON.parse(await readFile(path.join(dataDirectory, name), 'utf8'));
  } catch {
    return [];
  }
}

const [repositories, sessions, investigations, tokens, analyses] = await Promise.all([
  readLocalData('repositories.json'),
  readLocalData('sessions.json'),
  readLocalData('investigations.json'),
  readLocalData('mcp-tokens.json'),
  readLocalData('analysis-cache.json')
]);

await saveRepositories(repositories);
await saveSessions(sessions);
await saveInvestigations(investigations);
await saveMcpTokens(tokens);
for (const analysis of analyses) await saveRepositoryAnalysis(analysis);
for (const user of new Map(sessions.filter((session) => session.type === 'session' && session.user?.id).map((session) => [session.user.id, session.user])).values()) await upsertUser(user);

console.log(`Migrated ${repositories.length} repositories, ${sessions.length} sessions, ${investigations.length} investigations, ${tokens.length} tokens, and ${analyses.length} analyses to MongoDB.`);
