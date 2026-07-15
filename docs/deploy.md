# Run & deploy

Two pieces: **AnCiR (static)** and **the backend (Node)**.

## Local
```bash
# terminal 1 — AnCiR GUI (repo root)
npm run dev                          # http://localhost:5173
# terminal 2 — backend (mcp/)
cd mcp && npm run app                # http://127.0.0.1:5273
```
Open `http://127.0.0.1:5273/`, expand **Model settings** (paste a key, or pick Ollama/LM
Studio for local), prompt, Build. Local bind ⇒ SSRF guard permissive ⇒ local models work.

## Deploy

### 1. AnCiR → Cloudflare Pages (static, single inline `index.html`)
```bash
npm run build                        # → build/
npx wrangler pages deploy build      # or drag-drop build/ in the dashboard
```
Note the URL (e.g. `https://ancir.pages.dev`) → it's the backend's `ANCIR_BASE_URL`.

### 2. Backend → a Node host
The backend spawns `vite-node` and imports the AnCiR repo source, so it needs a
**container/VM with real RAM** (not edge/Workers/Pages). Package the **whole repo**
(main + `mcp/`); install deps **on the host** (ARM builds) with
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (no Chromium needed for the app flow).

**Env:** `ANCIR_BASE_URL=https://<pages-url>`, `APP_HOST=0.0.0.0`, `PORT`/`APP_PORT`;
optional `OPENAI_*` default, `BUILD_RATE_MAX`, `TRUST_PROXY=1`. **No `APP_BASE_URL`
needed** — the session URL derives from the request (`x-forwarded-*`), so an ephemeral
Cloudflare quick-tunnel URL works with zero config. `APP_BASE_URL` **must be https** (a
Pages/HTTPS AnCiR can't fetch an http session URL — mixed content).

**Process + HTTPS (VM):**
```bash
cd ~/AnCiR_next/mcp
pm2 start npm --name ancir-app -- run app
pm2 start cloudflared --name ancir-tunnel -- tunnel --url http://localhost:5273
pm2 logs ancir-tunnel                # copy the https://<random>.trycloudflare.com URL
pm2 save && pm2 startup
```

### Free host options (RAM decides — the vite-node compile peaks ~1 GB)
| Host | RAM | As-is fit |
| --- | --- | --- |
| **Oracle A1** always-free | up to 24 GB | best |
| **Google Cloud `e2-micro`** always-free (US regions) | 1 GB | works **with a 2 GB swapfile**; builds slower |
| **Render / Koyeb** free | 512 MB | OOM risk on the compile; they spin down |
| Fly.io / Railway | — | no longer free |

Swapfile (for a 1 GB VM):
```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
**Zero-provider:** run on any spare machine / Raspberry Pi + a Cloudflare Tunnel.

## The durable fix (removes the RAM constraint)
Runtime `vite-node` is the whole reason the backend is heavy. **Bundling the engine**
(precompile the `$lib` the MCP uses → a standalone `engine.js`, no vite at runtime) makes
it a small Node app that runs on any 512 MB free tier (Render/Koyeb/Cloud Run) and cuts
the ~7 s cold-build compile. Not done yet — the highest-leverage deployment task.

## Gotchas
- Quick-tunnel URLs are **ephemeral** (change on `cloudflared` restart). For a stable URL
  use a **named tunnel + a Cloudflare domain**.
- Public bind ⇒ **SSRF guard active**: users need https + an allowlisted provider (or set
  `ALLOW_CUSTOM_LLM_ENDPOINTS=1`). A hosted backend can't reach a user's **local** Ollama.
- Private GitHub repo ⇒ `git clone` on the host needs a token/deploy key.
- Multi-instance later ⇒ move the in-memory session store to Redis/KV, and wire
  `SessionManager` (warm workers) to avoid a per-build engine spawn.
