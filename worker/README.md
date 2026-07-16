# ancir-nl — natural language → AnCiR session (Cloudflare Worker)

Turns a prompt into an AnCiR session and returns a link that opens it. **No engine, no VM**:
the model emits one JSON draft, the pure normalizer (`src/emit/`) turns it into a session, and
the AnCiR SPA computes the analyses in the user's browser when it loads. That's what makes this
a ~70 KB Worker instead of a 1 GB box.

See the ADR: `2026-07-15-static-session-emission` (in the vault).

## Routes

| | |
| --- | --- |
| `POST /build` | `{prompt, llm:{baseUrl,apiKey,model}, options?}` → `{url, sessionUrl, sessionId, warnings, errors}` |
| `GET /sessions/:id` | the session JSON (CORS `*`, so AnCiR can fetch it cross-origin) |
| `GET /health` | `{ok:true}` |

`url` is the payoff: `https://<ancir>/?loadFromURL=<sessionUrl>` — open it and the session
builds itself in the browser.

## Bring-your-own model

The caller sends `llm.{baseUrl,apiKey,model}` per request; the key is used for one upstream call
and is never stored or logged. **The deployer pays nothing.** The Worker exists to (a) proxy the
LLM — providers don't send CORS headers, so a browser can't call them directly — and (b) enforce
the SSRF/validation guards (`app/validation.js`).

To offer a fallback model instead, set `OPENAI_BASE_URL`/`OPENAI_MODEL` as vars and
`OPENAI_API_KEY` as a **secret** (`npx wrangler secret put OPENAI_API_KEY`).

## Deploy

```bash
# 1. transient session store (once) — paste the id into wrangler.toml
npx wrangler kv namespace create SESSIONS

# 2. point at your AnCiR deployment (wrangler.toml [vars])
#    ANCIR_BASE_URL = "https://ancir.pages.dev"

# 3. ship it
npm run worker:deploy
```

Free tier is ample: sessions are transient (TTL `SESSION_TTL_S`, default 24 h), and the bundle
is ~70 KB gzipped.

## Local

```bash
npm run worker:dev     # wrangler dev, local KV, SSRF guard relaxed (ALLOW_LOCAL_LLM=1)
npm run worker:test    # node:test — fake KV + stubbed LLM, no network
```

`worker:dev` relaxes the SSRF guard so you can point `llm.baseUrl` at a local Ollama
(`http://localhost:11434/v1`). A **deployed** Worker can't reach a user's localhost anyway.

## Gotchas

- **`compatibility_date` must not be newer than your wrangler's workerd binary**, or
  `wrangler dev` refuses to start. `deploy --dry-run` won't catch it (it never boots the
  runtime) — bundling ≠ running.
- `nodejs_compat` is required: the normalizer bundles `@stdlib`'s seeded PRNG (SimulatedData).
- Regenerate the node catalogue after any AnCiR registry change:
  `npx vite-node src/emit/gen-schema.js` — the prompt and the normalizer both read it.
- Rate limiting here is a best-effort KV counter (`BUILD_RATE_MAX`/min/IP). Cloudflare's native
  rate limiting is the real defence.
