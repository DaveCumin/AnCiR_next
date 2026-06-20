# JS ↔ Python parity harness

Cross-checks the AnCiR **JavaScript engine** against the **Python port**
(`ancir_runtime.py`): the same analysis, run on the same input in both languages,
must produce the same numbers. This guards against the "two sources of truth"
drift risk — if someone changes a JS analysis without matching the Python port
(or vice versa), a fixture starts failing.

Scope: **per-module** parity (one table/column process at a time). Session-level
parity through `ancir_to_python.py` is a separate, not-yet-built layer (see
*Limitations* below).

## Pieces

| File | Role |
|------|------|
| `tools/parity/fixtures.json` | Language-neutral cases: process + args + input data + which outputs to compare. The single source both sides read. |
| `src/lib/_parity/emitParity.svelte.test.js` | JS side. Runs each fixture through the real JS engine, writes `tools/parity/js_results.json`. Gated by `GEN_PARITY=1`. |
| `tools/test_parity.py` | Python side. Runs each fixture through `ancir_runtime.py` and asserts it matches `js_results.json` within `tolerance`. |
| `tools/parity/js_results.json` | Generated JS outputs (git-ignored; regenerate with the emitter). |

## Running it

One-time Python env:

```bash
python3.12 -m venv tools/.venv
tools/.venv/bin/pip install -r tools/requirements.txt
```

Each run is two steps — regenerate the JS outputs, then compare in Python:

```bash
# 1. JS side -> tools/parity/js_results.json
GEN_PARITY=1 npx vitest run src/lib/_parity/emitParity.svelte.test.js

# 2. Python side: compare to the JS outputs
tools/.venv/bin/python -m pytest tools/test_parity.py -q
# (or: tools/.venv/bin/python tools/test_parity.py  for a plain PASS/FAIL list)
```

If `js_results.json` is missing, the Python test tells you to run step 1.

## How compute runs headlessly

