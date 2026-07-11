---
name: ancir-new-node
description: >-
  Use this whenever you are adding a new node to the AnCiR app (this repo) —
  a new analysis, table-process, column-process/transform, or "make a node
  that…". It maps every file to touch (component, metadata, coverage-test entry,
  output-column plumbing, tests) and the gotchas that fail silently or only in
  the browser (free-node output creation, per-Y reuse-on-replace). Trigger on
  "add/create a new node", "new table process", "new process/transform",
  "new analysis node", or wiring a new computation into the node graph — even if
  the user doesn't say the word "node".
---

# Adding a new AnCiR node

AnCiR is a Svelte 5 dataflow app. A **node** is one of two kinds:

- **Column-process** (`src/lib/processes/*.svelte`) — an inline transform on ONE
  column's data: `func(inputArray, args) -> outputArray`. E.g. Add, Multiply,
  FilterByOtherCol, RemoveTrend. Simplest kind.
- **Table-process** (`src/lib/tableProcesses/*.svelte`) — a standalone node with
  its own input refs (`xIN`/`yIN`/…) that produces one or more **output columns**
  in `core.data`. `func(args) -> [result, valid]`. E.g. BinnedData, Cosinor,
  Sort, Split.

Nodes are **auto-registered** by a glob import — you do NOT edit any map file.
Dropping a `.svelte` with a `definition` export into the right folder registers
it. The MCP server also picks it up automatically: inputs derive from
`columnIdFields` and fixed outputs from `defaults.get('out')` — see Optional
step 10. The one thing that fails LOUDLY is the coverage test
(`allNodesCoverage.test.js`), which requires a catalog entry and a valid
sample run.

## Step 0 — decide the shape (drives everything)

Ask/infer, then pick the exemplar to copy:

| Question | If yes → | Copy exemplar |
|---|---|---|
| Inline transform of a single column? | **column-process** | `processes/Add.svelte` |
| Standalone node, one output column? | table-process, single-out | `tableProcesses/ColumnFunctions.svelte` or `Sort.svelte` |
| One output **per Y input** (yIN is "many")? | table-process, **multi-Y** | `tableProcesses/BinnedData.svelte` (uses `useMultiYTP`) |
| Outputs whose keys depend on data/params (segments, categories, groups)? | table-process, **dynamic-out** | `tableProcesses/Split.svelte` |

Match the closest exemplar rather than writing from scratch — the `<script module>`
shape, the `definition` object, and the output-column reconcile are fiddly.

## Required — loud gates (build/tests fail without these)

1. **Create the component** `src/lib/<processes|tableProcesses>/<Name>.svelte`.
   The `<script module>` MUST export a `definition`:
   - `displayName` (string), `defaults` (a `Map` of `key -> { val }`), `func`
     (the pure compute fn), and `nodeSpec` (`{ id, inputs[], outputs[] }`).
   - Table-processes also set `columnIdFields` (`{ scalar: ['xIN'], array: ['yIN'] }`),
     and `xOutKey` / `yOutKeyPrefix` when they have an X output / per-Y outputs.
   - A missing `definition` fails **silently** (a `console.warn`, node just never
     appears) — so always verify it shows in the palette.
   - Use the shared table-process helpers instead of hand-rolling: read-time
     `yIN` normalization + session back-compat via `tpArgHelpers.js`
     (`normalizeYInputs` / `migrateLegacyYIN` / `fillDefaults`), and output-column
     writes via `outputColumns.js` (`writeOutputColumn` / `writeXOutput`).
   - See `references/component-anatomy.md` for the exact shapes, the shared
     helpers, and a minimal copy-paste skeleton for each kind.

2. **Add a catalog entry** in `src/lib/_demos/nodeCatalog.js`
   (`TP_SPECS` for a table-process, `PROCESS_SPECS` for a column-process).
   This is the **loud gate**: `allNodesCoverage.test.js` fails if a registered
   node has no catalog spec, and also asserts `func` returns `valid === true`
   for the sample `args`. So the sample args must be a genuinely valid run.
   - Table-process spec: `{ name, inputs: [T('number', SAMPLE.x), …], args: (ids) => ({ xIN, yIN: [y], …params, out: { <xKey>: -1 } }) }`.
     Per-Y `out` keys are auto-seeded by the `TableProcess` constructor — only
     seed the X/scalar output key.
   - Set `isAsync: true` if `func` returns a Promise; `validAt` if the valid flag
     isn't at index 1.

Run `npx vitest run src/lib/_demos/allNodesCoverage.test.js` — it must pass.

