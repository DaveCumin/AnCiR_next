# JS ↔ Python ↔ R parity harness

Cross-checks the AnCiR **JavaScript engine** against the **Python port**
(`ancir_runtime.py`) and the **R port** (`ancir_runtime.R`): the same analysis, run on the
same input in every language, must produce the same numbers. This guards against the "two sources of truth"
drift risk — if someone changes a JS analysis without matching the Python port
(or vice versa), a fixture starts failing.

Scope: **per-module** parity (one table/column process at a time). Session-level
parity through `ancir_to_python.py` is a separate, not-yet-built layer (see
_Limitations_ below).

## Pieces

| File                                        | Role                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `tools/parity/fixtures.json`                | Language-neutral cases: process + args + input data + which outputs to compare. The single source both sides read.     |
| `src/lib/_parity/emitParity.svelte.test.js` | JS side. Runs each fixture through the real JS engine, writes `tools/parity/js_results.json`. Gated by `GEN_PARITY=1`. |
| `tools/test_parity.py`                      | Python side. Runs each fixture through `ancir_runtime.py` and asserts it matches `js_results.json` within `tolerance`. |
| `tools/parity/js_results.json`              | Generated JS **inputs and outputs** (git-ignored; regenerate with the emitter).                                        |
| `tools/test_parity.R`                       | R side. Runs each fixture tagged with an `rFunc` through `ancir_runtime.R` and asserts it matches `js_results.json`.   |

Run all three legs with `npm run parity` (or `parity:emit` / `parity:py` / `parity:r`
individually).

### Why an R leg was cheap to add

`js_results.json` records each fixture's **inputs** as well as its outputs, so every language
consumes the exact seeded inputs the JS emitter used rather than regenerating them. R
therefore needs no port of mulberry32 or the rhythm generator, and the three languages cannot
silently disagree about their _inputs_ instead of their maths.

A fixture opts into the R leg by gaining an `rFunc` key beside its `pyFunc`. Untagged
fixtures are reported as "not claimed by the R port" rather than passing silently.

### The `timeColumn` fixture kind

Builds one time column and reads back its parsed epoch-ms (`data`) and
`hoursSinceStart`, with no analysis in between.

It exists because the time path was the least-verified part of both ports and the most
likely to be quietly wrong: a wrong timezone or unit shifts every downstream result
without ever throwing. Every other fixture generates plain numeric `t` (0, 1, 2, …), so
`type: 'time'` — ISO parsing, epoch-ms storage, hours-since-start, AWD `{start, step,
length}` — was exercised by nothing, in any language.

It is also the one place the three languages did not share an approach. JS parses
strictly against the session's stored dayjs `timeFormat`; both ports ignored it and
guessed. That is fine for unambiguous ISO-8601 and wrong for anything else — the app's
own guesser returns BOTH candidates for an ambiguous day/month pair and asks the user to
choose, so a session can legitimately carry `DD/MM/YYYY`, and a port that re-guesses
disagrees with the app **by two months**, silently, on data the user already
disambiguated. Both ports now translate the stored format
(`strptime_from_dayjs` / `.strptime_from_dayjs`) and fall back to auto-detection only
when there is no format, which is the epoch-ms and legacy-session case.

Two bugs this kind found immediately:

- **R aborted on any gap.** An empty string (a blank cell in a CSV — the normal shape of
  an actigraphy gap) makes `as.POSIXct` _error_ rather than return NA, and an error is
  not a warning, so `suppressWarnings` did not catch it and the whole generated script
  died. Plain `NA` was fine; it was specifically `""`.
- **Both ports ignored the stored format**, as above.

A later pair of fixtures (`time-unpadded-tokens-padded-values`,
`time-unpadded-day-month-padded-values`) pins the opposite failure, this time in JS. Older
sessions store formats such as `YYYY-MM-DD H:mm:s`, and dayjs's strict mode rejected a
zero-padded `09` under `H` (it formats the parsed date back and compares strings), so
every row from 00:00 to 09:59 came back empty. `strptime` (`%H`, `%d`, ...) always read
one or two digits, so the ports were right and JS was wrong. `parseTimeStrict` in
`TimeUtils.js` now lets the single-width tokens `H h m s D M` take a padded or unpadded
value while still rejecting out-of-range values.

The reverse (`time-double-width-strict`) pins the other half of the rule. A double-width
token (`HH mm ss DD MM hh`) needs exactly two digits in JS, so `9:30:00` under `HH:mm:ss` is
blank there, but `strptime` would read it. Both ports therefore gate each value on the
format's digit widths before parsing (`dayjs_width_pattern` / `.dayjs_width_pattern`), and a
value that fails the gate is a gap, as in JS.

### The `actogramMarkers` fixture kind

Pins the actogram MARKER RULES (plan `docs/plans/2026-09-30-actogram-marker-rules-and-outputs.md`,
Phase B2): the five output ports a rule gives each series (`r<id>_tau`, `_phi`, `_r2`,
`_rmse`, `_n`), recomputed by `actogram_plot_rule_outputs` in both ports.

