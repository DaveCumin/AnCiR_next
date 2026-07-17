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

## Reading the prompt logs

Every `/build` writes one structured line, so you can review what people actually ask for:

```json
{ "event":"build", "ts":"2026-07-17T00:12:49.650Z",
  "prompt":"Simulate 4 days of a 24 h rhythm, fit a cosinor, and plot it",
  "model":"openai/gpt-oss-120b", "baseUrl":"https://api.groq.com/openai/v1",
  "llmKeySource":"worker-default", "outcome":"ok", "ms":23,
  "sessionId":"75e8…", "nodes":["SimulatedData","Cosinor"], "plots":["scatterplot"],
  "errors":[], "warnings":[] }
```

`outcome` is one of `ok`, `llm_error`, `llm_unreachable`, `unparseable_draft`, `empty_session`
— **failures are logged too**, which are the interesting ones (they show where the prompt or the
model let the user down). `errors`/`warnings` can be non-empty even on `ok` (a node dropped, or
dynamic outputs not pre-allocated).

**Two ways to read them:**

| | |
| --- | --- |
| **Live tail** (debugging now) | `npx wrangler tail --config worker/wrangler.toml --format pretty` |
| **Stored + queryable** (reviewing later) | Cloudflare dashboard → **Workers & Pages** → *ancir-nl* → **Logs** |

The dashboard view is on because `wrangler.toml` sets `[observability] enabled = true`; without
it, logs only stream to `tail` and vanish. You can filter there, e.g. `outcome != "ok"` to see
only the ones that failed. **Retention is ~7 days on the free plan** — if you want to keep them
longer, or run real analysis over them, write to KV/D1/R2 or an external sink instead. Say the
word and I'll add that.

**What is and isn't recorded** — deliberately:
- **Yes:** the prompt (the point), which model answered, outcome, timing, what got built.
- **No:** any API key — neither a caller's nor the Worker's secret. `llmKeySource` says *whose*
  key was used (`caller` / `worker-default`) without revealing it. There are tests asserting this.
- **No IP address.** Adding one would make these logs personal data; add it only if you need it.
- Prompts are user-typed content, so the modal tells users they're logged.

## Gotchas

- **`compatibility_date` must not be newer than your wrangler's workerd binary**, or
  `wrangler dev` refuses to start. `deploy --dry-run` won't catch it (it never boots the
  runtime) — bundling ≠ running.
- `nodejs_compat` is required: the normalizer bundles `@stdlib`'s seeded PRNG (SimulatedData).
- Regenerate the node catalogue after any AnCiR registry change:
  `npx vite-node src/emit/gen-schema.js` — the prompt and the normalizer both read it.
- Rate limiting here is a best-effort KV counter (`BUILD_RATE_MAX`/min/IP). Cloudflare's native
  rate limiting is the real defence.
