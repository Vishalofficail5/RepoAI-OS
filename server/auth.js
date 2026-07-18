import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const providers = {
  github: {
    name: 'GitHub',
    clientId: 'GITHUB_CLIENT_ID',
    clientSecret: 'GITHUB_CLIENT_SECRET',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    profileUrl: 'https://api.github.com/user',
    scope: 'read:user user:email'
  }
};

const sessionCookieName = 'repoai_session';
const stateCookieName = 'repoai_oauth_state';
const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;
const stateDurationMs = 10 * 60 * 1000;

function createAuthError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function readQueryValue(query, name) {
  return typeof query?.get === 'function' ? query.get(name) : query?.[name];
}

function sameToken(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function encodeCookie(name, value, maxAge, secure) {
  const attributes = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAge !== undefined) attributes.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

function normalizeBaseUrl(baseUrl) {
  try {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol');
    return url.toString().replace(/\/$/, '');
  } catch {
    throw createAuthError('OAuth base URL is invalid', 500);
  }
}

function normalizeUser(providerName, profile) {
  const provider = providers[providerName];
  const id = profile.id ?? profile.sub;
  if (id === undefined || id === null) throw createAuthError(`${provider.name} did not return a user ID`, 502);
  const name = profile.name ?? profile.login ?? profile.email ?? `${provider.name} user`;
  return {
    id: `${providerName}:${id}`,
    provider: providerName,
    name: String(name),
    email: profile.email ? String(profile.email) : null,
    avatarUrl: profile.avatar_url ?? profile.picture ?? null
  };
}

export function parseCookies(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  return value.split(';').reduce((cookies, item) => {
    const index = item.indexOf('=');
    if (index === -1) return cookies;
    const name = item.slice(0, index).trim();
    const encodedValue = item.slice(index + 1).trim();
    if (!name) return cookies;
    try {
      cookies[name] = decodeURIComponent(encodedValue);
    } catch {
      cookies[name] = encodedValue;
    }
    return cookies;
  }, {});
}

export function createAuth({
  loadSessions,
  saveSessions,
  saveUser = async () => {},
  environment = process.env,
  fetchImpl = globalThis.fetch,
  baseUrl = 'http://localhost:3000',
  createRandomToken = () => randomBytes(32).toString('base64url'),
  now = () => Date.now(),
  sessionLifetime = sessionDurationMs
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const secureCookies = normalizedBaseUrl.startsWith('https://');

  function requiredSessionSecret() {
    if (!environment.SESSION_SECRET) throw createAuthError('SESSION_SECRET is not configured', 503);
    return environment.SESSION_SECRET;
  }

  function configuredProvider(providerName) {
    const provider = providers[providerName];
    if (!provider) throw createAuthError('Unsupported OAuth provider', 404);
    const clientId = environment[provider.clientId];
    const clientSecret = environment[provider.clientSecret];
    if (!clientId || !clientSecret) throw createAuthError(`${provider.name} OAuth is not configured`, 503);
    return { ...provider, clientId, clientSecret };
  }

  function callbackUrl(providerName) {
    return `${normalizedBaseUrl}/auth/${providerName}/callback`;
  }

  function signedSessionToken(id) {
    const signature = createHmac('sha256', requiredSessionSecret()).update(id).digest('base64url');
    return `${id}.${signature}`;
  }

  function sessionIdFromToken(token) {
    if (!environment.SESSION_SECRET || typeof token !== 'string') return null;
    const separator = token.lastIndexOf('.');
    if (separator === -1) return null;
    const id = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    return sameToken(signature, signedSessionToken(id).slice(id.length + 1)) ? id : null;
  }

  async function activeSessions() {
    const records = await loadSessions();
    const currentTime = now();
    const active = (Array.isArray(records) ? records : []).filter((record) => Date.parse(record.expiresAt) > currentTime);
    if (active.length !== (Array.isArray(records) ? records.length : 0)) await saveSessions(active);
    return active;
  }

  async function createSession(user) {
    const sessions = await activeSessions();
    const id = createRandomToken();
    const record = {
      type: 'session',
      id,
      user,
      expiresAt: new Date(now() + sessionLifetime).toISOString()
    };
    await saveUser(user);
    await saveSessions([...sessions, record]);
    return record;
  }

  async function beginOAuth(providerName) {
    requiredSessionSecret();
    const provider = configuredProvider(providerName);
    const state = createRandomToken();
    const sessions = await activeSessions();
    await saveSessions([...sessions, {
      type: 'oauth-state',
      id: state,
      provider: providerName,
      expiresAt: new Date(now() + stateDurationMs).toISOString()
    }]);
    const parameters = new URLSearchParams({
      client_id: provider.clientId,
      redirect_uri: callbackUrl(providerName),
      response_type: 'code',
      scope: provider.scope,
      state
    });
    return {
      location: `${provider.authorizationUrl}?${parameters}`,
      headers: { 'set-cookie': [encodeCookie(stateCookieName, state, stateDurationMs / 1000, secureCookies)] }
    };
  }

  async function fetchAccessToken(provider, providerName, code) {
    if (typeof fetchImpl !== 'function') throw createAuthError('OAuth fetch is unavailable', 500);
    const response = await fetchImpl(provider.tokenUrl, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl(providerName)
      }).toString()
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.access_token) throw createAuthError(`${provider.name} token exchange failed`, 502);
    return result.access_token;
  }

  async function fetchProfile(provider, accessToken) {
    const headers = provider.name === 'GitHub'
      ? { accept: 'application/vnd.github+json', authorization: `Bearer ${accessToken}`, 'user-agent': 'RepoAI' }
      : { authorization: `Bearer ${accessToken}` };
    const response = await fetchImpl(provider.profileUrl, { headers });
    const profile = await response.json().catch(() => ({}));
    if (!response.ok) throw createAuthError(`${provider.name} profile request failed`, 502);
    return profile;
  }

  async function completeOAuth(providerName, query, cookieValue) {
    const provider = configuredProvider(providerName);
    const code = readQueryValue(query, 'code');
    const state = readQueryValue(query, 'state');
    const providerError = readQueryValue(query, 'error');
    if (providerError) throw createAuthError(`${provider.name} authorization failed: ${providerError}`, 401);
    const cookies = parseCookies(cookieValue);
    if (!code || !state || !sameToken(state, cookies[stateCookieName])) throw createAuthError('OAuth state could not be verified', 401);
    const sessions = await activeSessions();
    const stateRecord = sessions.find((record) => record.type === 'oauth-state' && record.provider === providerName && sameToken(record.id, state));
    if (!stateRecord) throw createAuthError('OAuth state could not be verified', 401);
    await saveSessions(sessions.filter((record) => record.id !== stateRecord.id));
    const accessToken = await fetchAccessToken(provider, providerName, code);
    const user = normalizeUser(providerName, await fetchProfile(provider, accessToken));
    const session = await createSession(user);
    return {
      user,
      headers: {
        'set-cookie': [
          encodeCookie(sessionCookieName, signedSessionToken(session.id), sessionLifetime / 1000, secureCookies),
          encodeCookie(stateCookieName, '', 0, secureCookies)
        ]
      }
    };
  }

  async function getSession(request) {
    const cookies = parseCookies(request?.headers?.cookie);
    const id = sessionIdFromToken(cookies[sessionCookieName]);
    if (!id) return null;
    const sessions = await activeSessions();
    return sessions.find((record) => record.type === 'session' && sameToken(record.id, id)) ?? null;
  }

  async function requireSession(request, response) {
    const session = await getSession(request);
    if (session) {
      request.user = session.user;
      return session;
    }
    response.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Authentication is required' }));
    return null;
  }

  async function logout(request) {
    const cookies = parseCookies(request?.headers?.cookie);
    const id = sessionIdFromToken(cookies[sessionCookieName]);
    if (id) {
      const sessions = await activeSessions();
      await saveSessions(sessions.filter((record) => !sameToken(record.id, id)));
    }
    return { headers: { 'set-cookie': [encodeCookie(sessionCookieName, '', 0, secureCookies)] } };
  }

  return { beginOAuth, completeOAuth, createSession, createSessionToken: signedSessionToken, getSession, logout, requireSession, sessionCookieName };
}
