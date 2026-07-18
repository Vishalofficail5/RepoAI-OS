import test from 'node:test';
import assert from 'node:assert/strict';
import { answerRepositoryQuestion } from '../server/ai.js';

const repository = {
  files: [{
    path: 'src/auth.js',
    language: 'JavaScript',
    searchText: 'export function verifyJwt(token) { return token.length > 0; }',
    functions: ['verifyJwt'],
    endpoints: []
  }]
};

function setOpenAIEnvironment() {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.OPENAI_MODEL = 'test-model';
  return () => {
    if (apiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = apiKey;
    if (model === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = model;
  };
}

test('uses a mocked OpenAI response when OpenAI is configured', async () => {
  const restoreEnvironment = setOpenAIEnvironment();
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      json: async () => ({ output_text: JSON.stringify({ answer: 'JWT is verified by verifyJwt.', confidence: 'high' }) })
    };
  };
  try {
    const result = await answerRepositoryQuestion(repository, 'Where is JWT verified?');
    assert.equal(result.source, 'openai');
    assert.equal(result.answer, 'JWT is verified by verifyJwt.');
    assert.equal(result.confidence, 'high');
    assert.equal(request.url, 'https://api.openai.com/v1/responses');
    assert.equal(JSON.parse(request.options.body).model, 'test-model');
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

test('falls back to local evidence when the mocked OpenAI request fails', async () => {
  const restoreEnvironment = setOpenAIEnvironment();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  try {
    const result = await answerRepositoryQuestion(repository, 'Where is JWT verified?');
    assert.equal(result.source, 'local');
    assert.match(result.warning, /status 503/);
    assert.ok(result.evidence.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});