One fixture is one actogram: its series (seeded synthetic rest/activity data from a
`generate.series` list, or a shipped demo named by `source: {session, plotId}`), its
`periodHrs`, the display `zone` its rows snap to, its `markerRules` (the `MarkerRule.toJSON`
shape) and, per series, `ruleData`, `detachedRules` and own `phaseMarkers`. The emitter builds
it through `Plot.fromJSON` over real Columns, so the rule instances, the row folding at the
plot's `startTime` and the rule's cfg adapter are the app's own, and records the plain arrays
(`inputs.series[i] = {xType, x, y}`, x in epoch ms for a time column) plus, per series and per
rule, the five outputs AND every intermediate: the per-row detections and absolute times, the
day-selection mask, the outside-range flags, the unwrapped fit points and their counts, the
regression, the reference day, the re-encoded fixed slope/intercept, the phase and the
harmonic candidates. Both legs compare that whole tree (`_deep_diff` / `deep_diff`), so a
failure names the first intermediate that moved, not only the output it eventually changed.

Why one kind rather than a `pureUtil` fixture per function: the outputs are a CHAIN (fold,
detect, select, unwrap, fit, phase, harmonic check) whose joins come from the plot, not from
any one function (startTime and Ndays are computed over ALL series; a rule's fixed tau/theta
are re-encoded through the reference day). Per-function fixtures would pin each link and
leave the joins unchecked; recording the intermediates of the real chain pins both.

