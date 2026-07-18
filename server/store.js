import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getDatabase } from './db.js';

function dataFile(name) {
  const dataDirectory = path.resolve(process.env.REPOAI_DATA_DIRECTORY ?? path.join(process.cwd(), '.repoai-data'));
  return path.join(dataDirectory, name);
}

function databaseDocuments(documents, expiresAt = false) {
  return documents.map((document) => ({
    ...structuredClone(document),
    ...(expiresAt && document.expiresAt ? { expiresAt: new Date(document.expiresAt) } : {})
  }));
}

function applicationDocuments(documents) {
  return documents.map(({ _id, ...document }) => ({
    ...document,
    ...(document.expiresAt instanceof Date ? { expiresAt: document.expiresAt.toISOString() } : {})
  }));
}

async function loadData(name, fallback, collection, expiresAt = false) {
  const database = await getDatabase();
  if (database) return applicationDocuments(await database.collection(collection).find({}).toArray());
  try {
    return JSON.parse(await readFile(dataFile(name), 'utf8'));
  } catch {
    return fallback;
  }
}

async function saveData(name, data, collection, expiresAt = false) {
  const database = await getDatabase();
  if (database) {
    const target = database.collection(collection);
    await target.deleteMany({});
    if (data.length > 0) await target.insertMany(databaseDocuments(data, expiresAt));
    return;
  }
  const targetFile = dataFile(name);
  await mkdir(path.dirname(targetFile), { recursive: true });
  const temporaryFile = `${targetFile}.${process.pid}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(data, null, 2));
  await rename(temporaryFile, targetFile);
}

export async function loadRepositories() {
  return loadData('repositories.json', [], 'repositories');
}

export async function saveRepositories(repositories) {
  await saveData('repositories.json', repositories, 'repositories');
}

export async function loadSessions() {
  return loadData('sessions.json', [], 'sessions', true);
}

export async function saveSessions(sessions) {
  await saveData('sessions.json', sessions, 'sessions', true);
}

export async function loadInvestigations() {
  return loadData('investigations.json', [], 'investigations');
}

export async function saveInvestigations(investigations) {
  await saveData('investigations.json', investigations, 'investigations');
}

export async function loadMcpTokens() {
  return loadData('mcp-tokens.json', [], 'mcpTokens', true);
}

export async function saveMcpTokens(tokens) {
  await saveData('mcp-tokens.json', tokens, 'mcpTokens', true);
}

export async function upsertUser(user) {
  const database = await getDatabase();
  if (!database) return;
  const updatedAt = new Date().toISOString();
  await database.collection('users').updateOne(
    { id: user.id },
    { $set: { ...structuredClone(user), updatedAt }, $setOnInsert: { createdAt: updatedAt } },
    { upsert: true }
  );
}

export async function loadRepositoryAnalysis(repositoryPath, headCommit) {
  if (!headCommit) return null;
  const database = await getDatabase();
  if (database) {
    const analysis = await database.collection('analyses').findOne({ path: repositoryPath, 'git.headCommit': headCommit });
    return analysis ? applicationDocuments([analysis])[0] : null;
  }
  const analyses = await loadData('analysis-cache.json', [], 'analyses');
  return analyses.find((analysis) => analysis.path === repositoryPath && analysis.git?.headCommit === headCommit) ?? null;
}

export async function saveRepositoryAnalysis(repository) {
  if (!repository.git?.headCommit) return;
  const database = await getDatabase();
  if (database) {
    await database.collection('analyses').replaceOne(
      { path: repository.path, 'git.headCommit': repository.git.headCommit },
      structuredClone(repository),
      { upsert: true }
    );
    return;
  }
  const analyses = await loadData('analysis-cache.json', [], 'analyses');
  const remaining = analyses.filter((analysis) => analysis.path !== repository.path || analysis.git?.headCommit !== repository.git.headCommit);
  await saveData('analysis-cache.json', [...remaining, repository], 'analyses');
}
