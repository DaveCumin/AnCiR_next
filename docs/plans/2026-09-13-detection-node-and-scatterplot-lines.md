# Plan: `Crossing` node + Scatterplot overlays (lines and bands)

> Node renamed `Detection` → `Crossing` (2026-09-14, author preference);
> filename kept for link stability.

> Status: Part A (Crossing) implemented 2026-09-16 (uncommitted at time of
> writing); Part B in implementation 2026-09-17. Motivated by the BeeSpy
> review-article worked example and the MSPB pilot: reproducing that pipeline
> in AnCiR required hand-made constant "limit" columns, four `Threshold`
> nodes, and computing detection times *outside* the session. Both gaps are
> closed by one node and one plot capability.

## Why

The recurring analysis shape is: *when did this series first go out of
bounds?* Two flavours exist and today neither is first-class:

- **Set-point detection** on a raw series (e.g. brood temperature < 33 °C
  sustained 12 h) — the "conventional" comparator.
- **Baseline-relative (SPC) detection** on a derived rhythm-metric series
  (e.g. rolling cosinor relative amplitude below baseline mean − 3 SD for
  3 consecutive windows).

One `Crossing` comparator serves both — with the limit either typed in
(set-point) or wired in from a `BaselineLimits` node (SPC) — which makes
the set-point-vs-rhythm comparison symmetric: same node, same persistence
rule, same `crossing` output, two wirings.

The plot half: Scatterplot has no way to draw a reference line (a limit) or
an event line (a detection time). Periodogram draws its own threshold line
internally and `NightBand` proves the Bands-tab overlay architecture; this
plan exposes the same idea as a wireable input.

## A. `Crossing` (condition-rule comparator)

> Revision 4 (2026-09-14). Converged design after discussion:
> thresholds are wired or typed SCALARS referenced from a filter-style
> condition rule; seasonal/reference correction is handled UPSTREAM by
> detrending (RemoveTrend or an explicit subtract chain), not by a special
> input; one node = one rule = one detection. Persistence retained.

### A1. `Crossing` table process

`src/lib/tableProcesses/Crossing.svelte`, registered like `Threshold`
(module `definition` with `displayName`, `defaults`, `func`,
`columnIdFields`, `nodeSpec`).

| port | kind | cardinality | meaning |
|---|---|---|---|
| `xIN` | column | one, optional | time (or any index axis). If wired, outputs and persistence are in x units; if not, sample indices. |
| `yIN` | column | many | series the rule's conditions can reference (`data0`, `data1`, ...) |
| `thresholdIN` | column | many, optional | wired scalar thresholds (length-1 columns) the conditions can reference (`input0`, `input1`, ...) — e.g. the baseline chain's lower limit |

**Rule** (params): a condition list in the style of `FilterByOtherCol`
(`conditions: [{ byColId, isOperator, byColValue }]`, AND-combined), with
two extensions:

- each condition is `{ target, op, source }` where `target` is a wired
  series (`data_i`) or `x`; `op` is `above` / `below` (plus `>=`/`<=`
  variants); `source` is either a typed number (which may be an x/time
  value when target is `x`) or a wired `input_j`;
- conditions group as **OR of AND-groups** (email-filter style; exactly one
  level — no deeper nesting). "Outside a band" is `(data0 above input1) OR
  (data0 below input0)`; a compound cross-sensor rule is
  `(data0 below input0) AND (data1 above input1)`; a gate is
  `... AND (x above 672)`.

Alignment rule: all series referenced within one rule must have equal
length (aligned to `xIN` when wired). Mixing a 63-window metric with a
1680-sample raw series in one rule is an error, never a silent resample.

- `persistence`: the rule must hold continuously for this long before the
  detection fires — in x units when `xIN` is wired (converted via median
  spacing, so 72 h means 3 windows at 24 h step and 6 at 12 h), else a
  number of consecutive values. Default 0 (single sample).

**Outputs** (one rule):

- `breach`: 0/1 per sample (null where any referenced series is missing;
  missing values break a persistence run — a gap never silently completes
  an alert). Needed for plot shading and for debugging why a rule fired.
- `crossing`: column of ALL crossing events — for each, the sample index
  (or the x value there when `xIN` is wired) at which a newly begun
  sustained satisfaction of the rule completes its persistence
  requirement. Re-arming rule: after a crossing fires, the rule must go
  false again before another crossing can fire, so one long excursion is
  one crossing. Empty if never. First element is the real-time first-alert
  time.
- `count`: length-1 column (and stored value) — number of crossings.
  Doubles as a false-alarm statistic on control/survivor series
  (`count > 0`).

