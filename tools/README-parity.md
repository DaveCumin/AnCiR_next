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

### Actogram plot data (`plotCompute`, jsFn `actogramDownloadData`)

Pins the actogram's "Show/Save data" rows (`Actogramclass.getDownloadData`), which
`ancir_to_python.py` scripts write as `<plot>_data.csv` through `export_plot_data`. The
emitter builds the actogram as the `actogramMarkers` kind does (Plot.fromJSON over real
Columns, in the fixture's display `zone`) and records the rows; the Python leg rebuilds
Columns from the recorded arrays and calls the export builder itself,
`actogram_download_data(plot, columns, zone=...)`, compared with `_deep_diff`.

The export used to fold each series on its OWN first day, always in UTC, while the app folds
every series at ONE startTime (the earliest valid sample over all series, at midnight in the
display zone). Nothing caught it because the only check was `test_plot_data_export.py`, which
asserts shape and invariants on a single-series demo with a number x axis. The builder now goes
through `actogram_start_time`, `actogram_series_frame` and `actogram_bins_by_period`, so the
runtime has one folding implementation. Cases (4): two series starting on different days
(leading gap, different steps); America/New_York across the 10 March DST change; a UTC series
starting 06:20 on a 0.3 h step, so every row's edge bars are split; a number axis with 23.5 h
rows. The first two failed on the old code (`rows[388][1]: 1 vs 2`, `rows[0][2]:
3.67 vs 22.67`); the last two passed on it and guard the paths that were already right.

Python only: neither the R runtime nor the exported R scripts write plot data for any plot
type, and the in-app Python export (`pythonExport.js`) draws plots but does not call
`export_plot_data`.

Binned x columns (4 more cases, plus `actogram-rule-bin-origin` for the marker kind and two
`tp-binneddata-*` table-process cases, all in both ports where the port computes them). With
`binned` (BinnedData args) the emitter runs a real BinnedData node and plots its outputs, and
the Python leg runs `tp_binneddata` itself, so the bars come from the metadata each port's
node writes. The app's rules: BinnedData stores bin STARTS; on a time input its x output is a
time column of epoch ms (origin + start hours) with `binWidth` = binSize and `originTime_ms` =
the input's earliest sample, otherwise a `bin` column whose getData is the centres. The
actogram draws a column's bars `binWidth` wide when it has one, and folds a `bin` column at
`-rawBinStart0 + (startTime - (originTime_ms ?? startTime)) / 3.6e6`. Both ports' BinnedData
wrote bin-centre HOURS into a column of the input's type (so a time input read back as
milliseconds after 1970), read `aggFunc` instead of the saved `aggFunction`, and always
stepped by `stepSize` (saved with a 0.25 default) where the app steps by binSize unless
`diffStep`; the Python Column gave every column `bin_width` 1.0 and had no `originTime_ms`;
and both ports' `actogram_series_frame` folded a `bin` column at `-min(centres)`. The frame now
takes `raw_bin_start0` and `origin_time_ms`, and the `tableProcess` legs compare what an output
column READS (getData), not what it stores.

| Broken (Python)                                   | First failure                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| the whole binned fix reverted                     | 7 fixtures (R: the 3 it claims), e.g. `tp-binneddata-time-input` |
| `originTime_ms` ignored in the bin offset         | `actogram-data-bin-origin` at `rows[576][2]`: 0.0 vs 7.5         |
| bar width from the scanned step, not `binWidth`   | `actogram-data-bin-origin` at `rows`: length 864 vs 870          |
| bin offset from `min(centres)`, not the raw start | `binned-number`, `bin-origin`, `rule-bin-origin`                 |

### Correlogram plot data (`plotCompute`, jsFn `correlogramDownloadData`)

Pins the correlogram's "Show/Save data" rows (`Correlogramclass.getDownloadData`, the
series' `acfData`), which `ancir_to_python.py` scripts write as `<plot>_data.csv`. The emitter
builds a real Correlogram over real Columns (optionally over a real BinnedData node's
outputs, `binned`), records the rows, and the Python leg rebuilds the columns and calls
`correlogram_download_data`, compared with `_deep_diff`. The PNG renderer
(`plot_correlogram`) now goes through the same `correlogram_series_acf`, so a plot's CSV and
its picture agree.