3. **Generate the gallery demo** (second loud gate — `demos.validate.test.js`
   requires every node to be showcased). Two parts:
   - Generate the demo session file from the catalog spec:
     `GEN_DEMOS=1 GEN_ONLY=<Name> npx vitest run src/lib/_demos/generateTPDemos.svelte.test.js`
     (writes `static/sessions/demos/demo-tp-<name>.json`). Use
     `generateProcessDemos.svelte.test.js` for a column-process.
   - Add an entry to `static/sessions/demos/index.json` (it is NOT auto-updated):
     `{ id, name, family, description, url: "sessions/demos/demo-tp-<name>.json",
     kind: "tableProcess" | "process", showcases: ["<Name>"], keywords }`, and
     bump `count`. `demos.validate.test.js` asserts `showcases` covers every map
     key, so a missing entry fails loudly.

## Required — always do these (no automated gate, but mandatory)

4. **Unit test** `src/lib/<…>/<Name>.test.js` — mock `getColumnById`, call the
   **pure `func`** with synthetic args, assert the math + the `valid` flag. No
   Svelte/rendering. Copy `tableProcesses/Sort.test.js` or `processes/Add.test.js`.
   For non-trivial math, put the algorithm in a pure `src/lib/utils/<x>.js` with
   its own test (e.g. `utils/interpolate.js`), and have the node call it.

5. **Python parity** (analytical/numeric nodes) — the JS engine is the source
   of truth; add a Python port so the math is cross-checked independently.
   Purely presentational nodes (layout/UI-only, no numeric compute) may skip
   this — note "parity N/A" in the commit message instead. See
   `references/parity-mcp-demos.md` for the full workflow; in short:
   - Author the Python port of `func` in `tools/ancir_runtime.py`.
   - Register the JS function in `PURE_UTIL_FNS`
     (`src/lib/_parity/emitParity.svelte.test.js`) if it's a pure util;
     otherwise make sure the node's `tp_*`/`compute*` path is covered by the
     existing table-process/plot-compute fixture machinery.
   - Add a fixture (`kind: "pureUtil"`, `"tableProcess"`, or `"plotCompute"`)
     to `tools/parity/fixtures.json` with a matching `pyFunc`.
   - Run `GEN_PARITY=1 npx vitest run src/lib/_parity/emitParity.svelte.test.js`
     then `tools/.venv/bin/python -m pytest tools/test_parity.py -q` — both
     must pass before you're done.

6. **Docs — node notes + Handbook.** Every node needs a description and a
   demo-session note so both the in-app palette and the external Handbook stay
   accurate:
   - Add/update the `src/lib/core/nodeMeta.js` entry's `description` field
     (`['<Name>', { family, nodeIcon, description }]` — create the entry now
     if you haven't already done Step 7 below; family/nodeIcon can be filled
     in at the same time).
   - Add a note for the node in `src/lib/_demos/nodeNotes.js` (this is what
     shows up embedded in the gallery demo session generated in Step 3).
   - Regenerate the manifest:
     `GEN_MANIFEST=1 npx vitest run src/lib/_demos/generateNodeManifest.svelte.test.js`
     (writes `static/nodes.json`).
   - Copy the manifest into the Handbook repo (a separate repo that bundles it
     statically rather than fetching it live):
     `static/nodes.json` →
     `/Users/dcum007/Documents/Circadian/RACiR/Paper/Handbook/Handbook/src/lib/nodes.json`.
     Optionally add curated prose for the node to that repo's
     `src/lib/nodeReference.json`.
   - Validate the Handbook build from inside the Handbook repo:
     `npx vite build` — **never `npm run build`** there, it FTP-deploys to
     production.

## Recommended (silent failures — do them)

7. **Metadata** — add an entry to `src/lib/core/nodeMeta.js`:
   `['<Name>', { family, nodeIcon, description }]`. The `description` field is
   **required** (see Step 6 above); `family`/`nodeIcon` here remain
   recommended polish — without them the node still works but shows under
   family **"Other"** with a generic **gear** icon. Families drive the palette
   section: `Sources`, `Arithmetic`, `Filtering`, `Smoothing`, `Binning`,
   `Fitting`, `Analysis`, `Transform`, `Plots`.