Per-series monitoring (e.g. four rhythm metrics, each with its own limits)
is four small `Crossing` nodes — explicit on the canvas rather than a
fan-out mode. Length-1 outputs and length-1 threshold inputs are the same
currency, so crossings can feed other nodes (including other Crossing nodes'
x-gates) and the scatterplot `lines` input directly.

### A2. Baseline limits from existing nodes (no new node)

No `BaselineStats` node: the baseline-limit computation composes from
existing nodes, and the canvas then shows the method. Canonical chain
(the ONLY blessed form — the filter step is what keeps it causally valid):

```
metric ──► FilterByOtherCol(movex <= 672)          # baseline window ONLY
        ──► ColumnFunctions(mean), ColumnFunctions(sd)
        ──► Multiply(sd, k) ──► Add/Subtract(mean, ...)   # mean ± k·SD
        ──► Crossing.thresholdIN   (and scatterplot.linesIN)
```

Leakage caveat (documentation + regression test, since no node enforces it
any more): aggregating over the WHOLE record instead of the baseline
window silently uses post-onset data, which shrinks or inflates limits
with information a real-time monitor would not have and invalidates
detection-time claims. The gallery demo for `Crossing` should ship this
chain, filter step included, so the causally valid wiring is the one users
copy.

### Seasonal / reference correction (upstream, by convention)

The apiary-median or seasonal-drift fix (MSPB: survivor false alarms 82% →
~27%) is expressed as detrending before Crossing: `RemoveTrend` on the
metric series, or an explicit subtract-reference chain, then the
baseline chain + `Crossing` on the residual. Caveat that moves with it:
a trend fitted over the whole record (or a centred sliding window) uses
future data — fine retrospectively, leakage for prospective claims. See
open questions.

### Tests

Fixture = the BeeSpy worked example (hourly, seed 20260724): the canonical
baseline chain (filter to first 672 h, mean ± 3·SD via ColumnFunctions +
arithmetic) feeding `Crossing(persistence 72 h)` per metric, asserting
first crossings at days 35 (rel. amplitude, below), 37 (IS), 43
(acrophase, above), 46 (IV); `Crossing` with a typed threshold asserting
day 55.6 for temperature < 33 °C sustained 6 h. Control-colony series
assert `count = 0` on every metric (the false-alarm check). Plus:
multiple-crossings + re-arming semantics (a series that dips out, recovers,
and dips again yields count 2, not a crossing per sample); OR-group
(outside band) equivalence to two one-sided rules; a compound AND rule
across two metrics; x-gate condition; missing-value run breaking;
mismatched-length error; persistence step-size invariance (12 h vs 24 h
step, same persistence in hours); indices-not-x output when `xIN` unwired;
and the leakage regression test: the baseline chain aggregated over the
full record vs the first 672 h produces different limits on the perturbed
series.

## B. Scatterplot overlays: lines and bands (supersedes the `linesIN` design)

> Revision 5 (2026-09-17). Part B was first specced as a wireable `linesIN`
> port rendered by a `LineMarkerClass` in the Bands tab, then briefly as a
> per-series "draw as lines" toggle. Both were dropped once shaded regions
> entered the picture (a 95% CI ribbon needs two y channels, which a series
> block does not have; a night band needs no wired data at all). What lines
> and bands share is not "they are series" but "they are geometry positioned
> by values", so they become one family: **overlays**. Superseded text is
> kept in git history only.

### B1. Model

Two lists on the scatterplot, not one:

- **Data** (unchanged): series with `x`, `y`, points/line style, colour
  identity, faceted one per child, part of multi-select style operations.
- **Overlays** (the Bands tab, renamed): lines and bands. Replicated onto
  every facet child, explicit colours (never the colour-follows-column
  identity map), fixed draw order (bands beneath the series, lines above).

`ScatterPlotclass.overlays: OverlayClass[]` replaces `nightBands`. One
class, two kinds, and a `form` per kind that decides which channels exist:

