# Python parity, MCP, Handbook sync, and demos

## MCP — automatic, nothing to do

`mcp/src/engine/session.js` `describeCapabilities()` iterates
`appConsts.tableProcessMap` and turns every registered table-process into an
agent-callable analysis (id, displayName, family, inputs from `columnIdFields`,
params from `defaults`, outputs). Since your node auto-registers via the glob,
the MCP server exposes it at startup with no manual step. Dynamic outputs are
handled by `synthesizeDynamicOut()`. Just make sure `columnIdFields`,
`displayName`, and `description` (nodeMeta) are set so the agent-facing schema is
sensible.

## Python parity — required for analytical/numeric nodes

The JS engine is the source of truth; the Python port must match within
tolerance. This is a **required** step (SKILL.md Step 5) for any node that
does real numeric compute (fitting, statistics, transforms, binning, …).
Purely presentational nodes (layout/UI-only, no numeric compute) may skip it
— note "parity N/A" in the commit message instead of adding a fixture.

Files:
- `tools/parity/fixtures.json` — the test specs.
- `src/lib/_parity/emitParity.svelte.test.js` — JS side (emits inputs + JS results).
- `tools/ancir_runtime.py` — the Python implementations.
- `tools/test_parity.py` — the pytest runner.

Workflow:
1. Add a fixture to `fixtures.json` with deterministic, seeded input:
   ```json
   {
     "id": "tp-mytp-basic",
     "kind": "tableProcess",
     "jsName": "MyTP",
     "pyFunc": "mytp",
     "generate": { "type": "rhythm", "n": 168, "period": 24, "seed": 11,
                   "refs": { "x": "t", "y": "y" } },
     "args": { "xIN": "@t", "yIN": ["@y"], "param1": "mean", "out": { "resultx": -1 } },
     "compareOutputs": ["resultx", "resulty"]
   }
   ```
   `@ref` tokens resolve to generated column ids. `generate.type` is `rhythm` /
   `linear` / `groups` (see existing fixtures).
2. Implement `mytp(args, columns_index)` in `ancir_runtime.py` matching the JS
   logic exactly (mind summation order, seeded RNG, etc.).
3. Emit JS results, then run pytest:
   ```bash
   GEN_PARITY=1 npx vitest run src/lib/_parity/emitParity.svelte.test.js
   tools/.venv/bin/python -m pytest tools/test_parity.py -q
   ```
   A mismatch beyond `tolerance` (default ~1e-6) fails loudly.

## Handbook sync — REQUIRED (docs step)

The Handbook is a **separate repo**
(`/Users/dcum007/Documents/Circadian/RACiR/Paper/Handbook/Handbook`) that
bundles a copy of `static/nodes.json` statically (imported at build time,
not fetched live from GitHub). It has its own Node Reference page that reads
directly from that bundled copy, so a new node's metadata (family, icon,
description) doesn't show up there until you sync it. This is SKILL.md Step 6.

1. In this repo, set `src/lib/core/nodeMeta.js`'s `description` and add a note
   in `src/lib/_demos/nodeNotes.js` for the node.
2. Regenerate the manifest:
   ```bash
   GEN_MANIFEST=1 npx vitest run src/lib/_demos/generateNodeManifest.svelte.test.js
   ```
   This writes `static/nodes.json`.
3. Copy the manifest into the Handbook repo:
   ```bash
   cp static/nodes.json /Users/dcum007/Documents/Circadian/RACiR/Paper/Handbook/Handbook/src/lib/nodes.json
   ```
   Optionally add curated prose for the node to that repo's
   `src/lib/nodeReference.json` (hand-written, not generated).
4. Validate the Handbook build **from inside the Handbook repo**:
   ```bash
   npx vite build
   ```
   **Never run `npm run build` in the Handbook repo** — that script FTP-deploys
   to production. `npx vite build` only compiles locally and is safe to run
   as a check.

## Demos / gallery — REQUIRED (second loud gate)

`demos.validate.test.js` asserts the gallery `index.json` `showcases` cover every
process + table-process map key, so a new node needs BOTH a generated demo file
AND an `index.json` entry (see SKILL.md step 3). Two parts:

1. Generate the demo session from your `nodeCatalog.js` spec:
   ```bash
   # table-process:
   GEN_DEMOS=1 GEN_ONLY=<Name> npx vitest run src/lib/_demos/generateTPDemos.svelte.test.js
   # column-process:
   GEN_DEMOS=1 GEN_ONLY=<Name> npx vitest run src/lib/_demos/generateProcessDemos.svelte.test.js
   ```
   This writes `static/sessions/demos/demo-tp-<name>.json` (or `demo-process-…`).
   The generator does NOT touch `index.json`.
2. Add the manifest entry to `static/sessions/demos/index.json` and bump `count`:
   ```json
   { "id": "tp-<name>", "name": "<Display>", "family": "<Family>",
     "description": "…", "url": "sessions/demos/demo-tp-<name>.json",
     "kind": "tableProcess", "showcases": ["<Name>"], "keywords": "…" }
   ```
   Edit the JSON minimally (don't reformat the whole file — e.g. a Python
   `json.dump(..., ensure_ascii=False, indent=2)` re-escapes existing non-ASCII
   and churns the diff; prefer inserting the one object).

(Separately, `index.json` can also hold a raw dataset CSV example —
`kind: 'dataset'`, `url` to a CSV served under `static/`, routed through the
URL-import flow — but that's unrelated to node demos.)
