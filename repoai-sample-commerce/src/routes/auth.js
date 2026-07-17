import { findUser } from '../data/users.js';
import { createAccessToken } from '../auth/verifyJwt.js';

export function createSession(body, secret) {
  const user = findUser(body.userId ?? 'usr_demo');
  if (!user) throw new Error('User not found');
  return { accessToken: createAccessToken(user, secret), user };
}
