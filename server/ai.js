import { searchRepository } from './repository.js';

function evidenceSummary(result) {
  return `${result.path}${result.functions.length ? ` — ${result.functions.join(', ')}` : ''}${result.endpoints.length ? ` — ${result.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`).join(', ')}` : ''}`;
}

function localAnswer(question, results) {
  if (results.length === 0) return { answer: `No code evidence matched “${question}”. Try a function name, endpoint, or folder name.`, confidence: 'low' };
  const sources = results.slice(0, 3).map(evidenceSummary).join('; ');
  return { answer: `I found ${results.length} relevant code locations for “${question}”. Start with ${sources}. The evidence cards below link each finding to the analyzed source file.`, confidence: results[0].score >= 4 ? 'high' : 'medium' };
}

async function askOpenAI(question, results) {
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) return null;
  const sourceContext = results.map((result, index) => `Source ${index + 1}: ${result.path}\n${result.excerpt}`).join('\n\n');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL,
      input: [
        { role: 'developer', content: 'Answer only from the supplied repository sources. State uncertainty when evidence is weak. Return concise JSON with answer and confidence.' },
        { role: 'user', content: `Question: ${question}\n\nRepository sources:\n${sourceContext}` }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'repository_answer',
          strict: true,
          schema: {
            type: 'object',
            properties: { answer: { type: 'string' }, confidence: { type: 'string', enum: ['low', 'medium', 'high'] } },
            required: ['answer', 'confidence'],
            additionalProperties: false
          }
        }
      }
    })
  });
  if (!response.ok) throw new Error(`OpenAI request failed with status ${response.status}`);
  const payload = await response.json();
  return JSON.parse(payload.output_text);
}

export async function answerRepositoryQuestion(repository, question) {
  const evidence = searchRepository(repository, question);
  try {
    const answer = await askOpenAI(question, evidence);
    if (answer) return { ...answer, evidence, source: 'openai' };
  } catch (error) {
    return { ...localAnswer(question, evidence), evidence, source: 'local', warning: error.message };
  }
  return { ...localAnswer(question, evidence), evidence, source: 'local' };
}
