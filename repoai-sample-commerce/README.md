# RepoAI Sample Commerce

A small commerce API designed to exercise repository analysis features: authentication, request routing, payment authorization, retries, data models, tests, and deployment configuration.

## Run

```bash
npm test
npm start
```

The service starts on `http://localhost:3001`.

## API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/v1/auth/session` | Creates a signed development access token. |
| `POST` | `/v1/checkout` | Creates an order and authorizes a payment. Requires a bearer token. |
| `GET` | `/health` | Returns service health. |

## Architecture

```text
HTTP server
  ├── auth routes → JWT signer/verifier
  └── checkout routes → order store → authorization retry policy → payment gateway
```

The payment authorization retry is intentionally isolated in `src/checkout/retry.js`, making it easy to trace through code search and dependency analysis.