Why the existing `plot-correlogram-rhythm-noisy` passed while the export was wrong: it calls
the pure `computeAutocorrelation` directly on an hourly grid from 0 with no bin size, so none
of the plot's own inputs were exercised. The app's plot (a) takes the lag step from the x
column's `binWidth` when it has one, else the MEAN spacing `(last - first) / (n - 1)`,
(b) feeds `hoursSinceStart` for every column type, and (c) keeps `maxLag` / `minLag` on each
SERIES. The export ignored `binWidth`, let the compute estimate the step from the median
spacing, read raw x for non-time columns (harmless: the autocorrelation is shift-invariant)
and read plot-level `corrMaxLag` / `corrMinLag` keys the app never writes. Separately, the
compute's own step estimate (used when no bin size is passed, as RhythmicityAnalysis and
MovingAnalysis do) is the UPPER median of the spacings in the app, where Python used
`np.median` over the positive spacings and R used `median`; both ports now match
(`plot-correlogram-upper-median`, both ports). Cases: a BinnedData output on a time input
with a 1 h binWidth on a 0.5 h step; an imported bin column (binWidth 0.75 on a 0.5 h step); a
number x from 5 h stepping 1, 1, 1.05 h; an alternating 0.25 / 0.75 h time x with per-series
maxLag 30 and minLag 2, plotted with a regular series.

| Broken (Python)                    | First failure                                                    |
| ---------------------------------- | ---------------------------------------------------------------- |
| the whole fix reverted             | all 5 fixtures, e.g. `binned-time` at `rows`: length 144 vs 72   |
| the column's binWidth ignored      | `binned-time`, `bin-column`                                      |
| median spacing instead of the mean | `number-offset` (rows 119 vs 118), `irregular` (149 vs 116)      |
| per-series maxLag / minLag ignored | `irregular` at `rows`: length 156 vs 116                         |
| `np.median` in the compute         | `plot-correlogram-upper-median` at `lags`: length 4 vs 3 (R too) |

Python only for the rows: neither the R runtime nor the exported R scripts write plot data
for any plot type (the R export's only CSV is the session's input data).

A missing FIRST or LAST x: the app's mean spacing used to read it as 0 (JS `null`
arithmetic), which gave a wrong step or a blank plot. The port never copied that; it uses the
first and last valid rows, `(t_j - t_i) / (j - i)`, and the app now does the same
(`utils/correlogram.js meanSpacing`); the two formulas agree whenever both ends are present.
`correlogram-data-missing-ends` pins it (a number x missing its last time, a time x missing its
first). It also caught a Python-only bug: `Column.get_data` judged "already epoch ms" on
`data[0]`, so a time column whose FIRST value is missing went through `pd.to_datetime`, which
reads integers as nanoseconds, and every time shrank a millionfold (lag 0 came out 0, not 1).
It now judges on the first present value.

| Broken                                | First failure                                            |
| ------------------------------------- | -------------------------------------------------------- |
| the app's old `(t[n-1] - t[0])/(n-1)` | `missing-ends` at `rows`: length 192 vs 120 (Python leg) |
| Python judges epoch ms on `data[0]`   | `missing-ends` at `rows[72][2]` (lag 0): 0.0 vs 1        |

### Autocorrelation lag slots on uneven data (all three languages)

`computeAutocorrelation`'s time-pair path (uneven spacing; also what gapped, evenly spaced
data takes once its missing rows are dropped) is the slotted estimator: each product of two
mean-removed samples goes to the lag slot its separation falls in (Edelson and Krolik 1988;
the rectangular kernel of Rehfeld et al. 2011, Nonlin. Processes Geophys. 18:389, Eqs. 10-11).
All three languages used the window `|d - k dt| <= dt / 2` and left out each sample's pairing
with itself, so lag 0 was the correlation of the near-coincident pairs only (the upper-median
fixture read -0.142), and a pair exactly half a step off a lag was counted in two lags. Now,
in lockstep (`utils/correlogram.js`, `compute_autocorrelation` in both ports):

- lag 0 is exactly 1 on both paths (on the index-shift path `sum / (n * var)` was 1 up to
  rounding, 2 ulp off on two shipped MovingAnalysis windows);
- slots are half-open, lag k takes `(k - 1/2) dt <= d < (k + 1/2) dt`: a boundary pair counts
  once, in the upper lag;
- distinct pairs closer than half a step are not used at any lag.