The ported functions, same names in both runtimes: `find_centile_value`,
`find_best_match_index`, `match_template_markers`, `marker_absolute_times`, `unwrap_onsets`,
`wrap_phase_to_row` (onsetUnwrap.js); `fit_day_range`, `is_day_selected`, `selection_mask`,
`is_outside_fit_range` (markerSelection.js); `fit_line` (lineFit.js); `harmonic_check`
(harmonicCheck.js, over each runtime's existing Lomb-Scargle); `kahan_linear_regression`
(wrangleData.js linearRegression, with its Kahan sums); `rule_output_values`
(plotMetricDefs.js); and the class-side pieces `actogram_start_time`,
`actogram_hours_since_start`, `actogram_bin_size`, `actogram_series_frame` (dataByDays),
`actogram_ndays`, `marker_rule_from_json`, `marker_block_from_json`, `marker_rule_cfg`
(ruleCfg), `marker_block_compute` (the PhaseMarkerClass deriveds) and
`actogram_marker_rule_outputs` (one rule on one series). `periodogramPeak` and
`assessOnsetFit` are NOT ported: they feed the UI's warnings only, never an output.

Cases (11): onset; offset on a number axis with 23.5 h rows; two series whose onsets drift
across the row boundary in opposite directions, the second starting a day later (the shared
startTime); a gap that empties one row plus a spike; the four lock combinations (fixed theta at
reference day 3, both fixed from day 2); a day range with one unticked day inside it; a
detached series with its own block (`fromRule`, `fitWithinRange`, centile 0 read as 50) and a
detached series with no block (all NaN); the rest-activity demo with fixed 12.3 h (2 tau wins),
47 h (tau/2 wins, 2 tau filtered out) and 24 h lines; the split-rhythm demo (tau 24.823 and
23.379 h against true 24.8 and 23.4 h); line-only rules (two points in one row, a single point
giving NaN with n = 1, no harmonic candidate inside a 2-day record giving NaN tau with a finite
phi, an empty rule giving NaN with n = 0); and the America/New_York display zone.

Tolerance 1e-9 (relative), the value the other pure-kernel fixtures use. Measured: every
detection, time, mask, count, fit, phase and output agrees BIT FOR BIT in both ports; the only
difference anywhere is the Lomb-Scargle power of a harmonic candidate (worst 9.8e-15 Python,
9.3e-15 R), because the JS sums are compensated and the ports' `_lomb_scargle` /
`lomb_scargle` are not. The pick is unaffected on every case.

Proof that the kind bites (each deliberately broken in the port, the leg run, then restored;
the same six in both languages, with the same first difference reported):

| Broken                                                                      | First failure                                                                                       |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `fit_line`: fixed-theta branch intercept sign flipped                       | `actogram-rule-locks` at `series[0].rules.r3.regression.intercept`: 166.19 vs 17.81                 |
| `harmonic_check`: candidate filter dropped                                  | `actogram-rule-harmonic-rest-activity` at `r3.harmonic.candidates`: length 3 vs 2 (and `line-only`) |
| `unwrap_onsets`: same-onset merge `n <= 0` weakened to `n < 0`              | 9 fixtures, e.g. `actogram-rule-split-rhythm` at `r1.unwrap.xs`: length 26 vs 19                    |
| `is_day_selected`: the range no longer scopes the fit                       | `locks`, `day-range`, `detached` at `selectedMask[0]`: true vs false                                |
| `marker_rule_cfg`: identity intercept = theta - (tau - P) \* refDay dropped | `locks` at `r4.fitIntercept`: 21 vs 19.8 (and `harmonic-rest-activity`, `line-only`)                |
| `actogram_start_time`: zone midnight taken in UTC                           | `actogram-rule-zone` at `startTime`: 1709424000000 vs 1709442000000                                 |

Exported scripts: the generated Python and R scripts embed the whole runtime, so these
functions ship in them, but the scripts do not compute plot metric outputs for ANY plot type
(`render_plots` draws; the saved metric columns reach `columns.csv` as rawData snapshots). The
actogram's rule columns follow the same precedent; no new export mechanism was added.

### `rTolerance`

A fixture may set `rTolerance` to loosen the comparison **for R alone**. Widening the shared
`tolerance` would quietly weaken the Python leg too. The one use so far is Shapiro-Wilk:
R's `shapiro.test` and the JS port both implement Royston AS R94 and agree on _W_ to 2.8e-11,
but the p-value's normalising transform differs by 5.4e-8 — a tail-approximation coefficient
difference, not a disagreement about the statistic.

### Runtime coverage guard

`src/lib/_parity/runtimeCoverage.test.js` runs in the normal vitest suite (no Python or R
toolchain needed) and checks each port against the JS analyses. It exists because
`tools/check_tp_coverage.py` had always exited non-zero on a missing Python implementation
but was wired into _nothing_ — no npm script, no test, no CI step — so nobody ran it and the
Python port silently fell eight analyses behind. Those eight are recorded in `PYTHON_GAPS`,
which may shrink but never grow.

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
	"jsName": "RemoveTrend", // JS registry key = the .svelte FILE name
	"pyFunc": "removetrend", // key in ancir_runtime COLUMN_PROCESS_MAP
	"input": [1, 2, 3, 4, 5],
	"args": {}
}
```

**Table process** (analysis with output columns):

```json
{
	"id": "tp-smootheddata",
	"kind": "tableProcess",
	"jsName": "SmoothedData", // JS registry key (file name)
	"pyFunc": "smootheddata", // Python runs tp_<pyFunc>
	"inputs": [
		{
			"ref": "t",
			"type": "number",
			"values": [
				/* ... */
			]
		},
		{
			"ref": "y",
			"type": "number",
			"values": [
				/* ... */
			]
		}
	],
	"args": { "xIN": "@t", "yIN": ["@y"], "out": {} },
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
	"generate": {
		"type": "groups",
		"seed": 7,
		"groups": [
			{ "label": "A", "mean": 50, "sd": 12, "n": 40 },
			{ "label": "B", "mean": 62, "sd": 12, "n": 40 }
		],
		"refs": { "g": "grp", "v": "val" }
	},
	"args": { "xIN": "@grp", "yIN": ["@val"], "method": "ttest", "alpha": 0.05, "out": {} },
	"compareFields": ["test", "difference", "t", "df", "pValue"]
}
```

**Seeded input data.** Instead of hand-written arrays, a table-process fixture may
declare a `generate` spec; the JS emitter realises it (deterministically, from
`seed`) and writes the arrays into `js_results.json`, so Python analyses the
_identical_ numbers. Types: `rhythm` (mesor + amp·cos + Gaussian noise → `x`,`y`),
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
- Actogram marker rules (`actogramMarkers`, Python and R): see the section above.
- Stats on seeded group data (`tableProcessResult`): `GroupComparison` Welch
  t-test (`difference`,`t`,`df`,`pValue`) and one-way ANOVA (`f`, `ssBetween`,
  `ssWithin`, `dfBetween`, `dfWithin`, `etaSquared`, `pValue`).

Good next targets (column-output analyses, low-friction to add): `SmoothedData`,
`MovingAnalysis`, `BinnedData`, `TrendFit`, `SequenceColumn`, `RectangularWave`,
`Duplicate`, plus the remaining column processes (`RemoveTrend`, `OutlierRemoval`,
`Sort`, `EditValue`).

## End-to-end session parity

Whole-session JS↔Python check over every shipped session (one per node + the
classroom lessons). This is what catches port drift across the _entire_ analysis
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
  Python use _different numerical implementations_. Each is investigated and
  explained, not hand-waved (see below).
- `SKIP_COLUMNS` — specific columns whose **JS baseline is itself degenerate** (a
  JS-engine headless limitation, not a Python bug): `filterbyothercol` col 58 (the
  filter process isn't applied during headless column reconstruction) and
  `widetolong` col 196 (output time typed `'time'` but holding raw ms → JS
  `get_data` returns all-None). The Python port is correct in both.

### Why the tolerances are justified (investigated, not assumed)

- **`demo-tp-doublelogistic` (1e-3)** — was a _real Python bug_: the free-period
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
