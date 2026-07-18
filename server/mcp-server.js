import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const baseUrl = (process.env.REPOAI_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const mcpToken = process.env.REPOAI_MCP_TOKEN;

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function callRepoAI(path, options = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: AbortSignal.timeout(30000),
      headers: { Accept: 'application/json', ...(mcpToken ? { Authorization: `Bearer ${mcpToken}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
    });
  } catch {
    throw new Error(`RepoAI API is unavailable at ${baseUrl}. Start RepoAI with npm start, or set REPOAI_BASE_URL.`);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `RepoAI API returned ${response.status}`);
  return payload;
}

const server = new McpServer({ name: 'repoai', version: '0.1.0' });

server.registerTool(
  'list_repositories',
  {
    title: 'List connected repositories',
    description: 'List every repository currently connected to RepoAI, including analysis time, branch, source URL, and repository metrics.',
    inputSchema: {}
  },
  async () => {
    try {
      return textResult(await callRepoAI('/api/repositories'));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  'connect_repository',
  {
    title: 'Connect and analyze a repository',
    description: 'Connect a local repository directory or a public GitHub repository URL to RepoAI, then analyze its files, dependencies, functions, endpoints, architecture, and Git metadata.',
    inputSchema: {
      path: z.string().trim().min(1).describe('A local repository directory or a public https://github.com/owner/repository URL.'),
      name: z.string().trim().min(1).optional().describe('Optional display name for the repository.')
    }
  },
  async ({ path, name }) => {
    try {
      return textResult(await callRepoAI('/api/repositories', { method: 'POST', body: JSON.stringify({ path, name }) }));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  'search_repository',
  {
    title: 'Search repository knowledge',
    description: 'Answer a natural-language question about one connected repository using evidence retrieved from its analyzed source files. Use this for code location, function, endpoint, dependency, and architecture questions.',
    inputSchema: {
      repositoryId: z.string().uuid().describe('The repository ID returned by list_repositories.'),
      question: z.string().trim().min(1).describe('The repository question to answer with source-file evidence.')
    }
  },
  async ({ repositoryId, question }) => {
    try {
      return textResult(await callRepoAI(`/api/repositories/${encodeURIComponent(repositoryId)}/search`, { method: 'POST', body: JSON.stringify({ question }) }));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  'investigate_repository',
  {
    title: 'Investigate repository changes and impact',
    description: 'Investigate a repository incident, regression, or change. Returns a likely root cause, confidence, source evidence, and recent Git commits to identify what changed and what is affected.',
    inputSchema: {
      repositoryId: z.string().uuid().describe('The repository ID returned by list_repositories.'),
      question: z.string().trim().min(1).optional().describe('Optional incident or change question. If omitted, RepoAI investigates recent changes and affected areas.')
    }
  },
  async ({ repositoryId, question }) => {
    try {
      return textResult(await callRepoAI(`/api/repositories/${encodeURIComponent(repositoryId)}/investigations`, { method: 'POST', body: JSON.stringify({ question }) }));
    } catch (error) {
      return errorResult(error);
    }
  }
);

await server.connect(new StdioServerTransport());