On evenly spaced data every separation is a whole number of steps, so nothing else moves.
`src/lib/utils/correlogram.evenSpacing.svelte.test.js` replays, against a golden recorded
before the change, every call the app makes on the shipped sessions (the correlogram demo's
plot, every RhythmicityAnalysis and MovingAnalysis node re-run in correlogram mode), the
`util-autocorrelation-peak` and `plot-correlogram-rhythm-noisy` inputs, and three gapped even
series: byte-identical except lag 0 (the two 2-ulp windows, and the gapped series, whose lag 0
was 0).

Changed record: `plot-correlogram-upper-median` correlations `[-0.142, -0.140, -0.331]` ->
`[1, 0.0423, -0.0941]`. New: `plot-correlogram-boundary-pair` (separations exactly on the
slot boundaries, minLag 1) and `plot-correlogram-near-zero-pairs` (four near-coincident pairs).

| Broken (one language at a time) | First failure                                               |
| ------------------------------- | ----------------------------------------------------------- |
| JS keeps the old window         | the 3 fixtures in both ports (Python 3 failed, R 3 failed)  |
| Python keeps the old window     | `upper-median`, `boundary-pair`, `near-zero-pairs` (Python) |
| R keeps the old window          | `upper-median`, `boundary-pair`, `near-zero-pairs` (R)      |

### A missing first or last x: SurrogateTest, NPCRA and the harmonic check

The same JS trap as the correlogram's step (`Number(null) === 0`, `null - x0 === -x0`) sat in
three more places that take a step or span from a series' ends. A seeded `rhythm` spec can now
null x rows with `missingX` (row indices, negative from the end), as the actogram series
generator already could.

- **SurrogateTest** coerced its times with `Number`, so a missing time went into the FFT behind
  the `observed` statistic at t = 0 (a missing LAST time gave the FFT a negative step, an empty
  spectrum and `observed` = 0), and the hours-to-samples block length read the end as 0 (a
  "24 h" block became 69 samples instead of 96 on a series from 100 h, or fell back to 24
  samples). The node now keeps the rows where x and y are both present, as both ports always
  did, and takes the step from `meanSpacing` (now in `utils/validPairs.js`, re-exported by
  `utils/correlogram.js`, so the Correlogram is unchanged). The ports do not build surrogates
  (the p-value stays a Monte Carlo boundary), so only `observed` is compared.
- **computeNPCRA** kept every row whose `Number(t)` is finite, so a missing time became a
  sample at hour 0 (epoch grid pulled back, its y averaged into the first epoch). It now drops
  it (`isInvalidValue`), which both ports already did.
- **harmonicCheck** took the record span as `xData[last] - xData[0]` over `hoursSinceStart`,
  which keeps a missing time as null: a missing LAST time made the span about 0, no candidate
  survived and tau went NaN. Both ports had copied that deliberately. All three now use the
  first and last PRESENT samples (`validEnds` in `utils/validPairs.js`).

| Broken                                 | First failure (Python; R the same fixtures)                                     |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| SurrogateTest's old `Number` coercion  | `tp-surrogate-observed-missing-last-x` `observed`: 31.45 vs 0                   |
|                                        | `tp-surrogate-observed-missing-first-x` `observed`: 31.40 vs 31.50              |
| computeNPCRA reads a missing time as 0 | `tp-npcra-missing-x-ends` `npcray[0]`: 39.14 vs 31.80                           |
| the app's old span (JS)                | `actogram-rule-harmonic-missing-last-x` at `harmonic`: app None, port an object |
| the ports' old span (JS fixed)         | `actogram-rule-harmonic-missing-last-x` at `harmonic`: app an object, port None |

### BinnedData custom edges (`cuts`) and the aggregates

Neither port implemented BinnedData's `binMode: 'cuts'` (custom bin edges): both binned a cuts
session uniformly at its leftover `binSize`, so a 7-edge session came back as 49 bins. Both
ports now carry a line-by-line port of `wrangleData.js binData` in BOTH modes (`bin_data` /
`bin_data` with a `cuts` argument) and of the node's `binneddata(args)` checks. The rules they
pin, all from the app:

- the edges are the finite `cuts`, deduplicated and sorted at the node boundary; fewer than
  two distinct edges, or ANY time-typed x, makes the node invalid and it writes nothing;
