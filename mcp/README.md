# AnCiR MCP

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets an
AI agent drive **AnCiR** headlessly: create a session, import data, run AnCiR's
real chronobiology analyses, and export an AnCiR‑compatible `session.json` that
opens directly in the AnCiR GUI.

> This folder is intentionally **git‑ignored** (see the repo `.gitignore`). It is
> not pushed to the public repository. It has its own `node_modules` so the
> app's `package.json` is untouched.

## Why it's built this way

AnCiR is a client‑side SvelteKit app with no backend. Two facts shape the design:

1. **Analyses are real, reusable code.** Each table process exports a plain
   function + a `definition` (e.g. `Cosinor.svelte` exports `evaluateCosinor`),
   and sessions serialise via `core.svelte.js`'s `outputCoreAsJson()`. The MCP
   server calls these directly — **no re‑implementation of the science**, so the
   numbers can never drift from the GUI.
2. **Plot rendering needs a DOM.** The analysis + session path runs in plain
   Node (with a happy‑dom shim); rasterising plots to PNG needs a browser.

So the engine reuses AnCiR's own modules through a Vite runtime that resolves
`$lib` and compiles Svelte (`vite.config.js` here). This is also the path that an
eventual **in‑app premium agent feature** would reuse, since that runs in a real
browser anyway.

## Layers

