import { createServer } from 'node:http';
import { verifyJwt } from './auth/verifyJwt.js';
import { createSession } from './routes/auth.js';
import { createCheckout } from './routes/checkout.js';

const port = Number(process.env.PORT ?? 3001);
const jwtSecret = process.env.JWT_SECRET ?? 'local-development-secret';

const gateway = {
  async authorize({ orderId, amount, attempt }) {
    if (attempt === 1 && amount > 100) throw new Error('Payment gateway timeout');
    return { id: `auth_${orderId}`, status: 'authorized' };
  }
};

function respond(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function authenticatedUser(request) {
  const token = request.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new Error('Missing bearer token');
  return verifyJwt(token, jwtSecret);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/health') return respond(response, 200, { status: 'ok', service: 'checkout-api' });
    const body = await readBody(request);
    if (request.method === 'POST' && request.url === '/v1/auth/session') return respond(response, 201, createSession(body, jwtSecret));
    if (request.method === 'POST' && request.url === '/v1/checkout') {
      const user = authenticatedUser(request);
      return respond(response, 201, await createCheckout({ ...body, userId: user.sub }, gateway));
    }
    return respond(response, 404, { error: 'Route not found' });
  } catch (error) {
    return respond(response, 400, { error: error.message });
  }
});

server.listen(port, () => console.log(`checkout-api listening on ${port}`));