- every bin is `[a, b)` except the last, which is `[a, b]`; values outside the edges are
  dropped; a value within 1e-10 BELOW an edge belongs to the next bin (the same tolerance the
  uniform bins use);
- the x output is a `bin` column of the bin STARTS with `binWidth` null (the Python and R
  columns record `cuts_list` instead), so it reads back its starts, not centres;
- the aggregates are the app's: `stddev` is the SAMPLE deviation and 0 for fewer than two
  points, `count` counts pairs (0 when empty), `min`/`max` of an empty bin are null, `mean`
  and `median` of one are NaN. The ports had the POPULATION deviation and no `count` at all
  (it silently fell through to the mean), in uniform mode too.

Uniform bins now also step as the app does, `binStart + i * step` rather than by
accumulation, with the 1e-10 edge tolerance.

Missing values: a row whose x or y is missing (null, blank) is DROPPED, and a missing edge in
`cuts` is dropped too. The ports always did this; the app did not, because `binData` filtered
pairs with the global `isFinite`, and `isFinite(null)` is true, so a null y was averaged in as
0 (and became the bin `min`, reported as null) and a null x put its y in the bin at 0; a null
edge became an edge at 0. The app now uses the house rule (`validPairs` / `isInvalidValue`).
`tp-binneddata-missing-{uniform-mean,uniform-min,cuts-mean,cuts-count}` pin it in both ports
(x missing at two rows, y at two others; edges `[10,1,null,2.5,7]`). With the app fix reverted
all four fail in both ports; with only the edge fix reverted, the two cuts fixtures fail.

Fixtures (all in both ports): `tp-binneddata-cuts-{mean,median,min,max,stddev,count}` (one
irregular, unsorted number input; edges saved unsorted with a duplicate, uneven, one empty bin,
values on and 1e-11 below an edge, values outside both ends), `tp-binneddata-cuts-time-input`
and `tp-binneddata-cuts-one-edge` (refusals), `tp-binneddata-uniform-{stddev,count}`. The two
refusals set `recordValid`: the emitter then records the node's validity as `valid`, and both
legs compare the port's own validity to it (every other fixture's record is unchanged).

| Broken (Python)                       | First failure                                                       |
| ------------------------------------- | ------------------------------------------------------------------- |
| the whole cuts/aggregate fix reverted | the 10 new fixtures (R: the same 10), e.g. `binnedx` length 49 vs 6 |
| last bin `[a, b)` instead of `[a, b]` | 5 cuts fixtures, e.g. `cuts-count` at `binnedy[5]`: 2 vs 4          |
| no 1e-10 tolerance on the edges       | 6 cuts fixtures, e.g. `cuts-count` at `binnedy[0]`: 3 vs 2          |
| population stddev                     | `cuts-stddev` and `uniform-stddev`                                  |
| time x no longer refused              | `cuts-time-input`: valid True vs False                              |
| cuts column reads centres             | 6 cuts fixtures at `binnedx[0]`: 0.5 vs 0                           |

