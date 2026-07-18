import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, parseCookies } from '../server/auth.js';

function createStorage() {
  let records = [];
  return {
    load: async () => records,
    save: async (nextRecords) => {
      records = nextRecords;
    },
    records: () => records
  };
}

function createResponse() {
  return {
    status: null,
    body: null,
    writeHead(status) {
      this.status = status;
    },
    end(body) {
      this.body = body;
    }
  };
}

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

test('verifies a stored session and rejects requests without a session', async () => {
  const storage = createStorage();
  let savedUser;
  const auth = createAuth({
    loadSessions: storage.load,
    saveSessions: storage.save,
    saveUser: async (user) => { savedUser = user; },
    environment: { SESSION_SECRET: 'test-session-secret' },
    createRandomToken: () => 'session-id'
  });
  const session = await auth.createSession({ id: 'github:42', provider: 'github', name: 'Vishal', avatarUrl: null });
  const request = { headers: { cookie: `${auth.sessionCookieName}=${auth.createSessionToken(session.id)}` } };

  assert.equal((await auth.requireSession(request, createResponse())).user.id, 'github:42');
  assert.equal(savedUser.id, 'github:42');

  const rejectedResponse = createResponse();
  assert.equal(await auth.requireSession({ headers: {} }, rejectedResponse), null);
  assert.equal(rejectedResponse.status, 401);
});

test('handles a GitHub callback with mocked token and profile responses', async () => {
  const storage = createStorage();
  const tokens = ['state-token', 'session-token'];
  const auth = createAuth({
    loadSessions: storage.load,
    saveSessions: storage.save,
    environment: { GITHUB_CLIENT_ID: 'github-client', GITHUB_CLIENT_SECRET: 'github-secret', SESSION_SECRET: 'test-session-secret' },
    createRandomToken: () => tokens.shift(),
    fetchImpl: async (url) => {
      if (url === 'https://github.com/login/oauth/access_token') return response({ access_token: 'github-token' });
      if (url === 'https://api.github.com/user') return response({ id: 7, login: 'vishal', name: 'Vishal', avatar_url: 'https://example.com/vishal.png' });
      throw new Error(`Unexpected OAuth request: ${url}`);
    }
  });
  const redirect = await auth.beginOAuth('github');
  const authorizationUrl = new URL(redirect.location);
  const state = authorizationUrl.searchParams.get('state');
  const stateCookie = parseCookies(redirect.headers['set-cookie'][0]).repoai_oauth_state;
  const completed = await auth.completeOAuth('github', { code: 'github-code', state }, { repoai_oauth_state: stateCookie });

  assert.equal(authorizationUrl.searchParams.get('client_id'), 'github-client');
  assert.equal(authorizationUrl.searchParams.get('redirect_uri'), 'http://localhost:3000/auth/github/callback');
  assert.equal(completed.user.id, 'github:7');
  assert.equal(storage.records().some((record) => record.type === 'session'), true);
  assert.match(completed.headers['set-cookie'][0], /^repoai_session=/);
});

test('rejects insecure non-local OAuth base URLs', () => {
  const storage = createStorage();
  assert.throws(() => createAuth({
    loadSessions: storage.load,
    saveSessions: storage.save,
    environment: { SESSION_SECRET: 'test-session-secret' },
    baseUrl: 'http://repoai.example.com'
  }), /OAuth base URL is invalid/);
});
