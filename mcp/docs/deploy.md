# Run & deploy

**The product needs no server with RAM.** The model emits a JSON draft, the pure normalizer
turns it into a session, and the **AnCiR SPA computes the analyses in the user's browser** when
it loads. So the whole NL→session path is a static site + a ~83 KB Worker, both on Cloudflare's
free tier. (ADR: `2026-07-15-static-session-emission`.)

The heavy `vite-node` engine still exists, but it is now **optional** — only the MCP server
needs it, and only when you host that remotely.

| Piece | What it is | Needs |
| --- | --- | --- |
| **AnCiR** | the static SPA; computes sessions client-side | Pages / any static host |
| **Worker** (`mcp/worker/`) | NL → session; the product | Cloudflare Worker + KV |
| MCP server (`mcp/src/server.js`) | the engine as MCP tools, for agents | local: nothing · remote: a VM |
| Express app (`mcp/app/`) | the *original* NL→session backend, engine-driven | a VM — **superseded by the Worker** |

---

## Deploy the product

### ⚠️ `npm run build` publishes

The repo's `build` script has a `postbuild` hook that **FTP-uploads** (`DEPLOY_COMMAND` in
`.env`). To build *without* that side-effect use:

```bash
npm run testbuild        # vitest + version stamp + vite build → build/   (no FTP)
```

`postbuild` only fires for `build`, not `testbuild`/`buildonly`.

### 1. AnCiR → Cloudflare Pages

```bash
npm run testbuild                     # → build/  (adapter-static, single inline index.html)
npx wrangler pages deploy build       # or drag-drop build/ in the dashboard
```

Note the URL (e.g. `https://ancir.pages.dev`) — it's the Worker's `ANCIR_BASE_URL`.

### 2. Worker → Cloudflare

```bash
cd mcp/worker
npx wrangler kv namespace create SESSIONS     # once — paste the printed id into wrangler.toml
```

Then in `worker/wrangler.toml`: set the KV `id`, and `ANCIR_BASE_URL` to your Pages URL.

```bash
cd mcp && npm run worker:deploy
```

**No API key required.** Bring-your-own-model: callers send `llm.{baseUrl,apiKey,model}` per
request, so **you pay nothing for inference**. The key is used for one upstream call and never
stored or logged. To offer a fallback model instead, set `OPENAI_BASE_URL`/`OPENAI_MODEL` as
vars and `OPENAI_API_KEY` as a **secret** (`wrangler secret put`), never a var.

### 3. Check

```bash
curl https://<worker>/health          # {"ok":true}
curl https://<worker>/build -H 'Content-Type: application/json' \
  -d '{"prompt":"simulate a 24h rhythm and fit a cosinor",
       "llm":{"baseUrl":"https://api.openai.com/v1","apiKey":"sk-…","model":"gpt-4o-mini"}}'
```

Open the returned `url` — AnCiR loads the session and computes it. Full route reference:
[`../worker/README.md`](../worker/README.md).

**Cost:** Pages free; Worker free tier (100k req/day) — the bundle is ~83 KB gzipped; KV free
tier covers transient sessions (TTL `SESSION_TTL_S`, default 24 h); inference is on the caller.

---

## Local

```bash
npm run dev            # repo root — AnCiR at http://localhost:5173
cd mcp
npm run worker:dev     # Worker + local KV; SSRF guard relaxed (point llm.baseUrl at Ollama)
npm run worker:test    # 12 tests, no network
```

A **deployed** Worker can't reach a user's localhost Ollama — that only works in `worker:dev`.

---

## The MCP server (optional, for agents)

Unchanged, and the only thing that still wants a VM — because it runs AnCiR's real engine
through `vite-node` (registry compile peaks ~1 GB, ~7 s cold start).

- **Locally** (Claude Desktop/Code over stdio): no hosting at all — just `npm start`.
- **Remotely** (HTTP transport): needs a container/VM with real RAM — *not* edge/Workers/Pages.
  Package the **whole repo** (main + `mcp/`), install deps **on the host** (ARM builds) with
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.

```bash
cd ~/AnCiR_next/mcp
pm2 start npm --name ancir-mcp -- run start:http
pm2 start cloudflared --name ancir-tunnel -- tunnel --url http://localhost:5273
pm2 logs ancir-tunnel        # copy the https://<random>.trycloudflare.com URL
pm2 save && pm2 startup
```

Free hosts (RAM decides — the vite-node compile peaks ~1 GB):

| Host | RAM | Fit |
| --- | --- | --- |
| **Oracle A1** always-free | up to 24 GB | best |
| **Google Cloud `e2-micro`** always-free (US regions) | 1 GB | works **with a 2 GB swapfile**; slower |
| Render / Koyeb free | 512 MB | OOM risk on the compile; they spin down |
| Fly.io / Railway | — | no longer free |

Swapfile (1 GB VM):
```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
**Zero-provider:** any spare machine / Raspberry Pi + a Cloudflare Tunnel.

> The old **Express app** (`mcp/app/`) is the engine-driven ancestor of the Worker and has the
> same VM requirement. Keep it for local use/reference; deploy the Worker instead.

---

## Gotchas

- **`compatibility_date` must not be newer than your wrangler's workerd binary**, or
  `wrangler dev` refuses to start. `wrangler deploy --dry-run` will **not** catch it — it
  bundles without booting the runtime. **Bundling ≠ running.**
- **`nodejs_compat` is required** — the normalizer bundles `@stdlib`'s seeded PRNGs
  (SimulatedData / Random).
- **Regenerate the node catalogue after any AnCiR registry change:**
  `npx vite-node src/emit/gen-schema.js`. Both the Worker's prompt and the normalizer read
  `session-schema.generated.json`; stale = the LLM is told about nodes/params that moved.
- **Redeploy AnCiR after `8b67b72`** — before that fix, a plot whose series lacked a colour was
  silently dropped on load (importJson isolates each plot and only `console.error`s).
- Sessions expire (`SESSION_TTL_S`). They're a hand-off, not storage.
- Rate limiting in the Worker is a best-effort KV counter (`BUILD_RATE_MAX`/min/IP);
  Cloudflare's native rate limiting is the real defence.
- MCP-server only: quick-tunnel URLs are **ephemeral** (use a named tunnel + domain for a
  stable one); a private GitHub repo needs a token/deploy key to clone on the host.

## Note on "the durable fix"

Earlier notes called **bundling the engine** (precompile `$lib` → standalone `engine.js`) the
highest-leverage deployment task, because runtime `vite-node` forced a ~1 GB VM. **Route A got
there another way** — by moving compute into the browser, the product needs no engine at all.
Bundling is now only worth doing if you want the *MCP server* to run somewhere small; it is no
longer on the critical path.