Not pinned, deliberately: the app's binData filters pairs with the GLOBAL `isFinite`, which
coerces, so a missing (null) x or y is binned as 0 rather than dropped (on the cuts fixture's
input a null y moved one bin's mean from 18.67 to 13.33 and made its min null). The ports drop
missing pairs, which is what that filter's own comment says it is for; see the item in the
parity report.

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

`npm run parity` lists every fixture. As of 2026-10-05: 323 fixtures, Python 323/323, R
282 pass with 41 not claimed (listed below), whole-session 89 match with 2 skipped.

## Fixture fields added 2026-10-04 (review wave 1 and 2 ports)

| Field           | Kind                            | Meaning                                                                                                                                                                                         |
| --------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storedValues`  | `tableProcess`                  | `{key: value}` seeded into `core.storedValues` (and handed to the ports) in the saved-session entry shape `{staticValue}`. FormulaColumn `#key` tokens read it.                                 |
| `rawInputs`     | `tableProcess`, `columnProcess` | The R leg passes cells exactly as JSON gave them (text stays text, booleans stay logical, null becomes NA) instead of coercing to numbers; for fixtures whose subject IS the missing-cell rule. |
| `mustNotCreate` | `tableProcess`                  | A path the fixture's hostile payload would create if a port executed it. The Python leg asserts it does not exist after the run (SEC-2 proof).                                                  |
| `allowInvalid`  | `tableProcessResult`            | The comparison may be invalid (a non-computable statistic); its own `valid` field is compared instead of asserting validity.                                                                    |
| `recordValid`   | `tableProcess`                  | (existing) also used for every refused FormulaColumn payload.                                                                                                                                   |

The emitter also refuses to write results if `globalThis.__pwned` is set after the run (the
JS FormulaColumn injection payload sets it if it ever executes), and gained pure-util
adapters `fftPeakOf`, `regridUniform`, `lombScarglePeriodogram`, `seededSequence`, plus a
`pvalue` array on `chiSquaredPeriodogram`, and the harmonic check's `eligible`, `testF`,
`testP` and `powerStrongest` in actogram rule records.

## FormulaColumn and SEC-2

`tools/ancir_runtime.py` used to build a Python expression from the formula tokens and call
`eval(expr, {'math': math, '__builtins__': {}}, {})`. Empty builtins are not a sandbox:
`[c for c in ().__class__.__base__.__subclasses__() if c.__name__ == '_wrap_close'][0]
.__init__.__globals__['system']('touch ...')` reaches `os.system`, so a session file (or an
exported script built from one) could run any command. Both ports now implement
`src/lib/utils/formulaExpression.js` exactly: a tokeniser (`_formula_lex` /
`.formula_lex`), a recursive-descent parser with the JS precedence, nesting (200) and size
(2000 lexemes) limits (`parse_formula`), a flattening to a postfix program, and a stack
evaluator (`evaluate_formula`). A function name is only ever a key into a fixed table; there
is no `eval`, `exec`, `compile`, `parse`, `str2lang` or attribute access in the path. A
refused formula writes nothing and leaves the node invalid. The 19 `tp-formula-*` fixtures
pin the grammar and semantics (right-associative `^` binding tighter than a unary minus on
its left, fmod-style `%`, JS `Math.round`, variadic min/max, stored values, Number() syntax
for numeric text, per-step non-finite = missing, literal and arithmetic overflow) and eight
refusals, including the Python escape above (with `mustNotCreate`) and a JS
string-injection payload. Mutation tests of the Python parser (power operand parsed as a
primary, a left-associative power, Python `%` for `%`, an unknown name read as 0, banker's
`round`, no per-operator finiteness check) are each killed by a fixture; dropping the
finiteness check on FUNCTION results is an equivalent mutant in Python (its math functions
raise rather than return Inf or NaN). R gained FormulaColumn with the same parser
(`R_IMPLEMENTED` now lists `formulacolumn`).

## Round 2 ports (2026-10-05)

| Change                        | Python and R                                                                                                                                                                                                                                                                           | Fixtures                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| FIT-6 template placement      | marker = template start + N (was the midpoint)                                                                                                                                                                                                                                         | `actogram-rule-asymmetric-template` (+ the two existing asymmetric rules)                                               |
| STAT-10 Tukey-Kramer          | q against the studentized range at (k, N - k), no Holm step, simultaneous CI. Python integrates the upper tail directly (port of `studentizedRange.js`); R uses `ptukey`/`qtukey` (`rTolerance` 1e-6). R GroupComparison ANOVA now computes the post hoc too.                          | `util-tukey-kramer-*`, `util-studentized-range-*`                                                                       |
| STAT-16 zone offsets (R)      | `+05:30` and a trailing `Z` normalised to `+0530`/`+0000` before `%z`                                                                                                                                                                                                                  | `time-zone-offsets`                                                                                                     |
| STAT-15 cleared cells (R)     | an EditValue null edit is NA, not a deleted row                                                                                                                                                                                                                                        | `col-editvalue-null`                                                                                                    |
| STAT-19 output origin         | `fit_time_frame`: the minimum valid input time; a time output grid in the input's hour frame. Cosinor, FitFunction, TrendFit, RectangularWave, DoubleLogistic, SmoothedData                                                                                                            | `tp-cosinor-time-origin-min`, `*-output-grid-time`, `tp-trendfit-time-origin`, `tp-smoothed-time-origin`                |
| FIT-9 phase reference         | `phaseReference` 'clock' (display zone from `set_display_timezone` / `DISPLAY_TIMEZONE`, which the exporters now set from `appState.displayTimezone`); numeric x falls back to 'start'. Cosinor, FitFunction metric ports, NPCRA (onsets and profile), AverageProfile (bins reordered) | `tp-cosinor-clock-*`, `tp-fitfunction-*-metrics-clock`, `tp-npcra-clock-reference`, `tp-averageprofile-clock-reference` |
| FIT-13 overall waveform       | `multi_component_waveform` (2880 points, parabolic refinement); Cosinor and FitFunction `amplitude`/`acrophase` (and Cosinor `bathyphase`, `phase_angle`) from it when nHarmonics > 1; new `*_h1` ports                                                                                | `tp-cosinor-multiharmonic*`, `tp-fitfunction-cosinor-metrics-*`                                                         |
| MovingAnalysis rolling phases | both ports' MovingAnalysis rebuilt on one `compute_moving_windows` (also the parity surface), with every JS analysis (summary, trend, rectfit and double logistic were missing) and the record-start phase frame                                                                       | `util-movingwindows-*`                                                                                                  |

Also fixed on the way: Python and R FitFunction now write their metric ports (they wrote
none), the cosinor model's `useFixedPeriod` default is true as in the app, TrendFit writes
its x output as time for a time input and refuses out-of-domain fits per y, R TrendFit writes
r2/rmse/coefficients, `ancir_to_python.py` documents `.ancir` sessions.

## Remaining divergences (recorded 2026-10-04, updated 2026-10-05)

- **Round 2, outputs the ports do not have**: the Cosinor/FitFunction stats-table CSV headers
  (`_clock_h`, `overall_amplitude`, `orthophase_*`), the RectangularWave/DoubleLogistic panel
  phases and stored values, the GroupComparison post-hoc table (`ci_low`, `ci_high`, label),
  the phase-reference and window-skip warning text. Nothing to port them into.
- **Studentized range in R**: `ptukey` is accurate to about 1e-11 absolute in the upper tail
  and `qtukey` to about 1e-8 relative, so the R Tukey fixtures carry `rTolerance` 1e-6.
- **Free cosinor in the ports** still uses scipy `least_squares` / R `optim`, not the JS
  Levenberg-Marquardt; MovingAnalysis free-cosinor windows agree to 1e-4 (fixture tolerance).
- **Permutation p-values** (`perm_pvalue` of Cosinor, RectangularWave, DoubleLogistic,
  FitFunction; the block scheme, `autoPermutations`, scheme and block-length fields, the
  permutation CSV `scheme` column): not run by either port, which write NaN ("not
  computed"). The seeded generator they need is now ported (`SeededRNG`), so this is the
  refit-per-permutation cost (999 Levenberg-Marquardt fits per series in an exported
  script), not a reproducibility limit.
- **Periodogram plot metric `peak_pvalue`** (family-wise over the folds,
  `-expm1(M log1p(-p))`): the ports compute no plot metric outputs for periodograms, so
  there is nothing to port it into. The per-fold chi-square p is the upper tail in all
  three (`chi2.sf`, `pchisq(lower.tail = FALSE)`) and the Python periodogram CSV now
  writes the per-fold threshold and p.
- **RhythmicityAnalysis `stat_*` metric ports**: now written by both ports (periodogram
  peak by spectralPeakIndex, FFT by fftPeak, correlogram by the first-positive-lobe rule);
  fixtures `tp-rhythmicity-*-stats`.
- **Residual outputs** (`resid_<yId>`): written by the ports for SmoothedData only; the fit
  nodes' residual columns (Cosinor, FitFunction, RectangularWave, DoubleLogistic, TrendFit)
  are not ported.
- **Time-format import (UI-1)**: sessions saved before the fix may store numeric columns as
  `time` with a format such as `D.M`. JS now reads those values as missing; Python and R read
  numeric time cells as epoch ms.
- **FitFunction rectangular fixed period**: fixed in JS (fitFunction.js now passes
  `fixedOmega = 2 pi / fixedPeriod`, rectwave.js throws without a positive finite one);
  mirrored in both ports, fixture `tp-fitfunction-rect-fixed-period-12`. No longer a
  divergence.
- **Upper tails**: every F and chi-square p in both ports is the upper tail computed
  directly (`sf`, `lower.tail = FALSE`), the cosinor's at max(0, F), with F = Infinity giving
  0, matching `pUpperFromF` / `chisqSf`.
- **LogisticRegression outcome levels**: `coerceBinary` drops only null and '' before
  counting levels, so a whitespace-only outcome cell is a level and makes a 0/1 outcome
  "not binary". JS quirk, mirrored.
- **Cross-correlation AR filter cells**: `crossCorrelation.js` `finite()` treats a
  whitespace-only cell as Number(' ') = 0 (a value) in the AR fit and filter, while the
  per-lag correlation drops it (house rule). Mirrored in both ports.
- **Spline interpolation**: now ported (natural cubic, Numerical Recipes) in both ports;
  no longer a divergence.
- **Rounding-level**: the refined FFT peak (golden-section on a flat objective) differs by
  ~5e-9 relative because V8 `Math.cos` (fdlibm) and the C library differ by an ulp
  (`tolerance` 1e-7 on those fixtures); R's normal equations for the LM fits use BLAS
  `crossprod`, agreeing to 1e-6 rather than 1e-10; R's `glm` standard errors (`rTolerance`
  1e-5 on the logistic fixtures).
- **Box plot / tables**: the Python export renders box plots with matplotlib (type-7
  quartiles, 1.5 IQR whiskers) from house-rule values, but has no category grouping and no
  significance bars; R exports no plots.
- **Not mirrored because the ports have no such path**: the boxplot significance bars,
  MovingAnalysis skip warnings, the panel warnings and notices.

## Nodes and fixtures the R port does not claim

Analyses without an R implementation (`R_IMPLEMENTED` in `runtimeCoverage.js`): `Crossing`,
`Random`, `SimulatedData` (the last two are baked into the session). The 41 fixtures with no
`rFunc`: the correlogram and actogram plot-data rows (`correlogram-data-*` 5, `actogram-data-*`
8; R exports no plots), `util-kde-*` 2, `util-meansem-groups`, `tp-cosinor-addons-fixed24`,
`util-chisquare-gof`, `util-chisquare-independence`, `util-logistic-*` 3 (pure-util call
shape; the R logistic kernel is covered by the `tp-logistic*` fixtures), `util-cwt-peak-scale`,
`util-fisher-exact-*` 6, `util-cramers-v-*` 4, `util-fisher-conditional-or-*` 4,
`tp-cosinor-fixed-ci-short-record`, and the three `tp-crossing-*`.

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

Current status (2026-09-30): **89 match, 2 skipped (non-deterministic), 0 mismatches, 0
errors.** The JS side RECOMPUTES every table process (`doProcess`), so the comparison is
against what the app computes now, not against the outputs stored in the session JSON; a
stale saved session cannot hide a port bug or cause a false one. (One caveat: the emitter
swallows a JS throw, which would leave that node's stored outputs in place.)

Four knobs in `test_session_parity.py` keep this honest rather than papering over
real differences:

- `NONDETERMINISTIC` — sessions whose JS output uses an unseeded RNG
  (`demo-tp-random`, `learn-hidden-rhythm`); not parity-checkable.
- `SESSION_TOLERANCE` — relaxed **relative** tolerance for analyses where JS and
  Python use _different numerical implementations_. Each is investigated and
  explained, not hand-waved (see below).
- `SKIP_COLUMNS` — specific columns whose **JS baseline is itself degenerate** (a
  JS-engine headless limitation, not a Python bug): `widetolong` `time` (output
  typed `'time'` but holding raw ms → JS `get_data` returns all-None). The Python
  port is correct there.
- `MONTE_CARLO_COLUMNS`: columns whose JS value comes from a PRNG the runtime does not
  reproduce; the port must emit NaN there and each exclusion is printed. EMPTY since
  2026-10-04: the ports now reproduce the app's seeded @stdlib minstd-shuffle generator
  bit for bit (`SeededRNG` in Python, `seeded_rng` in R; fixtures `util-seeded-rng-*`),
  so `demo-tp-surrogatetest` `pvalue` is compared like any other column.

### The 2026-09-30 triage (82 match, 6 mismatch, 1 error before)

| Session                                 | What differed                                                                              | Class                 | Outcome                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------- |
| `demo-tp-correlation`                   | port `r` 0.9994, app 1; p 0.819 vs 0.758                                                   | port bug (both ports) | fixed; `tp-correlation-auto-*` (3)  |
| `demo-workflow-stats-correlation`       | port `r[3]` 0.9452, app 0.9377; p off by 0.029                                             | same bug              | fixed                               |
| `demo-workflow-stats-eda`               | port `r[1]` -0.0386, app -0.0367                                                           | same bug              | fixed                               |
| `demo-workflow-stats-fisher-exact`      | Fisher node: port statistic 5.625, app none; effect 0.67 (Cramer's V) vs 21.4 (odds ratio) | port bug (both ports) | fixed; `tp-chisquared-fisher-*` (3) |
| `demo-workflow-stats-two-groups-counts` | port chi-squared 0.0298, app 11.31; p 0.863 vs 0.00077                                     | port bug (both ports) | fixed; `tp-chisquared-groups-*` (2) |
| `demo-tp-surrogatetest`                 | app `pvalue` 0.05, port NaN                                                                | intentional boundary  | `MONTE_CARLO_COLUMNS`, NaN required |
| `demo-tp-columnset` (error)             | "unsupported table process 'ColumnSet'"                                                    | port bug (both ports) | fixed: dispatched as a no-op        |

- **Correlation `auto`.** The app picks ONE method for the whole matrix: Pearson unless ANY
  column is non-normal by GroupComparison's `jarqueBeraNormality` (n >= 8, moments over the
  SAMPLE standard deviation, p >= 0.05 normal), then Spearman for every pair. Both ports ran
  Shapiro-Wilk per PAIR and chose per pair. Fixtures: the demo's own data (all normal, so
  Pearson, r = 1 on an exact linear map), a matrix with one skewed column (Spearman for every
  pair, including the two normal columns), and a column whose decision flips on the sample
  vs population SD. The skewed fixture also caught an R-only bug: R's `cor.test` gives the
  EXACT (AS 89) Spearman p for n < 1290, where the app and scipy use the t approximation
  (0.4350 vs 0.4367); R now passes `exact = FALSE`.
- **ChiSquared ("Categorical tests").** Both ports had only half the node: no Fisher mode
  (`testType: 'fisher'` ran the chi-squared test), no `dataFormat` (the app's DEFAULT
  `'groups'` reads each column as one independent group's outcomes; both ports always
  cross-tabulated row by row), the wrong goodness-of-fit key (`'goodnessoffit'`, where the app
  saves `'goodness'`, so it never ran), no categorical goodness of fit and no Cohen's w. Both
  now port the node whole: `contingency_table`, `groups_to_table`, the missing-category rule
  (null, '', NaN and the text 'NaN'), Fisher's p for each alternative with the conditional-MLE
  odds ratio and its two-sided 95% interval (Python via scipy; R ports the app's bisection
  because `fisher.test`'s `uniroot` is only good to ~1e-4), and the app's "valid but writes
  nothing" results. Fixtures: `tp-chisquared-{fisher-paired, fisher-greater, fisher-less,
groups-default, groups-fisher, goodness-categorical, goodness-counts, paired-no-yates}`.
- **ColumnSet.** The node emits no columns and its selection is already in the consumers'
  saved inputs, which is why `runtimeCoverage.js` listed it as not applicable. But the node
  itself is in the saved `tableProcesses`, so the strict dispatchers aborted every exported
  Python or R script of a session containing one (reproduced: `ancir_to_python.py` on
  `demo-tp-columnset` raised `UnsupportedProcessError`). Both runtimes now dispatch it as a
  no-op that is valid and writes nothing, as the app's `columnset` does.

| Broken                                       | First failure                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| the Python item reverted                     | the 8 then-new fixtures, e.g. `groups-default` statistic 0.0298 vs 11.31 |
| Python `dataFormat` default `'paired'`       | `tp-chisquared-groups-default`                                           |
| Python per-pair method (auto never Spearman) | `tp-correlation-auto-one-skewed` r -0.1518 vs -0.1475                    |
| Python Fisher alternative ignored            | `tp-chisquared-fisher-greater` p 0.0152 vs 0.0076                        |
| JB with the population SD (Python and R)     | `tp-correlation-auto-jb-sample-sd` r 0.9515 vs 0.9691                    |
| R `dataFormat` default `'paired'`            | `tp-chisquared-groups-default`                                           |
| R interval upper tail `<` instead of `<=`    | the 4 Fisher fixtures                                                    |
| R exact Spearman p                           | `tp-correlation-auto-one-skewed`                                         |
| `tp_columnset` removed                       | `demo-tp-columnset` back to an error                                     |

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
