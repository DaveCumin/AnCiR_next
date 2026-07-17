# App backend — NL → AnCiR session

`app/` is an Express backend that turns a natural-language prompt into a built AnCiR
session and opens it in the GUI via `?loadFromURL=`. **Bring-your-own model**: the
caller supplies their own OpenAI-compatible endpoint/key/model per request; the deployer
pays nothing and the key is never logged/stored.

## Modules
```
app/
  server.mjs       createApp() (Express) + startServer(); routes, rate limit, static UI,
                   pino logs, env + SSRF mode. Entry-guarded so tests can import createApp.
  agent.mjs        buildSession(); runLlm (tool loop) / runScripted (no-key fallback);
                   resolveLlm (BYO precedence) / resolveOptions (clamped knobs). Spawns a
                   fresh MCP server per build (isolation).
  promptBuilder.js buildSystemPrompt(caps) = prompts/system.md (tunable rules) + live
                   catalogue; promptVersion() hash. Shared with test/agnostic-client.mjs.
  prompts/system.md  human-editable prompt rules ({{CATALOGUE}} placeholder)
  llmClient.js     chatCompletion(cfg, body, {retries,timeoutMs}) — exp-backoff retry on
                   429/408/5xx/network (Retry-After), timeout; returns non-retryable
                   errors so the loop still handles tool_use_failed
  validation.js    zod /build schema + SSRF guard (checkBaseUrl) on the BYO baseUrl
  log.js           pino (JSON → stderr, secret redaction)
  public/index.html static chat UI (reads /config, Model-settings panel, provider presets)
```

## HTTP API
- `POST /build` `{prompt, llm?:{baseUrl,apiKey,model}, options?}` →
  `{id, planner:'llm'|'scripted', model?, note?, trace[], sessionUrl, ancirUrl}`.
  `ancirUrl = <ANCIR_BASE>/?loadFromURL=<sessionUrl>`.
  `options` (clamped): `maxTurns` 1–24, `timeoutMs` 5k–120k, `retries` 0–5,
  `temperature` 0–2, `topP` 0–1, `maxTokens` 1–8192, `parallelToolCalls`, `toolChoice`.
- `GET /sessions/:id` → the session JSON, **CORS `*`** (so AnCiR on another origin can
  fetch it). In-memory store, `SESSION_TTL_MS` (default 1 h).
- `GET /config` → `{ancirBase}` (the static UI reads this). `GET /health`.

## Model resolution (BYO)
`resolveLlm`: per-request `llm` **>** server env (`OPENAI_BASE_URL/API_KEY/MODEL`) **>**
default. No key anywhere ⇒ `scripted` planner (deterministic cosine demo; ignores prompt
specifics). Local endpoints (Ollama/LM Studio) only work when the backend runs on the
user's machine — a hosted backend's `localhost` is the server's.

## Security (public mode = `APP_HOST=0.0.0.0`)
- **Validation:** zod rejects bad/oversized/unknown fields → `400`.
- **SSRF guard on `baseUrl`:** https-only; blocks private/loopback/link-local/metadata;
  restricts to a provider allowlist (openai/anthropic/x.ai/groq/nvidia/openrouter/…).
  Relax via `ALLOW_CUSTOM_LLM_ENDPOINTS=1`, `ALLOW_LOCAL_LLM=1`, `LLM_EXTRA_HOSTS=`.
  In local bind mode the guard is permissive (so local Ollama works).
- **Rate limit:** `express-rate-limit` on `/build` (`BUILD_RATE_MAX`/min per IP);
  `TRUST_PROXY` so the real client IP is used behind a tunnel/proxy.
- The user's key is used only for the request; never logged (the error path never logs
  the body) or stored.

## Env (all optional — see app/.env.example)
`ANCIR_BASE_URL` (the GUI URL), `APP_HOST`/`APP_PORT`/`PORT`, `APP_BASE_URL` (else derived
from the request's `x-forwarded-*` — an ephemeral tunnel URL works with no config),
`OPENAI_*` (server-default model), `LOG_LEVEL`, `BUILD_RATE_MAX`, `TRUST_PROXY`,
`SESSION_TTL_MS`, the SSRF relaxations above.

## Run & test
```
npm run app            # backend :5273  (needs the AnCiR GUI at ANCIR_BASE_URL)
npm run app:units      # node:test: config, retry, validation/SSRF, endpoints (15)
npm run app:test       # scripted round-trip: NL → session JSON → served URL
npm run app:byo        # BYO routes to the caller's endpoint (not a server key)
```

## Extending
The `runLlm` loop, `promptBuilder`, `llmClient`, and `validation` are framework-agnostic:
an in-browser assistant (Option 1 in the vault design note) reuses them, calling AnCiR's
in-process engine instead of the stdio MCP — where the SSRF concern disappears. Deploy in
[`deploy.md`](deploy.md).