8. **Output columns (table-processes only) — the #1 footgun.** Output columns
   only appear when the node writes valid ids into `p.args.out[key]`. On the
   current free-node model there is NO `p.parent`. WRITING data into an existing
   output column is `writeOutputColumn`/`writeXOutput`; CREATING/reconciling
   which columns exist is the separate concern below. Follow
   `references/output-columns.md`:
   - Multi-Y → use the `useMultiYTP(p, '<yPrefix>_', '<name>_')` composable
     (`syncYColumns` / `initYColumns`). Do not hand-roll it.
   - **Scalar-metric ports** (a scalar result per y input — R², p-value, peak
     period): expose them as out-keys holding ONE VALUE PER Y in yIN order, mark
     the nodeSpec output entry `metric: true` (drives the node's Metrics section
     + target-dot styling), and reconcile creation with
     `syncMetricOutColumns(p, keys, managedPredicate)` from
     `tableProcesses/metricOutputs.js` (onMount backfill + microtask-deferred
     effect for key-set changes). Engine writes go through `writeOutputColumn`
     like any output — Cosinor/TrendFit are the reference.
   - Bespoke/dynamic outputs → gate creation on **`isCommitted()`** (the node is
     in `core.tableProcesses`), NOT on `p.parent`. Guard each
     `p.parent.columnRefs` write with `if (p.parent)`.
   - **Reuse-on-replace:** when a Y input is swapped (e.g. a node is spliced
     upstream), transfer the old output column to the new key instead of
     delete-and-recreate, so downstream consumers stay wired. `useMultiYTP` and
     `Split` already do this — copy the pattern for a bespoke reconcile.
   - **NEVER call `new Column()` synchronously inside a `$effect`/`$derived`.** A
     Column has `$derived` fields (`getDataHash`, …); a `$derived` created while an
     effect is the active reaction becomes **inert** when that effect re-runs
     (Svelte `derived_inert`), so a *reused* output column reads stale/empty data
     and stops plotting — with only a console warning. `untrack()` does NOT fix
     this (it stops dependency tracking, not ownership). The reconcile `$effect`
     that reacts to `yIN`/segment changes must **defer** creation out of the
     effect so there is no active reaction when the column is built:
     ```js
     $effect(() => {
       p.args.yIN;                 // track the dependency
       if (!mounted) return;
       queueMicrotask(() =>         // runs after the effect flush → root-owned
         untrack(() => { if (syncYColumns()) recompute(); })
       );
     });
     ```
     Creating columns in `onMount` or an event handler is already fine (no active
     effect). Every reconcile-in-effect node (`Split`, all `useMultiYTP` consumers,
     `MovingAnalysis`, `RhythmicityAnalysis`, `CollectColumns`, `LongToWide`,
     `StoredValueGroup`) now uses this microtask-defer pattern.

## Optional

9. **Icon** — add `src/lib/icons/<icon-name>.svg` and reference it as `nodeIcon`
   in nodeMeta. Two easy-to-miss details:
   - Match the dominant **line style** — `viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="2"`. A solid/Font-Awesome (filled) icon
     colours via `fill` and renders a different grey from the line icons in the
     palette; prefer a stroke outline so it matches.
   - **Add the icon name to the `KNOWN_ICONS` allow-list in
     `src/lib/components/workflow/NodePalette.svelte`.** The palette only renders
     an icon that's in that Set — otherwise it silently falls back to a generic
     glyph. (Skip both if you reuse an existing icon name.)
10. **MCP** — nothing to do. `mcp/src/engine/session.js`'s
    `describeCapabilities()` walks the table-process registry automatically:
    inputs derive from `columnIdFields` (`{ scalar, array }`, Step 1), fixed
    outputs from the node's `defaults.get('out')` template (also Step 1).
    There is nothing under `mcp/` to edit — just make sure new inputs are
    listed in `columnIdFields` and fixed outputs are seeded in `defaults.out`.
    See `references/parity-mcp-demos.md` for detail.

## Verify before claiming done

- The two loud gates + the node's own tests:
  `npx vitest run src/lib/_demos/allNodesCoverage.test.js src/lib/_demos/demos.validate.test.js src/lib/<…>/<Name>.test.js`
  then the full suite (`npx vitest run`).
- For a numeric node, also confirm the Python parity fixture passes
  (`tools/.venv/bin/python -m pytest tools/test_parity.py -q`) and that the
  Handbook build succeeds (`npx vite build` in the Handbook repo) — Steps 5
  and 6 are required, just not gated by the JS test suite.
- Then **ask the user to browser-check** (the preview is flaky and node
  reconcile only runs while the node is expanded): add the fresh node from the
  palette, wire it, confirm output columns appear, and — for a table-process —
  splice a node upstream and confirm a downstream plot stays connected.

## Gotchas recap

- Registration is automatic (glob) — never edit `tableProcessMap.js` /
  `processMap.js`.
- `allNodesCoverage.test.js` and `demos.validate.test.js` are the only loud
  gates; the unit test, Python parity, and docs (Steps 4-6) are required by
  policy but nothing fails the build if you skip them — review for them.
- `func` for a table-process returns `[result, valid]`; a column-process returns
  a plain array.
- Never gate output creation on `if (p.parent)` — free nodes have no parent.
- Per-Y / segment / category outputs must **reuse on replace**, or splicing a
  node upstream orphans downstream wiring.
- **Never `new Column()` inside a `$effect`/`$derived`** — defer creation with
  `queueMicrotask` (or do it in `onMount`/a handler). A column built under a live
  effect has inert `$derived` fields after the effect re-runs (`derived_inert`) →
  stale/empty output that only warns in the console. `untrack()` does not help.
- Don't re-hand-roll `yIN` normalization, session back-compat, or the
  output-write dance — import the shared helpers (`tpArgHelpers.js`,
  `outputColumns.js`); Cosinor is the reference for both.
