# Architecture & invariants

For agents modifying/extending the engine or app. `mcp/` is a standalone repo that
imports AnCiR's real `$lib/**` (the parent app) via a Vite runtime.

## File map
```
src/
  engine/
    session.js       AncirSession: importColumns, runTableProcess, addColumnProcess,
                     addPlot, renderPlotToFiles, exportSession; describeCapabilities;
                     resolveColRef (name→id), synthesizeDynamicOut, discardTp
    bootstrapDom.js  happy-dom shim so AnCiR's `core` loads outside a browser
    renderPlot.js    headless PNG/SVG via Vite dev server + Playwright/Chromium
  server.js          MCP server: registers tools; stdio + Streamable HTTP transports
  worker.js          one AncirSession over Node IPC (per-session process)
  sessionManager.js  spawns/routes/reaps workers → many isolated sessions
  render/            index.html + mount.js: browser page render_plot mounts into
app/                 NL→session backend (see app-backend.md)
test/                vitest engine tests + .mjs smokes
vite.config.js       $lib alias + svelte compile + fs.allow(repoRoot)
```

## Data flow (build a session)
`import_data`/`SimulatedData` → columns in `core.data` (+ `core.rawData`) → a
`TableProcess`/`Plot` node in `core.tableProcesses`/`core.plots`, wired to columns →
`outputCoreAsJson()` serialises the whole `core` → the file opens in the GUI
(`?loadFromURL=` auto-loads).

## Invariants & gotchas (each cost real debugging)
- **`core` is a module singleton** → **one session per process.** Multi-session =
  process-per-session (`SessionManager`), not in-process.
- **Load the registry at startup, not lazily.** `vite-node` tears down its transform
  server after the top-level run; a lazy `loadTableProcesses()` inside a tool handler
  fails with `ERR_CLOSED_SERVER`. `server.js` does `await ensureRegistry()` at top level.
- **Failed/invalid `run_table_process` must not leave a node.** `discardTp` removes the
  node + its columns on throw or `valid:false`, else a broken node (e.g. SimulatedData
  with no `startTime`) crashes the GUI at load ("Rebuilding plot…").
- **Prewarm plot data-wrapper `customName` before export** (mirrors nodeCatalog's
  `prewarmWrapperNames`), else reading `name` during the export graph-build mutates
  state and silently blanks canvas edges.
- **Column ids:** `AncirSession.importColumns` assigns explicit ids; the shared
  `Column` counter bumps past them, so TP output columns never collide.
- **`describeCapabilities()` is derived live** from the loaded registry (`appConsts`) —
  it has no MCP coupling and is the single source for the tool/param catalogue. (It is
  liftable into `$lib` for an in-browser agent; see the in-app note in the vault.)
- **`render_plot` needs a browser.** In-process rendering is impossible (client
  `mount()` unavailable under SSR; `svelte/server` `render()` trips `effect_orphan`), so
  it uses Vite + Playwright/Chromium. Not needed to build/export a session.
- **`run_table_process` result surfacing:** `fit` when the func returns `y_results`
  (Cosinor/FitFunction); `stats` when the result has `comparisons` (GroupComparison,
  which now also emits statistic/pvalue columns) or produced no columns.

## Engine input coercions (why generation is forgiving)
`runTableProcess` before running: flattens a stray `params`/`inputs` wrapper; resolves
`columnIdFields` (name→id via `resolveColRef`); coerces a scalar array-field to a
1-element array; auto-seeds `out` (fixed template + `synthesizeDynamicOut`).

## Adding a new analysis/plot node
Nodes live in the **parent app** (`../src/lib/tableProcesses|plots|processes/*.svelte`),
statically globbed at build time — you cannot add a node type purely inside `mcp/`. Use
the repo's **`ancir-new-node` skill** (maps every file + the silent-failure gotchas).
Once a node exists in `$lib`, it appears automatically in `list_capabilities` and is
callable via `run_table_process`/`add_plot` — no MCP change needed.

## Registry / capability derivation
`loadTableProcesses()`/`loadProcesses()`/`loadPlots()` glob `$lib` and read each module's
`definition` export (`func`, `defaults` incl. `out` template, `columnIdFields`,
`xOutKey`/`yOutKeyPrefix`, `nodeSpec`). `describeCapabilities()` turns those into the
agent-facing catalogue.