| kind | form | channels (all read on the axis in brackets) |
|---|---|---|
| line | `vertical` | `at` (x), dynamic: many columns allowed |
| line | `horizontal` | `at` (y), dynamic |
| band | `ribbon` | `x` (x), `lower` (y), `upper` (y) |
| band | `horizontal` | `lower` (y), `upper` (y) |
| band | `vertical` | `start` (x), `end` (x) |
| band | `repeating` | none: `repeatEveryHours`, `nightDurationHours`, `startTimeHours`, `useDataMin` (today's NightBand fields, unchanged) |

Per overlay: `id` (monotonic, like NightBand), `name` (default "Line N" /
"Band N"), `kind`, `form`, `enabled`, `label` (legend entry when non-empty),
`channels`, and style: lines carry `colour`, `strokeWidth`, `stroke` (the
`STROKE_STYLES` vocabulary, default `'5, 5'`); bands carry `fill` (colour
with alpha, default the NightBand grey `#2C2C2C30` for repeating/vertical/
horizontal, and the first series colour at ~20% alpha for ribbon), `edge`
(boolean, off) with `edgeColour`/`edgeWidth`.

**Channel** = `{ columns: ColumnClass[], typed: number[] }` (`columns` holds
many only for the dynamic `at`; every other channel holds at most one). A
channel is wired OR typed, never both: wiring clears `typed`, typing clears
the wires. Typed input is a number or a comma-separated list. Resolution
(`values()`): wired → the column's finite values (for `at`, the union over
all wired columns); typed → the list; neither → empty. On a datetime x axis
typed x values are stored in RAW axis units (milliseconds), which is what
NightBand's date pickers always stored; the panel therefore enters them
through a date-time picker rather than a number field. Wired x-channel
columns go through the same time-x conversion as series `x`
(`xOriginFor`). `at` is collapsed to finite uniques; paired channels (`start`/`end`,
horizontal `lower`/`upper`) are deduped per PAIR, never per channel
(deduping independently would re-pair `start[i]` with the wrong `end`).
All position-style channels are capped at 50 values (warn beyond it:
"Line 1 has 1680 positions; showing the first 50"). `ribbon`
channels are NOT collapsed; `x`/`lower`/`upper` must be equal length or the
overlay is not drawn and warns (same requirement/actual/remedy wording as
`seriesHealth.js`). Vertical bands pair `start[i]` with `end[i]`; unequal
lengths warn, extra values are ignored.

Warnings render under the overlay block header exactly as dead-series
warnings do: "Band 1 cannot be drawn: lower has no values". A pristine
overlay (nothing wired, nothing typed) is silent, as an unwired series is.

**Axis limits**: overlay positions and band edges extend the AUTO domain so
a reference mark is never silently off-screen; manual limits win.

### B2. Rendering

`plotbits/Line.svelte` gains a `rules` snippet: draws vertical or horizontal
`<line>`s from a list of positions with the shared colour/width/dasharray
and the existing clip path, so any LineClass plot can adopt reference lines
later. Bands render in a new `plotbits/Band.svelte` (ribbon via d3 `area`
with `.defined` on finite lower/upper; rect bands via `<rect>`), which also
absorbs the segment maths from `NightBand.svelte`. `NightBand.svelte` is
deleted once its two responsibilities (repeating-segment maths, controls)
have moved; its tests move with them.

Legend: an overlay with a non-empty `label` contributes one item (line
swatch or filled swatch). `getDownloadData` emits each overlay's resolved
positions/edges under its name. Tooltip: none for overlays in this phase.

### B3. Control panel

`Scatterplot_controlHeaders` becomes `['Properties', 'Data', 'Overlays']`
(tab key `overlays`; `controlTabsCoverage` and the handbook prose follow).
The tab has two add buttons, **+ Line** and **+ Band**. Each overlay block
mirrors a series block: `SeriesBlockHeader`-style header (name, eye toggle,
delete routed through history with the removal toast + Undo, like
`seriesDelete.js`), then:

```
Line 1                                        eye  bin
Form:  [ Vertical | Horizontal ]
At:    [ Column picker ]   or type: [ 35, 55.6 ]
Colour  Width [1.5]  Stroke [Dashed]
Label: [ alert ]
```

```
Band 1                                        eye  bin
Form:  [ Ribbon | Horizontal | Vertical | Repeating ]
x:     [ Column picker ]
Lower: [ Column picker ]   or type: [    ]
Upper: [ Column picker ]   or type: [    ]
Fill (with opacity)   [ ] edge line
Label: [ 95% CI ]
```

Changing the form swaps the channel rows in place; channels that no longer
apply are unwired (edge removed from the canvas) and their typed values
cleared. Channel pickers are the same `Column` component series x/y use
(`<Column col={ch.column} canChange={true} />`).

### B4. Canvas node ports

`ProcessNode.svelte.js` derives plot input ports from `plot.plot.data`
("Series N" groups of `xN` + dynamic `ysN`). It now also emits one group
per overlay from `plot.plot.overlays`, headed by the overlay's name, with
ports named `ov<id>_<channel>` (e.g. `ov3_at`, `ov3_lower`), display
`at (x)`, `lower (y)`, ... per the table, `dynamic: true` only for `at`.
`plotNodeSlots`/`WorkflowNode.svelte` render the group under its header
like a series group. There is NO trailing empty overlay group (a form must
be chosen before ports exist); overlays are created in the panel or via
MCP, and their ports then appear. Wire-apply and disconnect resolve
`ov<id>_<channel>` to the overlay channel's `columns` (replace for
single channels, append for dynamic `at`) via the `OverlayClass` API:
`setWire(key, refId)`, `addWire(key, refId)`, `removeWire(key, refId)`;
`OverlayClass.channelsFor(kind, form)` returns the ordered
`[{ key, axis: 'x'|'y', dynamic }]` list the port emitter iterates. Passthrough output ports are NOT emitted for overlay columns.
Right-click column picker works unchanged (it is per port name).

