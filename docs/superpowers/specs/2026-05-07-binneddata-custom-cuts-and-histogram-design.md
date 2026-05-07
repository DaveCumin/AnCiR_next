# BinnedData Custom Cuts and Histogram Plot — Design

**Date:** 2026-05-07
**Status:** Approved (awaiting implementation plan)
**Scope:** v1

## Summary

Add user-specified bin edges ("custom cuts") to the existing BinnedData table process, then add a new Histogram plot built on the same binning helper. Each histogram series carries its own column and its own bin configuration so different series can use different cuts.

## Decisions locked in during brainstorming

| Question | Decision |
|---|---|
| Histogram = count aggregation? | Yes. Add `'count'` to `aggFunction`. |
| Cut input UX | Free-text list of edges (e.g. `0, 1, 2.5, 5, 10`). |
| Per-data binning location | Plot-level only. BinnedData TP keeps shared-X output. |
| Custom cuts for time-typed X? | Disallowed in v1. Numeric X only. |
| Out-of-range values | Dropped (matches current `binData` behaviour). |
| Normalisation / density toggle | Counts only in v1. |
| Out-of-range warning | Surface a visible warning whenever any value is dropped. |
| Code-sharing approach | Approach 1: share the helper only; UI is duplicated between TP and plot for v1. |

## Architecture

Three deliverables, in build order:

1. **Helper layer** — extend [`binData()`](../../../src/lib/components/plotbits/helpers/wrangleData.js) with optional `cuts` and `'count'` aggregation, return new `binEnds` and `droppedCount`.
2. **BinnedData TP** — bin-mode select (`uniform` / `cuts`), conditional UI, out-of-range warning row.
3. **Histogram plot** — new `src/lib/plots/Histogram/Histogram.svelte`, auto-loaded by [plotMap.js](../../../src/lib/plots/plotMap.js). Each series has its own column + bin config; bars rendered via the existing [`Hist.svelte`](../../../src/lib/components/plotbits/Hist.svelte) plotbit (which already supports variable-width bars).

## Helper layer: `binData()` changes

New signature (all old positional args preserved; `cuts` is a new optional arg):

```js
binData(xValues, yValues, binSize, binStart = 0, stepSize = null, aggFunc = 'mean', cuts = null)
```

### Behaviour

- **Cuts mode** — when `Array.isArray(cuts) && cuts.length >= 2`:
  - Edges must be strictly ascending (caller is responsible for sort + dedupe; helper rejects non-ascending input by returning the empty result).
  - Produces `cuts.length - 1` bins. Bin `i` covers `[cuts[i], cuts[i+1])`.
  - Final bin is closed on the right `[cuts[n-2], cuts[n-1]]` so the largest edge is inclusive.
  - `bins[i] = cuts[i]`; `binEnds[i] = cuts[i+1]`.
  - `binSize` / `binStart` / `stepSize` are ignored.
- **Uniform mode** — when `cuts` is null/empty: existing logic, plus we now also return `binEnds[i] = bins[i] + binSize` so consumers have one shape regardless of mode.
- **`'count'` aggregation** — returns the number of paired finite x/y rows landing in the bin (`end - start`). Y values are unused, so callers histogramming a single column can pass `xValues` for both `xValues` and `yValues`.
- **`droppedCount`** — count of rows with finite x/y that don't land in any bin. In uniform mode that's anything below `binStart` or beyond the last produced bin's end. In cuts mode that's anything outside `[cuts[0], cuts[n-1]]`.

### Return shape

Changes from `{ bins, y_out }` to `{ bins, binEnds, y_out, droppedCount }`. Existing callers destructure named keys (e.g. [BinnedData.svelte:78](../../../src/lib/tableProcesses/BinnedData.svelte)) so the addition is non-breaking. During planning, grep all `binData(` callers to confirm no one reads by index or relies on object identity.

## BinnedData TP changes

### Defaults additions

```js
['binMode', { val: 'uniform' }],   // 'uniform' | 'cuts'
['cuts', { val: [] }],             // sorted ascending; only used when binMode === 'cuts'
```

