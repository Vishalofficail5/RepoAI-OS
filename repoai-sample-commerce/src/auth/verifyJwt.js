import { createHmac, timingSafeEqual } from 'node:crypto';

const issuer = 'repoai-sample-commerce';
const audience = 'checkout-api';

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decode(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function signature(input, secret) {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

export function createAccessToken(user, secret) {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ sub: user.id, email: user.email, iss: issuer, aud: audience, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${header}.${payload}.${signature(`${header}.${payload}`, secret)}`;
}

export function verifyJwt(token, secret) {
  const [encodedHeader, encodedPayload, providedSignature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !providedSignature) throw new Error('Invalid JWT format');

  const header = decode(encodedHeader);
  const payload = decode(encodedPayload);
  if (header.alg !== 'HS256') throw new Error('Unsupported JWT signing algorithm');
  if (payload.iss !== issuer || payload.aud !== audience) throw new Error('JWT issuer or audience is invalid');
  if (payload.exp <= Math.floor(Date.now() / 1000)) throw new Error('JWT has expired');

  const expectedSignature = Buffer.from(signature(`${encodedHeader}.${encodedPayload}`, secret));
  const receivedSignature = Buffer.from(providedSignature);
  if (expectedSignature.length !== receivedSignature.length || !timingSafeEqual(expectedSignature, receivedSignature)) throw new Error('JWT signature is invalid');
  return payload;
}