### B5. Persistence, guards, migration

`toJSON` writes `overlays: [...]` (channel → `{ columns: [{refId}...], typed }`)
and no longer writes `nightBands`. `fromJSON` reads `overlays` with `??`
guards, and MIGRATES a legacy `nightBands` array: each becomes a band
overlay of form `repeating` (mode 'repeating') or `vertical` with
`start`/`end` typed from `customBands` (mode 'custom'), keeping `name`,
`colour` → `fill`, `enabled`. A loadjson test pins the migration on a
real demo session that ships night bands. Update `plotFromJSONRobustness`,
`portVsStorageFields` (new port family), `plotDownloadData`, and the
`controlTabsCoverage` expectations.

Facets: `core/Plot.svelte` facet sync copies the generator's overlays onto
every child (by JSON round-trip, idempotent, like series today) so a
reference line appears on all small multiples.

### B6. MCP surface

`add_plot` / `render_plot` accept `overlays: [{ kind, form, name?,
label?, channels: { at?: [colId...] | [numbers...], lower?: colId |
number, ... }, colour?/fill? }]` mirroring the GUI one to one; numbers are
typed values, column ids are wires. `nightBands` inputs, if any exist in
the MCP schema, map to repeating bands. Session schema regenerates.

### Canonical wiring (the manuscript figure)

```
MovingAnalysis(cosinor).rel_amplitude -> FilterByOtherCol(movex <= 672)
    -> ColumnFunctions(mean, sd) -> mean - 3*sd            # lower limit scalar
    lower -> Crossing.thresholdIN  (rule: data0 below input0, persist 72 h)
    lower -> scatterplot Line(horizontal).at
    Crossing.crossing -> scatterplot Line(vertical).at   # one line per crossing
    rel_amplitude -> scatterplot.y ; movex -> scatterplot.x
```

Temperature comparator: the same `Crossing` node with a typed threshold on
the raw series, its `crossing` wired as a second vertical line (or the
threshold simply typed into a horizontal line) on the same plot.

### Tests (Part B)

Unit: channel resolution (wired/typed exclusivity, union over dynamic
`at`, uniques + cap + warning, ribbon length mismatch warning, vertical
band pairing); overlay toJSON/fromJSON round trip incl. `??` defaults;
nightBands migration on a shipped demo; legend items; download data;
domain extension; port emission (`ov<id>_<channel>` names, display,
dynamic flag, no passthroughs) and wire-apply/disconnect for both a single
and a dynamic channel; facet replication. E2E (Playwright): open the
Crossing demo, add a vertical line wired to `crossing` and a horizontal
line wired to the lower limit, assert the SVG contains the expected
`<line>` elements at the scaled positions; add a ribbon band from typed
and wired channels; night band demo still renders identical segment
rects after migration.

## Phasing

1. `Crossing` node + tests + the canonical baseline-chain gallery demo
   (removes the constant-column/Threshold workaround; sessions become
   self-computing).
2. Overlays (Part B, revision 5): model + rendering + Overlays tab +
   ports + persistence/migration + facet replication + MCP `overlays`.
3. Deferred: an **event-raster plot type** (rows = series/hives, ticks at
   event times) for many-unit displays like the MSPB alert timeline —
   separate plan if wanted; `crossing` outputs are already the right
   input shape for it.

## Open questions

- Should `RemoveTrend` gain a causal/trailing mode (fit on past data only),
  so the detrend-then-detect chain stays valid prospectively? Until then, a
  docs note on the leakage risk of whole-record or centred-window trends
  feeding `Crossing`.
- Should a persistence run *pause* across short gaps rather than reset
  (`maxGap` tolerance)? Reset is specced; MSPB-like data (35 % missing) may
  argue for tolerance.
- Exit/recovery times: `crossing` reports entries into the alarm state; a
  matching `recovery` output (when the rule goes false again) is a cheap
  extension if relapse analysis matters.
- Whether `Threshold` deprecates into a one-condition `Crossing` with
  persistence 0 (identical semantics), or stays as the simpler teaching
  node.
- Condition UI: reuse the `FilterByOtherCol` row component with the added
  OR-group boundary, or a dedicated rule builder?
