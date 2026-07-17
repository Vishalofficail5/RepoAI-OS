# RepoAI

RepoAI is a local engineering-intelligence MVP. It serves the product UI, analyzes a local repository, builds code metadata, and answers repository questions with evidence.

## Run

```powershell
cd "C:\Users\VISHAL\Desktop\RepoAI OS"
Copy-Item .env.example .env
# Add OPENAI_API_KEY and OPENAI_MODEL to .env for OpenAI-backed answers.
npm start
```

Open [http://localhost:3000](http://localhost:3000). Click **Connect repository** and enter a local folder, for example:

```text
C:\Users\VISHAL\Desktop\RepoAI OS\repoai-sample-commerce
```

The app can only ingest directories under this workspace by default. To permit a different directory, set `REPOAI_REPOSITORY_ROOT` to its parent directory before starting the server.

You can also enter a public GitHub repository URL such as `https://github.com/karpathy/micrograd`. RepoAI clones it into its managed local store before analysis. Private repositories require a local Git credential; do not paste access tokens into the URL.

## What works

- Local repository ingestion and repeatable analysis
- File tree, language, dependency, function, endpoint, and architecture metadata
- Evidence-backed lexical code search
- Git metadata when the ingested directory is a Git repository
- Optional OpenAI Responses API answers grounded in retrieved repository excerpts
- Interactive dashboard connected to the local API

## Verification

```powershell
npm test
```

## MCP server

RepoAI exposes its repository-analysis API through a local stdio MCP server. Start RepoAI first, then register the MCP command with Claude Desktop, Claude Code, or another MCP host.

```powershell
npm start
```

Add this entry to Claude Desktop's `claude_desktop_config.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "repoai": {
      "command": "node",
      "args": ["C:\\Users\\VISHAL\\Desktop\\RepoAI OS\\server\\mcp-server.js"],
      "env": {
        "REPOAI_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

The MCP server provides `list_repositories`, `connect_repository`, `search_repository`, and `investigate_repository`. The `REPOAI_BASE_URL` environment variable is optional; it defaults to `http://localhost:3000`.