`aggFunction` gains `'count'` as an allowed value.

### `binneddata()` function

- Read `binMode` and `cuts` from `argsIN`.
- Validation: if `binMode === 'cuts'`, require `cuts.length >= 2` and strictly ascending; otherwise return invalid result `[{...}, false]`.
- Block custom cuts when X is time: if `xInCol.type === 'time' && binMode === 'cuts'`, treat as invalid. Mode select is disabled in the UI in that case, but defensive check stays in the function.
- Pass `cuts` to `binData()` when `binMode === 'cuts'`; otherwise pass `null`.
- Sum `droppedCount` across all Y inputs and expose it on the result so the UI can render the warning.
- Output column metadata in cuts mode: `binWidth = null`, `binStep = null`, `cutsList = cuts`. In uniform mode: clear `cutsList` so toggling resets cleanly.

### UI changes

The `<!-- Bin Parameters -->` block ([BinnedData.svelte:348-406](../../../src/lib/tableProcesses/BinnedData.svelte)):

- Add a "Bin mode" select at the top of the bin-parameters section: `Uniform | Custom edges`. Disabled with a tooltip when X is time.
- When `binMode === 'uniform'`: existing controls render unchanged.
- When `binMode === 'cuts'`: hide size/start/step/diffStep; show a single text input "Cut edges (comma- or space-separated)" plus a parsed-edge count summary (e.g. "5 edges → 4 bins"). Parsing is lenient: split on `[,\s]+`, drop empties, parse floats, drop NaNs, sort ascending, dedupe. The `aggFunction` select stays visible and now includes `Count`.
- Below the controls, when `binnedData?.droppedCount > 0`, render a `data-warning` row (style already used in [Boxplot.svelte:912](../../../src/lib/plots/Boxplot/Boxplot.svelte)): "⚠ N values dropped (outside bin range)".

### Reactivity

`getHash` ([BinnedData.svelte:219-228](../../../src/lib/tableProcesses/BinnedData.svelte)) gains `binMode` and `JSON.stringify(cuts)` so changes trigger recompute.

### Backward compat

The migration block at [BinnedData.svelte:163](../../../src/lib/tableProcesses/BinnedData.svelte) gains:

```js
if (p.args.binMode === undefined) p.args.binMode = 'uniform';
if (!Array.isArray(p.args.cuts)) p.args.cuts = [];
```

Older saved sessions load with `binMode === 'uniform'` and produce identical output to before.

## Histogram plot (new)

New folder `src/lib/plots/Histogram/Histogram.svelte`. Auto-loaded by [plotMap.js](../../../src/lib/plots/plotMap.js); no manual registration. Structure mirrors [Boxplot.svelte](../../../src/lib/plots/Boxplot/Boxplot.svelte).

### `script module` exports

- `Histogram_defaultDataInputs = ['column']` — single column per series (the values to histogram).
- `Histogram_controlHeaders = ['Properties', 'Data']`.
- `definition = { defaultDataInputs, controlHeaders, plotClass: Histogramclass, sharedFields, dataSharedFields }`.

### `HistogramDataClass` (per-series state)

```
column: ColumnClass        // the values to histogram
label: string              // 'Histogram 1' default
binMode: 'uniform'|'cuts'  // default 'uniform'
binSize, binStart, stepSize, diffStep    // uniform mode
cuts: number[]             // cuts mode
fillColour, fillOpacity, stroke, strokeWidth  // bar style
```

A `$derived` getter `binned` runs `binData(values, values, binSize, binStart, stepSize, 'count', cuts)` and returns `{ bins, binEnds, y_out, droppedCount }`. Recomputed when the column's data hash or any bin param changes.

### `Histogramclass` (plot-level state, mirrors `Boxplotclass`)

