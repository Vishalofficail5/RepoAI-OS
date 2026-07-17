# Repository Guidelines

## Project Structure & Module Organization

RepoAI is a Node.js ESM application. The browser UI lives at the repository root: `index.html`, `styles.css`, and `app.js`. The backend is in `server/`: `index.js` serves both the API and static UI, while `repository.js`, `github.js`, `ai.js`, `store.js`, and `env.js` contain focused services. Keep generated repository clones and local analysis data under `.repoai-data/`; do not commit them. `repoai-sample-commerce/` is the test fixture used to exercise analysis behavior. Tests belong in `test/`.

## Build, Test, and Development Commands

- `npm start` starts the server at `http://localhost:3000`.
- `npm run dev` starts the server with Node's watch mode for local development.
- `npm test` runs the Node built-in test suite in `test/repository.test.js`.
- `npm run mcp` starts the local stdio MCP server; start the web server separately first.

Use Node.js 20 or later. Copy `.env.example` to `.env` before enabling OpenAI-backed answers. Never commit `.env`, API keys, or cloned repositories.

## Coding Style & Naming Conventions

Use ES modules, `const` by default, two-space indentation, semicolons, and single-quoted strings. Prefer small, verb-named functions such as `analyzeRepository` and `parseGitHubRepositoryUrl`; use camelCase for variables and functions and PascalCase only for classes. Keep HTTP route handling in `server/index.js` and move reusable parsing, storage, or external-service work into a dedicated `server/*.js` module. No formatter or linter is configured, so preserve the surrounding style and avoid unrelated reformatting.

## Testing Guidelines

Tests use `node:test` with `node:assert/strict`. Name files `*.test.js` and describe externally visible behavior, for example `test('rejects credentialed GitHub URLs', ...)`. Extend `test/repository.test.js` for analysis and search changes; add focused test files as needed. Update the sample-commerce fixture only when the behavior under test requires representative repository content. Run `npm test` before opening a pull request.

## Commit & Pull Request Guidelines

The workspace has no usable Git history, so no repository-specific commit convention can be inferred. Use concise imperative subjects, preferably Conventional Commit style: `feat: add repository refresh endpoint` or `fix: reject paths outside the root`. Keep commits scoped to one change. Pull requests should explain the behavior change, list tests run, link the relevant issue when applicable, and include screenshots for UI changes. Call out configuration or security-impacting changes explicitly.