| Layer | Where | Runs in |
| ----- | ----- | ------- |
| Engine — `AncirSession` over the real `core` | `src/engine/session.js` | Node (happy‑dom) / browser |
| DOM bootstrap (shim for non‑browser runs) | `src/engine/bootstrapDom.js` | Node |
| MCP server (stdio **and** Streamable HTTP) | `src/server.js` | vite‑node |
| Headless plot rasteriser (Vite + Playwright; uses the app's `convertToImage`) | `src/engine/renderPlot.js`, `src/render/` | Chromium |
| Multi‑session isolation (process‑per‑session) | `src/sessionManager.js`, `src/worker.js` | vite‑node (1 per session) |

## Tools

| Tool | Description |
| ---- | ----------- |
| `list_capabilities` | Every analysis, **column transform**, and plot type, **derived live from the engine registry** — input fields, params (with defaults), output keys, status |
| `create_session` | Create/reset the active session |
| `import_data` | Add numeric columns (`{name, type?, values[]}`) |
| `list_columns` | List columns (id, name, type, length) |
| `run_table_process` | **Generic:** run *any* AnCiR analysis by name (`{name, args}`) through the real `definition` registry; output columns are written into the session |
| `add_column_process` | Apply a **column transform** (Add, Multiply, normalize, Sort, OutlierRemoval, RemoveTrend, …) to a column and run its chain; embedded in the session |
| `add_plot` | Create a plot wired to columns and add it to the session (opens rendered in the GUI) |
| `render_plot` | **Rasterise** a plot to PNG (+ SVG) via a real headless browser — the actual AnCiR component with axes/gridlines/legend |
| `export_session` | Export AnCiR‑compatible JSON (optionally write to a file) |

### `run_table_process`

`list_capabilities` enumerates all 22 table processes with their `inputs`
(`scalar`/`array` column‑id fields), `params` (with defaults), and `outKeys`.
Call any of them:

```jsonc
// Fixed‑output process — `out` is auto‑seeded from the definition.
{ "name": "TrendFit", "args": { "xIN": 0, "yIN": [1], "model": "linear" } }

// Dynamic‑output process — `out` is also auto‑synthesised from the inputs/params
// (per‑Y, per‑segment, per‑category, …), so no hand‑written `out` is needed.
{ "name": "RhythmicityAnalysis",
  "args": { "xIN": 0, "yIN": [1], "analysis": "periodogram" } }  // → outputs 1_period, 1_power
```

The returned `outputs[]` give each created column's id, name, length and an
8‑value preview; the analysis node and its columns are embedded in
`export_session`, so the file opens in the GUI with the analysis already wired.
Processes that produce **statistics rather than columns** (e.g. `GroupComparison`)
return a `stats` object instead of `outputs`.

### `add_column_process` (transforms)

`list_capabilities` → `transforms[]` lists the column processes with their params.
Apply one to an existing column; it runs the column's chain and is serialised:

```jsonc
{ "columnId": 1, "name": "normalize" }                 // z-score standardise
{ "columnId": 0, "name": "Add", "args": { "value": 5 } }
{ "columnId": 0, "name": "OutlierRemoval" }
```

### `add_plot` and `render_plot`

`list_capabilities` → `plots[]` lists each plot type and its input field names
(scatterplot/boxplot → `{x, y}`; actogram/periodogram/correlogram/fft →
`{time, values}`; histogram → `{column}`; tableplot → an array of column ids).

```jsonc
// add_plot — embed a plot in the session (renders when opened in the GUI)
{ "type": "scatterplot", "inputs": { "x": 0, "y": 1 } }

// render_plot — rasterise to PNG (+ SVG) right now, via a real headless browser
{ "type": "actogram", "inputs": { "time": 0, "values": 1 }, "path": "/tmp/acto" }
// → { png: "/tmp/acto.png", svg: "/tmp/acto.svg", bytes, width, height }
```

`render_plot` mounts the **real** AnCiR plot component in headless Chromium (Vite +
Playwright) and rasterises it through the app's **own** `convertToImage()` export
function (the same SVG→canvas→PNG / outerHTML→SVG path as the GUI's export buttons),
so the output is byte‑for‑byte what the GUI produces. Returns `{png, svg, pngBytes,
svgBytes, …}`. It reuses the app's Playwright/Chromium; if no browser is available
the other tools are unaffected.

## Run

```bash
cd mcp
npm install            # installs into mcp/node_modules (git‑ignored)
npm test               # vitest: headless engine + registry (15 tests)
npm run smoke          # end‑to‑end over stdio (spawns the server, drives it via MCP)
npm run smoke:http     # end‑to‑end over Streamable HTTP
npm run smoke:render   # end‑to‑end render_plot → PNG/SVG (needs Chromium)
node test/smoke-multisession.mjs   # two isolated sessions (process-per-session)
npm run agnostic       # drive the tools from any OpenAI-compatible LLM (dry-run w/o key)
npm start              # launch the MCP server on stdio
npm run start:http     # launch on Streamable HTTP (127.0.0.1:3017/mcp)
```

### Connect from an MCP client (stdio)

```jsonc
{
  "mcpServers": {
    "ancir": {
      "command": "npm",
      "args": ["start"],
      "cwd": "/absolute/path/to/AnCiR_next/mcp"
    }
  }
}
```

> Tip: `npm start` runs `vite-node src/server.js`. If a client invokes the server
> from a different working directory, set `cwd` to this `mcp/` folder (above) or
> use an absolute command. The whole node registry loads at startup so the first
> `list_capabilities` is immediate.

### Connect over HTTP (remote / web / hosted clients)

```bash
npm run start:http          # → http://127.0.0.1:3017/mcp  (Streamable HTTP, JSON)
# port/host via --http=PORT or env MCP_HTTP_PORT / MCP_HTTP_HOST
```

Point any MCP‑over‑HTTP client at `http://127.0.0.1:3017/mcp`. The transport is
*stateless* but the engine session persists in the process, so drive it
sequentially — one process = one AnCiR session (`core` is a singleton).

### Multi‑session isolation (many concurrent sessions)

Because `core` is a module singleton, true concurrent isolation is
**process‑per‑session**: `SessionManager` (`src/sessionManager.js`) spawns one worker
process (`src/worker.js`) per session id, each with its own engine, and routes calls
to it over Node IPC (idle workers are reaped). This is the foundation for a
multi‑tenant backend (e.g. an app where each user's request builds its own session):

```js
import { SessionManager } from './src/sessionManager.js';
const mgr = new SessionManager();
await mgr.call('user-42', 'create_session', { id: 'user-42' });
await mgr.call('user-42', 'import_data', { columns: [/* … */] });
const fit = await mgr.call('user-42', 'run_table_process', { name: 'Cosinor', args: { xIN: 0, yIN: [1] } });
const { json } = await mgr.call('user-42', 'export_session');
```

The worker exposes the same operations as the MCP tools (`create_session`,
`import_data`, `list_columns`, `run_table_process`, `add_column_process`, `add_plot`,
`render_plot`, `export_session`, `describe_capabilities`).

## Test it with an LLM

The server speaks MCP over stdio, so any MCP‑capable client works. Three quick paths:

**1. Claude Code (CLI)** — fastest loop, no GUI config:

```bash
claude mcp add ancir -- npm --prefix /absolute/path/to/AnCiR_next/mcp start
claude            # then ask: "Use the ancir tools to list capabilities,
                  #  import a 48h 24h-period cosine, fit a cosinor, and export the session"
```

**2. Claude Desktop** — edit `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`) with the
`mcpServers` block above, then restart Claude Desktop. The `ancir` tools appear
under the 🔌 menu.

**3. Cursor / VS Code / Cline / Goose** — add the same `mcpServers` block to the
client's MCP config.

### Non‑Claude LLMs (OpenAI, Gemini, local models)

MCP is model‑agnostic. Two ways to use AnCiR with other LLMs:

- **MCP‑host apps** that run any model: **LM Studio** (local models) and **Gemini
  CLI** spawn the stdio server exactly like Claude Desktop (same `mcpServers` block,
  command `npm start`). For remote/web/hosted clients, run `npm run start:http` and
  point them at `http://127.0.0.1:3017/mcp`.
- **The bundled agnostic client** (`test/agnostic-client.mjs`) drives the tools from
  any **OpenAI‑compatible** endpoint via raw tool‑calling — it translates the MCP
  tool schemas into OpenAI `tools` and runs a tool loop. With no key it does a
  **dry run** (prints the schemas + runs a scripted sequence) so you can verify the
  bridge without secrets:

  ```bash
  npm run agnostic                                              # dry run, no key
  OPENAI_API_KEY=sk-...                       npm run agnostic  # OpenAI
  OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_API_KEY=ollama \
    MODEL=llama3.1                            npm run agnostic  # Ollama (local)
  OPENAI_BASE_URL=http://localhost:1234/v1 OPENAI_API_KEY=lm-studio \
    MODEL=your-model                          npm run agnostic  # LM Studio (local)
  OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai \
    OPENAI_API_KEY=$GEMINI_API_KEY MODEL=gemini-2.0-flash npm run agnostic  # Gemini
  ```

### A good first prompt to verify everything

> "Call `list_capabilities`. Then `create_session`, `import_data` with a time
> column `0..47` and a signal `10 + 5·cos(2π·t/24)`, run `run_table_process`
> with `Cosinor` (fixedPeriod 24), and `export_session` to `/tmp/llm-test.json`.
> Report the recovered MESOR, amplitude and R²."

Expected: MESOR ≈ 10, amplitude ≈ 5, R² ≈ 1.0, and `/tmp/llm-test.json` opens in
the AnCiR GUI (drag‑drop / Load Session) with the cosinor node already wired.
For a non‑smoke check, run `node test/smoke-client.mjs` first — it drives the same
flow programmatically and prints `SMOKE OK ✅`.

## Prototype: natural-language → AnCiR app (`app/`)

A minimal backend that closes the loop **NL prompt → AnCiR session → opens in the
GUI**. Each `POST /build` spawns an isolated MCP server, an agent builds the session,
exports it, hosts it CORS-open, and returns an `ancirUrl` of the form
`<ANCIR_BASE>/?loadFromURL=<sessionUrl>` — which AnCiR already auto-loads on startup.

**Bring-your-own model.** The chat page has a **Model settings** panel (base URL, API
key, model, with provider presets) stored in the browser's localStorage and sent per
request as `{ llm: { baseUrl, apiKey, model } }` — so users drive the build with
**their own** OpenAI-compatible endpoint (OpenAI / Groq / NVIDIA / Ollama / LM Studio)
and the deployer never pays for inference. The key is used only for that request and is
**never logged or stored**. A request with no `llm` falls back to the server's
`OPENAI_*` env (if set), then to the deterministic scripted planner.

```bash
npm run app            # backend on http://127.0.0.1:5273  (open / for a chat box)
npm run app:test       # round-trip: NL → session JSON → served URL (no GUI, no key)
npm run app:e2e        # full proof: builds, opens the session in a running AnCiR via
                       # Playwright, screenshots it (needs `npm run dev` on :5173)
```

Env (all optional): `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`MODEL` — a **server default**
used only when a request brings no BYO config; `ANCIR_BASE_URL`
(default `http://localhost:5173`), `APP_PORT` (default 5273), `APP_HOST`.

> This is a prototype kept inside the MCP workspace; for the monetised product it
> would graduate to its own repo, calling the MCP / `SessionManager` as a service and
> adding auth, billing, quotas, and LLM-cost metering. See the design note in
> `ClaudeNotes/AnCiR/2026-06-16-ancir-nl-session-app-design.md`.

## Status / roadmap

**Working & tested:**

- Session lifecycle, data import, column listing.
- **All 22 table‑process analyses** via the generic registry path
  (`run_table_process` + live `list_capabilities`), plus the cosinor convenience tool.
- **All 9 column transforms** (`add_column_process`).
- **All 9 plot types**: `add_plot` (embed in session) and **`render_plot` → real
  PNG/SVG** via headless Chromium.
- AnCiR‑compatible session export with the analysis/transform/plot nodes embedded.
- **Dynamic outputs auto‑seeded** for every process (per‑Y/segment/category keys),
  and **scalar `stats`** surfaced for column‑less processes (GroupComparison).
- **Two transports:** stdio and Streamable HTTP. **Model‑agnostic client** for any
  OpenAI‑compatible LLM.
- **Multi‑session isolation** via process‑per‑session (`SessionManager`).

Validated by `npm test` (engine + registry + transforms/plots + dynamic‑out, 20
tests) and the end‑to‑end smokes: `smoke` (stdio), `smoke:http` (HTTP),
`smoke:render` (PNG/SVG via the GUI export path), `smoke-multisession` (isolation),
`agnostic` (tool bridge).

**Next:**

- **Render whole sessions.** `render_plot` rebuilds the referenced columns in the
  browser; a variant could load a full exported session (analyses + multiple plots)
  and rasterise each.
- **Stateful HTTP routing** to `SessionManager` (one MCP `mcp-session-id` → one
  worker), so a single HTTP endpoint serves many isolated tenants.
- **Worker pre‑warming** — each worker boots vite‑node + the registry (a few
  seconds); a warm pool would cut first‑call latency for the multi‑tenant case.

> ⚠️ `render_plot` needs a browser: it reuses the app's Playwright + Chromium. In a
> sandbox where the Chromium binary can't be downloaded, `render_plot` is
> unavailable but every other tool (analyses, transforms, `add_plot`, export) works
> headlessly without a browser.

## In‑process rendering — why a browser is required

`render_plot` uses a real browser deliberately. Two in‑process (vite‑node /
happy‑dom) attempts both hit framework walls: client `mount()` is unavailable under
SSR, and `svelte/server`'s `render()` trips `effect_orphan` on the plots' `onMount`
usage. The plot components are designed to run in a DOM with a full lifecycle, so
the faithful path is Chromium driving the actual component (Vite serves it in client
mode; `src/render/mount.js` rebuilds the columns + plot and mounts it; Playwright
screenshots the `<svg>`).