- `padding`, `xlimsIN`, `ylimsIN`, `xAxis`, `yAxis`, `legend`.
- `xlims = $derived` from union of all series' `[bins[0], binEnds[last]]`, padded via `niceAxisLimit`.
- `ylims = $derived` from `[0, max(y_out)]` across all series, padded via `niceAxisLimit`.
- `getLegendItems`, `getDownloadData` (CSV with one row per series × bin, columns: `series, bin_start, bin_end, count`).
- `toJSON` / `fromJSON` for session persistence; `cuts` and `binMode` round-trip per series.

### Plot snippet

Linear x and y scales. For each series render one `<Hist>` plotbit, passing `xStart=bins`, `xEnd=binEnds`, `y=y_out`, plus the standard scales/colours. No dodge for v1 — series overlay on the same axes with semi-transparent fill (acceptable for 2-3 series; users can hide series via legend).

### Controls snippet

- **Properties tab:** dimension, padding, X-axis label, Y-axis label, Y limits.
- **Data tab:** per-series block with:
  - `Column` selector (single column).
  - Bin-mode select (disabled when chosen column type is `time`).
  - Conditional uniform fields *or* cuts text input (parity with TP).
  - Fill colour / opacity / stroke. (During planning: check whether there's a shared bar-style component analogous to `Box.svelte`; otherwise use inline `NumberWithUnits` + colour picker following the Boxplot styling pattern.)
  - Out-of-range warning row when `binned.droppedCount > 0`.

### Acknowledged duplication

The size/start/step/cuts inputs in this per-series block are the same JSX shape as in BinnedData TP, just bound to per-series state instead of `p.args`. If this duplication becomes a maintenance burden, extracting `BinConfigInputs.svelte` is a one-evening refactor. Out of scope for v1.

## Testing

### Helper

- Cuts mode produces `n - 1` bins with correct edges and counts.
- Non-ascending cuts input → empty result (rejected, not auto-sorted at helper level).
- Final bin includes the largest edge (closed-right on the last bin only).
- `'count'` aggregation returns row counts and ignores Y.
- `droppedCount` counts only finite x/y rows that fall outside the bin range.
- Uniform mode unchanged: existing tests pass; new `binEnds` array correct.

### BinnedData TP

- Toggle `binMode` → outputs recompute, X column metadata switches between `binWidth/binStep` and `cutsList`.
- Switching X to a time column while in cuts mode disables the mode select and treats config as invalid.
- Saved-session migration: a session pre-dating `binMode` loads with `binMode === 'uniform'` and produces identical output.
- `count` aggregation across the existing Y-input flow produces per-Y count columns.

### Histogram plot

- Single series renders bars at correct x positions with correct heights.
- Two series with different cuts overlay correctly; legend renders both.
- `droppedCount` warning shows per-series.
- `getDownloadData` produces correct CSV.
- `toJSON` / `fromJSON` round-trips bin config and cuts.

A plot-level test pattern check is needed during planning — confirm whether other plots have unit tests; if not, the histogram plot relies on visual / manual testing.

## Migration and backward compat

- New defaults (`binMode`, `cuts`) handled by the migration block at [BinnedData.svelte:163](../../../src/lib/tableProcesses/BinnedData.svelte).
- `binData()` return shape gains two keys (`binEnds`, `droppedCount`); existing destructuring callers keep working. Grep `binData(` during planning to confirm no caller relies on shape / index.

## Edge cases

- Cuts text parser: split on `[,\s]+`, parse floats, drop NaN, sort ascending, dedupe. Fewer than 2 valid edges → invalid config (warning shown, no output).
- Single bin (exactly 2 edges): supported; produces one bar.
- All values dropped (cuts entirely outside data range): output is N empty bins (counts all 0); warning shows the full input count.
- Histogram plot with 0 series or a series with no data: empty plot, no crash.

## Out of scope (v1)

- Density / relative-frequency normalisation toggle.
- Overflow / underflow bins (`-Inf` / `+Inf`).
- Per-Y custom cuts inside BinnedData TP.
- Time-typed X custom cuts (datetime parser).
- Dodged (side-by-side) bars when multiple series share x ranges.
- Extracting `BinConfigInputs.svelte` shared component.
