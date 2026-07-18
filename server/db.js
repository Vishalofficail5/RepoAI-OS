import { setServers } from 'node:dns';
import { randomUUID } from 'node:crypto';
import { MongoClient, ServerApiVersion } from 'mongodb';

let databasePromise;
let configuredDnsServers;
const serverLockOwner = randomUUID();
let serverLockHeartbeat;
let serverLockError;

function databaseName() {
  return process.env.MONGODB_DATABASE?.trim() || 'repoai';
}

export function mongoConfigured() {
  return Boolean(process.env.MONGODB_URI?.trim());
}

function configureDnsServers() {
  const servers = process.env.MONGODB_DNS_SERVERS?.split(',')
    .map((server) => server.trim())
    .filter(Boolean) || [];
  const signature = servers.join(',');
  if (!signature || signature === configuredDnsServers) return;
  setServers(servers);
  configuredDnsServers = signature;
}

async function createIndexes(database) {
  await Promise.all([
    database.collection('users').createIndex({ id: 1 }, { unique: true }),
    database.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    database.collection('repositories').createIndex({ ownerId: 1, path: 1 }, { unique: true }),
    database.collection('analyses').createIndex({ path: 1, 'git.headCommit': 1 }, { unique: true }),
    database.collection('investigations').createIndex({ ownerId: 1, repositoryId: 1, createdAt: -1 }),
    database.collection('mcpTokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  ]);
}

export async function getDatabase() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) return null;
  configureDnsServers();
  if (!databasePromise) {
    const client = new MongoClient(uri, {
      appName: 'RepoAI',
      serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
      serverSelectionTimeoutMS: 5000
    });
    databasePromise = client.connect().then(async () => {
      const database = client.db(databaseName());
      await createIndexes(database);
      return database;
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

export async function acquireServerLock() {
  const database = await getDatabase();
  if (!database) return;
  const locks = database.collection('runtimeLocks');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30000);
  const result = await locks.updateOne(
    { _id: 'repoai-server', expiresAt: { $lte: now } },
    { $set: { owner: serverLockOwner, expiresAt } }
  );
  if (result.modifiedCount === 0) {
    try {
      await locks.insertOne({ _id: 'repoai-server', owner: serverLockOwner, expiresAt });
    } catch {
      throw new Error('Another RepoAI server is already using this MongoDB database. Run a single server instance.');
    }
  }
  serverLockHeartbeat = setInterval(() => {
    locks.updateOne({ _id: 'repoai-server', owner: serverLockOwner }, { $set: { expiresAt: new Date(Date.now() + 30000) } }).then((heartbeatResult) => {
      if (heartbeatResult.matchedCount === 0) serverLockError = new Error('MongoDB server lock was lost');
    }).catch((error) => {
      serverLockError = error;
      console.error(JSON.stringify({ level: 'error', message: `MongoDB server lock heartbeat failed: ${error.message}` }));
    });
  }, 10000);
  serverLockHeartbeat.unref();
}

export function serverLockAvailable() {
  return !serverLockError;
}

export async function releaseServerLock() {
  if (!serverLockHeartbeat) return;
  clearInterval(serverLockHeartbeat);
  serverLockHeartbeat = undefined;
  const database = await getDatabase();
  if (database) await database.collection('runtimeLocks').deleteOne({ _id: 'repoai-server', owner: serverLockOwner });
}
