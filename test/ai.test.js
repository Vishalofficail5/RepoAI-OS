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
  const enabled = process.env.REPOAI_OPENAI_ENABLED;
  process.env.REPOAI_OPENAI_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.OPENAI_MODEL = 'test-model';
  return () => {
    if (apiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = apiKey;
    if (model === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = model;
    if (enabled === undefined) delete process.env.REPOAI_OPENAI_ENABLED;
    else process.env.REPOAI_OPENAI_ENABLED = enabled;
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
      json: async () => ({ output_text: JSON.stringify({ answer: 'JWT is verified by verifyJwt.', explanation: 'The function is defined in src/auth.js.', nextSteps: ['Review src/auth.js.'], confidence: 'high' }) })
    };
  };
  try {
    const result = await answerRepositoryQuestion(repository, 'Where is JWT verified?');
    assert.equal(result.source, 'openai');
    assert.equal(result.answer, 'JWT is verified by verifyJwt.');
    assert.equal(result.explanation, 'The function is defined in src/auth.js.');
    assert.equal(result.confidence, 'high');
    assert.equal(request.url, 'https://api.openai.com/v1/responses');
    assert.equal(JSON.parse(request.options.body).model, 'test-model');
    assert.match(JSON.parse(request.options.body).input[0].content, /evidence-led answer/);
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
    assert.ok(result.explanation);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

test('keeps repository excerpts local until OpenAI is explicitly enabled', async () => {
  const enabled = process.env.REPOAI_OPENAI_ENABLED;
  const originalFetch = globalThis.fetch;
  process.env.REPOAI_OPENAI_ENABLED = 'false';
  globalThis.fetch = async () => { throw new Error('OpenAI should not be called'); };
  try {
    const result = await answerRepositoryQuestion(repository, 'Where is JWT verified?');
    assert.equal(result.source, 'local');
  } finally {
    globalThis.fetch = originalFetch;
    if (enabled === undefined) delete process.env.REPOAI_OPENAI_ENABLED;
    else process.env.REPOAI_OPENAI_ENABLED = enabled;
  }
});
