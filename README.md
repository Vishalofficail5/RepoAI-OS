# RepoAI

RepoAI is a local engineering-intelligence application. Connect a repository to inspect its structure, search code with evidence, map architecture, analyze Git changes, surface test gaps and security findings, and generate repository documentation.

## Features

- Local-folder and public repository ingestion
- File, language, import, function, endpoint, and architecture analysis
- Evidence-backed code search with file and line references
- Git change-impact analysis with affected files, endpoints, and test gaps
- Local security rules for credentials, dynamic execution, JWT verification, injection, retries, and floating dependencies
- Generated overview, architecture, API, and test-intelligence documents
- Optional OpenAI Responses API answers grounded in retrieved repository code
- Saved investigations and scoped MCP access tokens

## Requirements

- Node.js 20 or later
- Git, for repository cloning and Git intelligence
- An OpenAI API key and model name for OpenAI-backed answers
- A GitHub OAuth application only when sign-in is required

## Setup

```powershell
cd "C:\Users\VISHAL\Desktop\RepoAI OS"
Copy-Item .env.example .env
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000), sign in, then select **Connect repository**. To try the included fixture, use:

```text
C:\Users\USERS\Desktop\RepoAI OS\repoai-sample-commerce
```

RepoAI accepts local directories inside the workspace by default. To allow another parent directory, set `REPOAI_REPOSITORY_ROOT` before starting the server. It can also clone public GitHub repository URLs; never include credentials in a URL.

## Configuration

Copy `.env.example` to `.env` and set the values needed for your setup.

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Enables OpenAI-backed repository answers. |
| `OPENAI_MODEL` | The OpenAI model used for answers, such as `gpt-5.6`. |
| `SESSION_SECRET` | Required for authenticated sessions. Use a long random value. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Required for GitHub OAuth sign-in. |
| `REPOAI_BASE_URL` | Public application URL when deploying outside localhost. |
| `REPOAI_REPOSITORY_ROOT` | Parent directory allowed for local repository ingestion. |
| `REPOAI_MCP_TOKEN` | One-time scoped token used by the MCP server. |

OpenAI-backed answers are optional. Without `OPENAI_API_KEY` and `OPENAI_MODEL`, RepoAI continues to return local evidence-based search results.

### MongoDB persistence

RepoAI uses MongoDB whenever `MONGODB_URI` is set. On its first successful connection, it creates indexes for users, sessions, repositories, analyses, investigations, and MCP tokens. Sessions and tokens expire automatically based on their `expiresAt` value.

1. Create a MongoDB Atlas cluster, database user, and IP access rule.
2. Copy the Node.js connection string into `.env` and set a database name:

   ```env
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/repoai?retryWrites=true&w=majority
MONGODB_DATABASE=repoai
```

If your network blocks Atlas SRV DNS lookups, add this optional setting:

```env
MONGODB_DNS_SERVERS=1.1.1.1,8.8.8.8
```

3. Start RepoAI with `npm start`.

To copy existing local data from `.repoai-data/` into MongoDB, configure the URI first, then run:

```powershell
npm run migrate:mongodb
```

Without `MONGODB_URI`, RepoAI keeps using local JSON files so development remains usable without a database.

## Authentication

For sign-in, create a GitHub OAuth application with:

- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:3000/auth/github/callback`

Add the generated client ID and secret to `.env`. For deployment, replace localhost with the public HTTPS URL and set `REPOAI_BASE_URL` to the same URL.

## How it works

The browser UI is served from the repository root. The Node.js server analyzes allowed repositories, stores local analysis data under `.repoai-data/`, and exposes the UI and API from one process.

- `server/repository.js` parses source metadata, chunks code for retrieval, links tests to source files, and calculates Git change impact.
- `server/ai.js` retrieves evidence and optionally calls the OpenAI Responses API for a grounded answer.
- `server/security.js` runs local repository security rules.
- `server/documentation.js` produces analysis-based Markdown documents.
- `server/index.js` provides authenticated API routes, saved investigations, and MCP token issuance.

## OpenAI usage

### Runtime

When configured, RepoAI sends the user question and retrieved repository excerpts to the OpenAI Responses API. The model is instructed to answer only from those excerpts and return an answer with a confidence level. Repository answers fall back to local evidence when OpenAI configuration is absent or a request fails.

Set `OPENAI_MODEL=gpt-5.6` to use the GPT-5.6 model alias. OpenAI documents that this alias routes to the flagship GPT-5.6 model. See the official [GPT-5.6 guidance](https://developers.openai.com/api/docs/guides/model-guidance?model=gpt-5.6).

### Development

This project was developed with [OpenAI Codex](https://developers.openai.com/codex/codex-manual.md) using GPT-5.6. Codex was used to inspect the codebase, implement the repository-analysis and dashboard features, update documentation, add focused tests, and run syntax, test-suite, and browser smoke checks. GPT-5.6 was used for implementation reasoning, code generation, review, and validation during that workflow.

Codex and GPT-5.6 are development tools for this project; they are not required to run RepoAI locally. Only the optional OpenAI-backed answer feature requires OpenAI API configuration.

## Verification

```powershell
npm test
```

The test suite covers repository analysis, cache invalidation, Git impact mapping, security findings, OpenAI answer handling, OAuth behavior, and repository cloning.

## MCP server

RepoAI exposes `list_repositories`, `connect_repository`, `search_repository`, and `investigate_repository` through a local stdio MCP server. Start RepoAI first:

```powershell
npm start
```

Add this entry to your MCP host configuration under `mcpServers`:

```json
{
  "mcpServers": {
    "repoai": {
      "command": "node",
      "args": ["C:\\Users\\VISHAL\\Desktop\\RepoAI OS\\server\\mcp-server.js"],
      "env": {
        "REPOAI_BASE_URL": "http://localhost:3000",
        "REPOAI_MCP_TOKEN": "repoai_your_token"
      }
    }
  }
}
```

To create a token, sign in to RepoAI, open the user menu, and select **Create MCP token**. Copy the returned one-time value into `REPOAI_MCP_TOKEN`; it expires after 90 days.

## Project layout

```text
app.js, index.html, styles.css  Browser interface
server/                         API, analysis, storage, and MCP services
test/                           Node.js test suite
repoai-sample-commerce/         Local analysis fixture
.repoai-data/                   Generated local data; do not commit
```