The JS emitter installs a `ThrowOnPost` fake worker via `setWorkerFactory`, which
triggers the worker pool's documented synchronous fallback (`workerPool.js`). So
worker-dispatched analyses (e.g. Cosinor's `cosinor.fitMany`) run on the main
thread and finish before outputs are read — deterministic, no hangs.

## Adding a fixture

Append to `tools/parity/fixtures.json`, then re-run both steps. No code changes.

**Column process** (pure array → array):

```json
{
  "id": "col-removetrend",
  "kind": "columnProcess",
  "jsName": "RemoveTrend",       // JS registry key = the .svelte FILE name
  "pyFunc": "removetrend",       // key in ancir_runtime COLUMN_PROCESS_MAP
  "input": [1, 2, 3, 4, 5],
  "args": { }
}
```

**Table process** (analysis with output columns):

```json
{
  "id": "tp-smootheddata",
  "kind": "tableProcess",
  "jsName": "SmoothedData",      // JS registry key (file name)
  "pyFunc": "smootheddata",      // Python runs tp_<pyFunc>
  "inputs": [
    { "ref": "t", "type": "number", "values": [/* ... */] },
    { "ref": "y", "type": "number", "values": [/* ... */] }
  ],
  "args": { "xIN": "@t", "yIN": ["@y"], "out": { } },
  "compareOutputs": ["<canonical output key>"]
}
```

**Stats analysis** (result object, not output columns) — use `tableProcessResult`
and list the comparison fields to check:

```json
{
  "id": "tp-groupcomparison-ttest",
  "kind": "tableProcessResult",
  "jsName": "GroupComparison",
  "pyFunc": "groupcomparison",
  "generate": { "type": "groups", "seed": 7,
    "groups": [ { "label": "A", "mean": 50, "sd": 12, "n": 40 },
                { "label": "B", "mean": 62, "sd": 12, "n": 40 } ],
    "refs": { "g": "grp", "v": "val" } },
  "args": { "xIN": "@grp", "yIN": ["@val"], "method": "ttest", "alpha": 0.05, "out": {} },
  "compareFields": ["test", "difference", "t", "df", "pValue"]
}
```

**Seeded input data.** Instead of hand-written arrays, a table-process fixture may
declare a `generate` spec; the JS emitter realises it (deterministically, from
`seed`) and writes the arrays into `js_results.json`, so Python analyses the
*identical* numbers. Types: `rhythm` (mesor + amp·cos + Gaussian noise → `x`,`y`),
`linear` (slope·x + intercept + noise → `x`,`y`), `groups` (category + values →
`g`,`v`). This is how the complex functions (Cosinor, FitFunction, GroupComparison)
are exercised on realistic noisy data rather than toy arrays.

Notes:
- **Column refs use `@ref` tokens** (`"@t"`), resolved to real column ids in each
  language. With `generate`, the `refs` map names the columns; otherwise declare
  them in `inputs[]` with a `ref` name and explicit `values`.
- **`jsName` is the `.svelte` file name** of the process/table-process (the
  registry key), e.g. `Cosinor`, `FitFunction`, `Sub` (not "Substitute"),
  `normalize` (lower-case file).
- **`compareOutputs` lists canonical output keys.** Dynamic per-y keys are
  canonicalised by stripping a trailing `_<id>` (JS `cosinory_13` and Python
  `cosinory_<pyid>` both compare as `cosinory`). Static keys (`cosinorx`,
  `period`, …) pass through unchanged.
- Only outputs **both** implementations emit can be compared. (E.g. Python
  `tp_cosinor` emits `cosinorx` + `cosinory` but not the `period`/`amplitude`/
  `rsquared` scalars, so those are out of scope until the port adds them.)

## Current coverage

- Column processes: `add`, `multiply`, `sub`, `normalize`.
- Curve fitting on seeded noisy rhythm data: `Cosinor` (fixed period),
  `FitFunction` (cosinor model) — compares `cosinorx`/`cosinory`, `fitx`/`fity`.
- Stats on seeded group data (`tableProcessResult`): `GroupComparison` Welch
  t-test (`difference`,`t`,`df`,`pValue`) and one-way ANOVA (`f`, `ssBetween`,
  `ssWithin`, `dfBetween`, `dfWithin`, `etaSquared`, `pValue`).

Good next targets (column-output analyses, low-friction to add): `SmoothedData`,
`MovingAnalysis`, `BinnedData`, `TrendFit`, `SequenceColumn`, `RectangularWave`,
`Duplicate`, plus the remaining column processes (`RemoveTrend`, `OutlierRemoval`,
`Sort`, `EditValue`).

## End-to-end session parity

Whole-session JS↔Python check over every shipped session (one per node + the
classroom lessons). This is what catches port drift across the *entire* analysis
graph, not just one module.

```bash
GEN_SESSION_PARITY=1 npx vitest run src/lib/_parity/emitSessionParity.svelte.test.js
tools/.venv/bin/python tools/test_session_parity.py        # summary + per-column diffs
```

- **JS side** `src/lib/_parity/emitSessionParity.svelte.test.js`: reconstructs each
  session, runs every table process to completion (sync), dumps all columns by id.
- **Python side** `tools/test_session_parity.py`: loads each session through
  `ancir_runtime.py`, runs the analyses, compares column-by-column by id.

Current status: **42 match, 2 skipped (non-deterministic), 0 genuine mismatches.**

Three knobs in `test_session_parity.py` keep this honest rather than papering over
real differences:

- `NONDETERMINISTIC` — sessions whose JS output uses an unseeded RNG
  (`demo-tp-random`, `learn-hidden-rhythm`); not parity-checkable.
- `SESSION_TOLERANCE` — relaxed **relative** tolerance for analyses where JS and
  Python use *different numerical implementations*. Each is investigated and
  explained, not hand-waved (see below).
- `SKIP_COLUMNS` — specific columns whose **JS baseline is itself degenerate** (a
  JS-engine headless limitation, not a Python bug): `filterbyothercol` col 58 (the
  filter process isn't applied during headless column reconstruction) and
  `widetolong` col 196 (output time typed `'time'` but holding raw ms → JS
  `get_data` returns all-None). The Python port is correct in both.

### Why the tolerances are justified (investigated, not assumed)

- **`demo-tp-doublelogistic` (1e-3)** — was a *real Python bug*: the free-period
  fit was seeded at 24h and the optimizer collapsed the period to a degenerate
  many-tile minimum (RMSE-vs-data 8.3 vs JS 2.8; 44% curve error). Fixed by
  seeding a free period from the data timespan (JS does the same), which lands on
  JS's exact minimum. Residual is now ~1e-5 (LM stopping-point precision).
- **`demo-tp-rectangularwave` (5%)** — benign optimizer convergence. Both fitted
  curves explain the data equally well (RMSE-vs-data 5.52 vs 5.54), so they're the
  same minimum to LM precision; max pointwise difference ≈0.9 on amplitude ~50.
- **`demo-tp-movinganalysis` (1%)`, `demo-tp-rhythmicityanalysis` (2%)** — these
  demos were lengthened to 14-day inputs (MovingAnalysis uses a 7-day / 168h
  window) so each window holds 7+ cycles of the 24h rhythm. That sharpens the
  Lomb–Scargle peak and the peak **period** now matches JS exactly (the earlier
  broad-peak argmax flip — 48h windows held only ~2 cycles, leaving the top grid
  periods tied within ~0.5% — is gone). The remaining ≤1% residual is purely a
  difference in how the JS and Python Lomb–Scargle implementations normalise the
  peak **power** magnitude; more data doesn't remove it. Tightening it to bit-exact
  would mean reconciling the two power normalisations (a separate, minor item).

### Session → standalone Python script

`tools/ancir_to_python.py` now reads `session["tableProcesses"]` (the `tables`
grouping removed 2026-06-15) and converts current sessions correctly:

```bash
tools/.venv/bin/python tools/ancir_to_python.py static/sessions/classroom/learn-sine-waves.json -o analysis.py
tools/.venv/bin/python analysis.py   # runs Cosinor, writes columns_*.csv + a plot
```

Note `tp_cosinor` emits only `cosinorx`/`cosinory`, not the `period`/`amplitude`/
`rsquared` scalar columns the JS engine exposes — add those to the port if a
session relies on them.
