import { searchRepository } from './repository.js';

function evidenceSummary(result) {
  return `${result.path}${result.functions.length ? ` — ${result.functions.join(', ')}` : ''}${result.endpoints.length ? ` — ${result.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`).join(', ')}` : ''}`;
}

function localAnswer(question, results) {
  if (results.length === 0) {
    return {
      answer: `No analyzed code directly matches “${question}”.`,
      explanation: 'The current repository evidence did not contain matching function names, endpoints, file paths, or code terms.',
      nextSteps: ['Try a function name, endpoint, folder, or a more specific feature name.'],
      confidence: 'low'
    };
  }
  const primary = evidenceSummary(results[0]);
  const supporting = results.slice(1, 3).map(evidenceSummary).join('; ');
  return {
    answer: `The strongest match is ${primary}.`,
    explanation: supporting ? `Related evidence also appears in ${supporting}. Review the linked excerpts to confirm the full control flow.` : 'Review the linked excerpt to confirm the surrounding control flow and callers.',
    nextSteps: [`Open ${results[0].path} at lines ${results[0].startLine}-${results[0].endLine}.`],
    confidence: results[0].score >= 4 ? 'high' : 'medium'
  };
}

async function askOpenAI(question, results) {
  if (process.env.REPOAI_OPENAI_ENABLED !== 'true' || !process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) return null;
  const sourceContext = results.map((result, index) => `Source ${index + 1}: ${result.path}\n${result.excerpt}`).join('\n\n');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL,
      input: [
        { role: 'developer', content: 'Role: RepoAI repository analyst.\n\nGoal: give a developer a useful, evidence-led answer to the question.\n\nSuccess criteria:\n- Lead with the direct answer.\n- Explain how the supplied code supports it, naming relevant files, functions, or endpoints.\n- Distinguish confirmed facts from uncertain inferences.\n- Do not invent behavior, files, dependencies, or implementation details that are absent from the sources.\n\nOutput:\n- answer: one direct conclusion.\n- explanation: two to four short sentences that connect the conclusion to the evidence.\n- nextSteps: one to three concrete files or checks that help the developer verify or continue the investigation.\n- confidence: high only when the sources directly establish the answer; otherwise medium or low.' },
        { role: 'user', content: `Question: ${question}\n\nRepository sources:\n${sourceContext}` }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'repository_answer',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              answer: { type: 'string' },
              explanation: { type: 'string' },
              nextSteps: { type: 'array', items: { type: 'string' } },
              confidence: { type: 'string', enum: ['low', 'medium', 'high'] }
            },
            required: ['answer', 'explanation', 'nextSteps', 'confidence'],
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
