import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessToken, verifyJwt } from '../src/auth/verifyJwt.js';

test('verifies a token signed for the checkout API', () => {
  const token = createAccessToken({ id: 'usr_demo', email: 'developer@acme.test' }, 'test-secret');
  const claims = verifyJwt(token, 'test-secret');
  assert.equal(claims.sub, 'usr_demo');
});

test('rejects a token with a different signature', () => {
  const token = createAccessToken({ id: 'usr_demo', email: 'developer@acme.test' }, 'test-secret');
  assert.throws(() => verifyJwt(token, 'other-secret'), /signature/);
});
