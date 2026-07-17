# AGENTS.md — ancir-mcp

Agent-oriented map of this workspace. `ancir-mcp` exposes **AnCiR's real headless
engine** to LLMs so an agent can build a chronobiology analysis **session** (data +
analyses + plots) and export AnCiR-compatible `session.json` that opens in the GUI.

**Read the file that matches your task. Terse on purpose.**

| I want to… | Read |
| --- | --- |
| Build a session with **no engine** (the product path) | [`src/emit/`](src/emit/) + [`worker/README.md`](worker/README.md) |
| Generate MCP **tool calls** that build a valid session | [`docs/tool-contract.md`](docs/tool-contract.md) |
| Understand the code / **extend** the engine or app | [`docs/architecture.md`](docs/architecture.md) |
| Work on the **NL→session Worker** (BYO model) | [`worker/README.md`](worker/README.md) |
| Work on the **legacy Express backend** (engine-driven) | [`docs/app-backend.md`](docs/app-backend.md) |
| **Run or deploy** it | [`docs/deploy.md`](docs/deploy.md) |
| Human overview + full CLI | [`README.md`](README.md) |

## Two paths (don't conflate them)

**A. Static emission — the product.** No engine at all: an LLM emits one JSON *draft*,
`src/emit/normalizer.js` turns it into a session, and the **AnCiR SPA computes the analyses in
the browser** on load. Pure and portable ⇒ it runs in a Cloudflare Worker (`worker/`), so the
product needs no VM. See the ADR `2026-07-15-static-session-emission`.
- `src/emit/schema.js` + `session-schema.generated.json` — node facts, **registry-derived**
  (`gen-schema.js`); regenerate after any AnCiR registry change or the prompt goes stale.
- `src/emit/generators.js`, `dynamicOut.js` — pure ports of AnCiR code, held honest by
  **parity tests** that diff them against the originals. Never "improve" the maths there.

**B. The engine (MCP) — the agent power-path.** Runs AnCiR's real functions, so it can report
live results; needs `vite-node` (RAM). Optional.
1. **Engine** — `src/engine/session.js`: `AncirSession` over AnCiR's real `core` store; reuses
   `$lib/**` via `vite-node`. **`core` is a module singleton ⇒ one session per process.**
2. **Transport** — `src/server.js`: the MCP server (stdio **and** Streamable HTTP).
   `src/worker.js` + `src/sessionManager.js` give process-per-session isolation.
   ⚠️ **`src/worker.js` is NOT `worker/`** — the former is a child process for session
   isolation; the latter is the Cloudflare Worker of path A.
3. **App** — `app/`: an Express backend driving 1–2 from a prompt. **Superseded by `worker/`**
   for the product; kept for local use/reference (it still needs a VM to host).

## The 9 tools
`list_capabilities`, `create_session`, `import_data`, `list_columns`,
`run_table_process`, `add_column_process`, `add_plot`, `render_plot`, `export_session`.
(There is intentionally **no** `run_cosinor` — use `run_table_process` with name
`Cosinor`, which persists the node **and** returns the fit.)

## Non-negotiable rules (single source: [`app/prompts/tool-rules.md`](app/prompts/tool-rules.md))
Canonical, LLM-loaded. At a glance:
- **`run_table_process.args` is FLAT** — input-column fields (`xIN`, `yIN`, …) AND
  params together at the top level. Never nest under `inputs`/`params`.
- **Reference columns by NAME** (e.g. `"time_0"`), not numeric id. Read names from a
  tool result's `outputs[].name` or from `list_columns`.
- **Don't hand-type long numeric arrays.** Generate data with `SimulatedData` /
  `SequenceColumn` / `Random`. `import_data` is only for small explicit arrays.
- **Cosinor/FitFunction:** set `useFixedPeriod:true` + `fixedPeriod` for a known rhythm.
  Free-period is unreliable on a time axis.
- **Get exact per-analysis arg shapes from `list_capabilities` at runtime** — static
  docs go stale (22 analyses). Dynamic `out` keys are auto-seeded; don't pass `out`.
- **`core` is a singleton** — one session per process; use `SessionManager` for many.

Full detail + worked examples in [`docs/tool-contract.md`](docs/tool-contract.md).

## Verify before claiming done
`npm test` (vitest engine, 20) · `npm run app:units` (node:test, 15) ·
`npm run smoke` / `smoke:http` / `smoke:render` · `npm run app:test` / `app:byo`.
