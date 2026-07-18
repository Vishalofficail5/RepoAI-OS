import { setServers } from 'node:dns';
import { MongoClient, ServerApiVersion } from 'mongodb';

let databasePromise;
let configuredDnsServers;

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
