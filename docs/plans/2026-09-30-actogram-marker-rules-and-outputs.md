# Plan: Actogram marker rules and their output ports

> Status: Phase A, Phase B1 (JavaScript outputs) and Phase B2 (the Python and R ports, with
> `actogramMarkers` parity fixtures) implemented (uncommitted, 2026-09-30); decisions and
> as-built notes below.
> Originally: planning only (2026-09-30), written against HEAD v77.0 (`d323dac1`) with the
> two uncommitted, verified changes in the tree (the actogram "Add line" preset removed;
> the Save dialog's export label order follows the Plots list). Nothing in this document
> has been implemented. This is Phase 3 of `docs/plans/2026-09-26-facets-as-views.md`
> generalised from facet panels to every series of one actogram. Decisions already taken
> by the author (rules are plot-level and AUGMENT per-series blocks; per-series data stays
> per series; editing an instance detaches it; output ports come from rules; the
> component-lifetime stored values are superseded) are designed around, not reopened.
> Where the code disagrees with one of them, section 0.5 says so with evidence.

## Decisions (2026-09-30)

The author answered the open questions (7.2) and the parity question (2.5). Where a
decision changes a section below, that section now says so and points here.

- **1a (Q1). A rule's shared day range scopes BOTH the fit and the drawing.** A day
  (row) contributes to a series' fit only if it lies inside the rule's
  `lineMinDay..lineMaxDay` AND is ticked in that series' own `selectedPeriods`. The line
  is drawn over the rule's range. phi is reported at the range's first day for every
  series (so phi is comparable across animals) unless the rule sets `phaseRefDay`.
  Existing per-series blocks keep today's meaning (the range clips the drawing only), so
  no saved session changes. Consequences: the rule's `excludedDays` list (1.2, 1.3, 3.1
  item 5) is DROPPED, because range plus per-series ticks already express the fit scope;
  own blocks gain one persisted boolean, `fitWithinRange` (default false, written only
  when true), so a block DETACHED from a rule is an exact copy of its instance and
  computes identical numbers, and so a user can opt an own block into the rule
  semantics. Promote carries the block's range into the rule; if the block had selected
  markers outside its range, the rule's numbers differ from the block's and the promote
  says so in its toast (5.1).
- **2b (Q7, 0.5 item 4). The tau OUTPUT is the harmonic-check pick** (today's "Est tau":
  `harmonicCheck.strongest.peakPeriod`, among tau, tau/2 and 2 tau against the
  periodogram), NOT the fitted slope. The drawn line still shows the fitted slope. This
  reverses 2.3's `tau` bullet and removes the tau warning from the stored-value migration
  (5.2 step 2): a legacy `tau_` value mapped onto the port keeps its meaning. Because
  the harmonic check is a periodogram (about 0.8 s per block on a 30-day one-minute
  record for the warnings scan; the harmonic check itself is three single-period
  evaluations), it must be computed once per instance and cached, and never on an
  unrelated edit: it depends on the fitted slope VALUE (a number, so an edit that
  recomputes the regression without moving the slope does not recompute it) and on the
  series data, nothing else. Phase A lands that dependency narrowing; Phase B reads it.
- **3a. phi is in hours after the actogram row start**, as today's "Est phi" (2.3 is
  unchanged).
- **4a (Q2). Each rule also outputs `n`**, the number of markers that entered the fit
  (`r<id>_n`, Phase B). Five keys per rule, not four.
- **5a. Correcting a detected onset on one series detaches that series from the rule**
  (0.5 item 3 as proposed): the block becomes that series' own, carrying `fromRule`;
  "Reattach to rule" reverses it. Dragging an instance's line is a settings change and
  detaches in the same way (3.3), one undo step.
- **Parity (supersedes the 2.5 recommendation). Python and R WILL implement** marker
  rules, template detection, the day selection (range AND ticks), the four constrained
  fits, phi, and the harmonic check, with cross-language fixtures (a new
  `actogramMarkers` fixture kind). Phase B work, after the JS model settles. Phase A
  therefore keeps detection, day selection and fitting in pure modules with no Svelte
  state, taking plain arrays and returning plain objects (`onsetUnwrap.js`,
  `lineFit.js`, and the new `markerSelection.js` for the day-selection rule), so the
  ports mirror them function by function. The GUI-only registry of 2.5 still applies to
  the four existing plot metric types.
- **Q4, Q5, Q6 (not asked; Phase A takes the plan's proposals).** Q4: a rule lock
  flipped to Fixed seeds from the median of the instances' drawn values. Q5: Reattach is
  always offered on a block whose `fromRule` names a live rule. Q6: per-day ticks and
  hand-placed points stay unrecorded in history, for rules and blocks alike.

## Phase A as built (2026-09-30)

Uncommitted in the tree. Where the build differs from sections 1 to 6, this list is the
record; the sections keep the original design for context.

- **Modules.** `plots/Actogram/markerSelection.js` (pure day selection: range AND ticks),
  `markerRules.svelte.js` (`MarkerRule`, `RuleInstance`, `reconcileRuleInstances`, the
  in-place actions `addRule`, `removeRule`, `detachInstance`, `reattachBlock`,
  `promoteBlock`, `matchingBlocks`, `seedFixedValue`, `instanceSummary`),
  `markerRuleActions.js` (the recorded, one-undo-step versions: `setRuleSettings`,
  `addRuleRecorded`, `removeRuleRecorded`, `detachRecorded`, `reattachRecorded`,
  `promoteRecorded`), `MarkerRuleBlock.svelte`, `ruleDom.js`; op `setMarkerRule` in
  `operations.js` (+ `mutationService.setMarkerRule`, coalesced like `setPlotProperty`).
- **cfg/store refactor** landed first as a no-behaviour change: every derived and method
  of `PhaseMarkerClass` reads settings through `this.cfg` and per-series data through
  `this.store` (both `this` on an own block). Evidence: the pre-refactor class and the
  refactored one agree on 56 series x block-shape combinations over four demos, and the
  full suite stayed at 4744.
- **Decision 1a** is `fitWithinRange` (own blocks, default false, persisted only when
  true) plus the rule instance's `cfg.fitWithinRange === true`; there is no `excludedDays`.
  Days outside the range show "outside range" and a disabled tick in the per-day list.
- **`ruleData` is created on first WRITE** (a tick, a hand-placed point), not by the
  reconcile, so a rule that nobody has customised adds no per-series JSON. `toJSON` drops
  `ruleData` and `detachedRules` entries whose rule no longer exists (undo does not need
  them: it restores whole inner snapshots). `nextRuleId` is repaired on load from rule ids,
  `fromRule` ids and `ruleData` keys, so a dead rule's id is never reused.
- **Settings edits on an instance** are made in the component (`editSettings` in
  PhaseMarker.svelte), not by a `requireOwn` on the class: the recording layer cannot be
  imported by the model without a cycle. The instance's `cfg` throws on any settings write
  except the drag's line fields, so a missed path fails loudly. The drag previews on the
  instance's own `local` override (the rule is never touched) and pointerup detaches with
  the final line, one undo step (Decision 5a). Correcting a detected time, a type, N, M, %,
  a lock, a colour, a size: each detaches with the edit, one step, with an Undo toast.
- **Harmonic check** depends on `fittedSlope` (a number) rather than the regression
  object, so style and reference-day edits do not re-run it. On an instance, "Est tau" and
  the warnings scan sit in a closed "tau check against the periodogram" section and are
  computed only while it is open. So on an instance the `tau_` StoreValueButton mounts
  only when that section is open; phi, R2 and RMSE buttons mount as on blocks.
- **`showLine`** now loads with `?? true` instead of `|| true` (an unticked "Show Line"
  used to come back ticked on every load and every recorded edit).
- **Promote** carries the block's colour only when it differs from its series' colour
  (else "each series' colour"), and toasts when the rule's range-scoped fit changed the
  promoted series' numbers. The "also replace matching blocks" offer is built.
- **Not done in Phase A:** the `nodeNotes.js` actogram entry (it is baked into generated
  demos; it belongs with the Phase B ports text). The handbook Ch05 paragraph is done.

## Why

An actogram's marker and line blocks live on ONE series each
(`ActogramDataclass.phaseMarkers`). A user with twelve animals who wants "activity
onsets, N 3, M 3, 50 %, fit tau, fit theta, days 4 to 18" on every animal adds twelve
blocks and types the same six numbers twelve times; changing the threshold later means
twelve more edits, and nothing guarantees the twelve stayed the same. The statistics the
blocks compute (tau, phi, R squared, RMSE) are not wireable: they reach the rest of the
app only as stored values that exist while the block's controls are mounted
(`StoreValueButton` registers on mount and unregisters on destroy), one scalar per
block, never a per-animal column that a Rayleigh test, a group comparison or a formula
could consume. The node note for the group-phase workflow already tells users to "swap
the Cosinor node for ... an actogram onset marker" (`src/lib/_demos/nodeNotes.js:135`),
which today cannot be wired at all.

The replacement is a rule: one plot-level definition, projected onto every series as a
computed block instance, with the per-series facts (which days count, hand-placed
points, the detections themselves) kept per series, and four output columns per rule,
one value per series, in exactly the shape the Periodogram, FFT, Correlogram and Q-Q
plots already emit.

## 0. Inventory: what the code does today

Grepped every extension under `src/`, `mcp/`, `tools/` (excluding `tools/benchmarks/`),
`handbook/src`, `static/`, `tests/`, `docs/` for `phaseMarker`, `PhaseMarker`,
`selectedPeriods`, `estimatedPhase`, `harmonicCheck`, `StoreValueButton`,
`storedValues`, `PLOT_METRIC_DEFS`, `metricOut` and the four stored-value name prefixes.
The untracked `Band [conflicted].svelte`, `dbg-datapanel.png` and
`tools/benchmarks/paper/*_Data.json` were ignored, as instructed.

### 0.1 Counts

| Set | Count |
|---|---|
| Non-test source files that reference `phaseMarker(s)`/`PhaseMarker` | 5 (`Actogram.svelte` 20 hits, `PhaseMarker.svelte` 8, `facetMigration.js` 4, `lineDrag.js` 1 comment, `lineFit.js` 1 comment) |
| Sites that iterate or mutate `datum.phaseMarkers` | 15 (`Actogram.svelte` 218, 304, 346, 358, 375-376, 710-712, 886, 1185, 1326; `PhaseMarker.svelte` 754, 756, 796) |
| Test files that exercise phase markers | 7 (`PhaseMarker.drag`, `.locks`, `.loadjson`, `Actogram.legend`, `Actogram.click`, `facetWriteThrough`, `lineDrag`, plus `lineFit.test.js` and `onsetUnwrap.test.js` for the pure maths) |
| Fixtures carrying phase markers | 1 (`src/test/fixtures/facet-actogram-markers.json`: one onset block and one manual block on generator series 0 after migration) |
| Shipped sessions (`static/sessions/**`) with any phase-marker block | 0 (15 actograms in 14 files, every one with `phaseMarkers: []`) |
| Shipped multi-series actograms | 3 (`demo-workflow-rest-activity.json` plot 0, `demo-workflow-arrhythmic.json` plot 39, `demo-workflow-split-rhythm.json` plot 51; 2 series each) |
| `StoreValueButton` uses in `PhaseMarker.svelte` | 4 (lines 1001, 1023, 1051, 1058) of 16 components app-wide that use it |
| `PLOT_METRIC_DEFS` entries | 4 (periodogram, fft, correlogram, qqplot) |
| Consumers of `PLOT_METRIC_DEFS[...].keys` | 3 (`plotMetricOutputs.svelte.js:104` in `syncPlotMetricColumns`, `:136` in `writePlotMetricOutputs`, `src/lib/core/Plot.sourceNodeId.test.js:59`) |
| Plot types with `usePlotMetricOutputs` | 4 (`Periodogram.svelte:828`, `FFT.svelte`, `Correlogram.svelte`, `QQPlot.svelte`) |
| Python / R runtime code for phase markers or plot metric outputs | 0 / 0 (`tools/ancir_runtime.py` has actogram BINNING for plot-data export at 5642-5667; `tools/ancir_runtime.R` has no actogram code at all; the `peak_period` hits in both are Moving Analysis) |
| Manifest / MCP schema entries for any plot output | 0 (`buildNodeManifest.js:125` hard-codes `outputs: []` for every plot; `mcp/src/emit/gen-schema.js:218-232` emits `inputs`, `supportsBands`, `overlays`, no outputs) |

### 0.2 How a phase-marker block works today

| Concern | Where | What it does |
|---|---|---|
| Storage | `Actogram.svelte:218` | `ActogramDataclass.phaseMarkers = $state([])`, an array of `PhaseMarkerClass`. Persisted in the series' `toJSON` (358) and rebuilt in `fromJSON` (375-377). There is no plot-level marker state. |
| Identity | `PhaseMarker.svelte:22, 415-416` | `id` comes from a module counter and is NOT persisted: every load, every `fromJSON` (so every `recordInnerEdit`) mints new ids. `name` is persisted and defaults to `'marker_' + id` on first creation. |
| Settings | `PhaseMarker.svelte:25-63` | `name`, `type` (`onset`/`offset`/`manual`), `centileThreshold`, `templateHrsBefore` (N), `templateHrsAfter` (M), `colour`, `showLine`, `showMarkers` (never read by the renderer), `lineWidth`, `markerSize`, `lineMinDay`/`lineMaxDay` (1-indexed), `phaseRefDay`, `fitSlope`/`fitIntercept` (storage encoding of the fixed tau/theta), `lockTau`/`lockTheta` (`fit`/`fixed`). |
| Per-series data | `PhaseMarker.svelte:44-45` | `selectedPeriods` (booleans indexed by 0-based ROW, shown as 1-based "Periods" checkboxes) and `manualMarkers` (absolute hours since the plot's start). Both are fields of the block, so today they are indistinguishable from settings. |
| Detection | `151-165` (`templateMatches`), `onsetUnwrap.js:95-157` | Per row, a +1/-1 template of N and M hours is matched against the above/below-centile sequence of that row plus the next; returns the hour-in-row and the absolute time (which may fall in the next row). |
| Markers per row | `167-186` (`markers`) | Manual: absolute times grouped by row. Onset/offset: `templateMatches.hours`. |
| Unwrap and fit | `189-201`, `278-293`; `lineFit.js` | `markerAbsoluteTimes` and `unwrapOnsets` build (day, absolute time) points from the SELECTED rows; `fitLine` fits slope (= tau) and intercept with each of tau/theta independently fitted or fixed; residuals (R squared, RMSE) are always of the line as drawn against the selected markers, null when there are none. |
| Day range | `38-39`, `260-267`, `1070-1100` | `lineMinDay`/`lineMaxDay` clip the DRAWN line and default the reference day. They do NOT restrict which markers are fitted; only `selectedPeriods` does (see 0.5 item 2). |
| Phase | `299-309` (`estimatedPhase`) | `markerHourPred = slope*refDay + intercept - refDay*P`, wrapped by `wrapPhaseToRow` (`onsetUnwrap.js:331-337`) into `[0, tau)` then folded into `[0, P)`. Units: HOURS after the start of the row, where row 0 starts at the plot's `startTime` (the earliest valid sample over ALL series, snapped to start of day in the display zone, `Actogram.svelte:527-560`). Clock time only when that snap is midnight and `P = 24`. |
| Harmonic check | `312-360` | Three single-period Lomb-Scargle evaluations at tau, tau/2, 2 tau (margin 0), picks the strongest. The UI's "Est tau" and the `tau_` stored value are `harmonicCheck.strongest.peakPeriod`, which is tau/2 or 2 tau when those win (0.5 item 4). |
| Warnings | `363-381`, `onsetUnwrap.js:343-416` | `assessOnsetFit` (too few onsets, tau on the row length); calls `periodogramPeak` over `[P/2, 1.5P]` at 0.05 h, the single most expensive thing a block does (section 8). |
| Drawing | `Actogram.svelte:1324-1329`; `PhaseMarker.svelte:1106-1165` | One `<PhaseMarker which="plot">` per block, inside the series' clip group, OUTSIDE the `{#if datum.draw}` branch (hidden series keep their markers). Line copies a whole tau either side (`lineCopyOffsets`). |
| Editing | `PhaseMarker.svelte:786-1104` | Every field is a direct `bind:` or `onchange` mutation. None is recorded in history except the line drag (0.5 item 6). Deleting a block is a direct `filter` (796). |
| Computed-to-manual | `384-410` (`editMarker`) | Typing a new hour for one detected marker converts the WHOLE block to `type: 'manual'`, freezing every other detection's true absolute time into `manualMarkers`. (The brief cites 412-427; in the current tree the method is 384-410 and the constructor starts at 412.) |
| Click to place | `Actogram.svelte:440, 706-715, 868-894` | "Add markers" arms `plot.isAddingMarkerTo = marker.id`; a click on the plot calls `addPhaseMarkerTo(id, day, hrs)`, which searches every series' `phaseMarkers` for that id and calls `addTime`. |
| Drag | `PhaseMarker.svelte:562-747`, `lineDrag.js` | Lazy pointer capture; moves call `setTau`/`setTheta` (which flip the lock to Fixed); pointerup rewinds and replays through `recordInnerEdit`, so one gesture is one undo step. |
| Locks | `PhaseMarker.svelte:57-139`, `.locks.svelte.test.js` | `pinCurrentLine` seeds `fitSlope`/`fitIntercept` from the line as drawn so flipping a lock or typing a value never makes the line jump. |
| Legend | `Actogram.svelte:291-342, 664-672` | `getMarkerLegendItems` emits one entry per block that draws something (`markersDrawn`, `lineDrawn`), labelled by the block name or `"<series> marker <i>"`; plot-level `getLegendItems` interleaves series and their blocks. |
| Facet write-through | `facetPanels.svelte.js:237-241` (`panelSeriesTarget`); `Actogram.svelte:868-894`; `PhaseMarker.svelte:743-757` (`markerWriteTarget`) | On a facet panel, a click or drag is written to the GENERATOR's series `unit.seriesIdx[j]`, block index `k`, never to the panel's projected copy. Pinned by `facetWriteThrough.svelte.test.js`. |
| Facet migration | `facetMigration.js:307-311` | A legacy child's `phaseMarkers` that the generator series lacks are copied onto generator series i and reported as moved. |
| Stored values | `PhaseMarker.svelte:1001-1061` | Four `StoreValueButton`s per block: `tau_<name>` (harmonic pick), `phi_<name>` (`estimatedPhase.phase`), `marker_r_squared_<name>`, `marker_rmse_<name>`. See 0.4. |

### 0.3 How plot metric outputs work today

| Concern | Where | What it does |
|---|---|---|
| Definition | `plotMetricOutputs.svelte.js:28-72` | `PLOT_METRIC_DEFS[type] = { keys: string[], statsFor(datum) }`. Four types, static key lists: `peak_period`/`peak_power`/`peak_pvalue`; `peak_period`/`peak_frequency`/`peak_magnitude`; `peak_lag`/`peak_correlation`; `qq_r`/`qq_n`. Missing stats are `NaN` via `?? NaN`. |
| Eligibility | `78-80` (`isMetricPlot`) | `plot.generator == null` (so a facet PANEL never emits) and a def exists. |
| Columns | `97-127` (`syncPlotMetricColumns`) | `plot.metricOut = { key: colId }` on the WRAPPER `Plot` (persisted, `Plot.svelte:301, 363-365, 394`). Keys not in `desired` have their column deleted (`core.rawData.delete` + `removeColumn`); missing keys get a fresh `Column` named `${key}_${plot.id}`. Must run deferred (derived_inert). |
| Values | `130-142`, `157-172` | `usePlotMetricOutputs(getPlot, isActive)` is an `$effect` in the component instance mounted with `which === 'plot'`; it reads `plotMetricStats(plot)` (one object per series, in data order), JSON-snapshots it, and in a microtask syncs the columns and writes the values with a fresh `processHash`, skipping unchanged snapshots. Deliberately not a global effect (file header: eager Correlogram/FFT deriveds froze the main thread). |
| Node ports | `ProcessNode.svelte.js:454-466, 891-898` | Every metric column becomes an output port `col_<colId>` on the plot node with `display = key`, `metric: true`. Consumers are wired by COLUMN ID. The port id never contains the key. |
| Manifest / MCP | `buildNodeManifest.js:109-125`, `gen-schema.js:218-232` | Plots carry `outputs: []`; the MCP schema lists no plot outputs. The existing four defs are therefore invisible to `nodes.json`, the handbook Node Reference, `sampleSizePolicy.test.js` (which reads `nodes.json`, so the periodogram's `peak_pvalue` escapes it) and the MCP model. |
| Python / R | `tools/test_session_parity.py:86-100`, `pythonExport.js:377-421`, `rExport.js` | The runtimes never recompute plot metrics. Sessions and exports carry `rawData`, so a plot metric column reaches Python/R as a saved SNAPSHOT and downstream processes compute from it. This is the existing precedent for "GUI-computed, snapshot-exported". |
| Guards | `portVsStorageFields.test.js`, `paramNotesCoverage.test.js`, `sampleSizePolicy.test.js` | None is touched by plot metric outputs today (no input-field change; plots have no params in the manifest; no plot outputs in the manifest). |

### 0.4 The stored-value system

- `core.storedValues[name]` holds one of three shapes (`core.svelte.js:578-642`): a
  `getter` entry (component lifetime), a `ref` entry `{ tpId, outKey, yId?, index? }`
  that resolves a TABLE PROCESS metric column (`resolveStoredValueRef`, 604-624; plots
  are not supported), or, after load, a `staticValue` snapshot.
- On save (`core.svelte.js:874-886`) every entry becomes `{ source, ref?, staticValue }`.
  On load (`Setting.svelte:297-303`) they come back as static snapshots; a
  `StoreValueButton` that mounts later claims a static leftover of its default name and
  makes it live again (`StoreValueButton.svelte:22-44`).
- Consumers reference stored values BY NAME: FormulaColumn `{ type: 'stored', key }`
  tokens, BlankColumn `storedValueRefs`, StoredValueGroup `groups[].keys`
  (`propagateStoredValueRename`, `core.svelte.js:654-681`).
- **A phase-marker block's four stored values are created by MOUNTING its controls, not
  by the user pressing anything.** Evidence: `facet-actogram-markers.json` (captured by
  opening the session and saving) carries all eight of `tau_marker_0`, `phi_marker_0`,
  `marker_r_squared_marker_0`, `marker_rmse_marker_0` and the same four for
  `marker_1`. So "which stored-value names a session used" must be answered by
  consumers (formula tokens, BlankColumn refs, StoredValueGroup keys), not by presence
  in `storedValues`.
- History: `setStoredValue`, `removeStoredValue`, `renameStoredValue` ops exist
  (`operations.js:240-245`), so a stored-value rewrite can join an `atomicBatch`.

### 0.5 Where the code contradicts, or sharpens, the decisions

1. **The stored-value name migration maps nothing in any session saved before Phase A.**
   Decision 4 says map each stored-value name onto "the new column where one exists".
   Columns exist only for rules, and decision 6 says legacy blocks are NOT auto-merged
   into rules. So for every pre-rules session the mapping is empty by construction: every
   referenced legacy name is "the rest" and is reported. The mapping is live only for
   sessions saved between Phase A and Phase B (rule instances will mount the same
   buttons with `defaultName` `tau_<rule name>`), and for the promote action, which can
   re-point the promoted block's names at the moment the rule is made (section 5.2).
   There are 0 shipped sessions with markers, so the only real users of the old names
   are users' own files.
2. **The "shared day range" does not scope the fit today.** `lineMinDay`/`lineMaxDay`
   only clip the drawn line and default the reference day (`PhaseMarker.svelte:68-72,
   260-267`; the fit reads `selectedPeriods` only, 196-201). A rule's range therefore
   means the same as a block's (draw clip + reference default) unless the author wants
   it to exclude days from the fit. This plan keeps today's meaning so a promoted block
   and its rule compute identical numbers, and makes the rule's `excludedDays` list the
   fit scope. Open question Q1. **Superseded by Decision 1a:** for a RULE the range
   scopes the fit as well as the drawing; own blocks keep today's meaning unless they
   carry `fitWithinRange` (set on detach); `excludedDays` is dropped.
3. **Manual markers only exist on `type: 'manual'` blocks.** Decision 2 lists "manual
   hand-placed markers" as per-series data on an instance. For an onset/offset rule
   there is no such thing today: `markers` ignores `manualMarkers` unless the type is
   manual (167-186), and editing one detection converts the whole block to manual
   (`editMarker`). So on an onset/offset instance, editing a detected time is a SETTINGS
   change (type becomes manual) and detaches, exactly as decision 3's convention says;
   per-series hand-placed points are meaningful only on a line-only rule (`type:
   'manual'`), where they are pure data and do not detach. The plan implements it that
   way and says so in the UI.
4. **"Est tau" is not the fitted tau.** The displayed and stored `tau_` value is
   `harmonicCheck.strongest.peakPeriod`, i.e. whichever of tau, tau/2, 2 tau has the
   highest Lomb-Scargle power (margin 0, so it is exactly one of the three). R squared
   and RMSE describe the regression line. A `<rule>_tau` port must be the regression
   slope (the line as drawn, consistent with its own `r2`/`rmse`), so a legacy `tau_`
   stored value mapped onto it can change value when the harmonic check had picked tau/2
   or 2 tau. The migration reports that case (5.2). **Superseded by Decision 2b:** the
   `<rule>_tau` port IS the harmonic pick, so the legacy value keeps its meaning and there
   is nothing to report.
5. **A faceted metric plot writes no metric values today (v77.0 regression).** Measured
   on `demo-workflow-free-running.json`, periodogram plot 3 (`metricOut.peak_period` =
   column 71): unfaceted, setting `periodlimsIN = [26, 40]` rewrote column 71 to
   `[26]`; with `facet = true`, the same edit left it at `[24.85]`; turning facet off
   made it catch up to `[26]`. Cause: `usePlotMetricOutputs` runs only in an instance
   mounted with `which === 'plot'`, `isMetricPlot` rejects panels, and since v77.0 a
   generator's own component is never mounted as a plot (`FacetGroup.svelte:35`,
   `EmbeddedPlot.svelte:102` mount panels). Phase B's faceted-actogram outputs inherit
   this; it must be fixed first (Phase B step 0). Spawned as a separate task
   ("Fix stale metric outputs on faceted plots"). **Fixed 2026-09-30** (see Phase B
   step 0): the generator's component is mounted once, headless, by the facet host.
6. **Block edits are not undoable today, except the drag.** Every control is a direct
   bind, and deleting a block is a direct `filter`. "Every rule edit is one undo step"
   is therefore new behaviour, not parity with blocks; the plan adds a targeted op for
   rule edits (section 4) and leaves own-block field edits as they are (open question
   Q6).
7. **`recordInnerEdit` rebuilds the whole actogram inner.** It reverts the mutation,
   `fromJSON`s the before state, then `setPlotInner` `fromJSON`s the after state
   (`seriesDelete.js:55-80`, `operations.js:317-323`). Every block on every series is
   reconstructed and every detection recomputed. For rule field edits that is R x N
   detections per keystroke-commit on large data (section 8), which is why rule field
   edits get their own in-place op.
8. **Marker ids are ephemeral.** Anything that must survive save/load or a rebuild
   (port keys, detachment records, `fromRule`) cannot use `PhaseMarkerClass.id`. Rules
   get persisted ids of their own.
9. **The facets plan's Phase 3 sketch put detachment in the override map**
   (`markers.detached: [ruleId]` under `facetOverrides`). This plan puts it on the
   generator SERIES instead (section 3.4 gives the reasons); that is a deliberate
   divergence from the sketch, not from anything that shipped.
10. **Plot outputs are absent from the manifest and MCP schema for ALL plot types**
    (0.3). "How the ports appear in the MCP schema/manifest" therefore starts from zero
    for the four existing defs as well. Phase B adds them for all five metric plot types
    in one change rather than special-casing the actogram.

## 1. Target model

### 1.1 Vocabulary

- **Rule**: a `MarkerRule` in `ActogramClass.markerRules`. Owns every SETTING. Persisted.
- **Instance**: the computed block a rule projects onto one series that is not detached
  from it. Never persisted. Reads settings from the rule and data from the series.
- **Own block**: today's `PhaseMarkerClass` in `datum.phaseMarkers`. Persisted as today.
  May carry `fromRule` (it was detached from, or promoted into, that rule).
- **Rule data**: the per-series facts of one rule on one series:
  `datum.ruleData[ruleId] = { selectedPeriods, manualMarkers }`. Persisted on the series.
- **Detachment**: `ruleId` in `datum.detachedRules`. The rule stops projecting there.

### 1.2 `MarkerRule` shape and persistence

```js
// Persisted inside ActogramClass.toJSON() as `markerRules: [...]`, plus `nextRuleId`.
{
  id: 'r1',                 // stable, persisted, never reused within the plot
  name: 'Onsets',           // display name; unique within the plot (1.5)
  type: 'onset',            // 'onset' | 'offset' | 'manual' (UI: "Line only / hand-placed")
  templateHrsBefore: 3,     // N
  templateHrsAfter: 3,      // M
  centileThreshold: 50,     // %
  lockTau: 'fit',           // 'fit' | 'fixed'
  lockTheta: 'fit',
  fixedTau: null,           // hours; read when lockTau === 'fixed'
  fixedTheta: null,         // hours after row start at phaseRefDay; read when lockTheta === 'fixed'
  phaseRefDay: null,        // 1-indexed; null = lineMinDay ?? 1 (as today)
  lineMinDay: null,         // 1-indexed draw clip (0.5 item 2)
  lineMaxDay: null,
  // excludedDays: dropped by Decision 1a (the range above scopes the fit for a rule)
  colour: null,             // null = each series' own colour
  lineWidth: 1,
  markerSize: 5,
  showLine: true
}
```

Why `fixedTau`/`fixedTheta` rather than the block's `fitSlope`/`fitIntercept`: the
block's pair is a storage encoding that depends on `phaseRefDay` and `periodHrs`
(`intercept = theta - (tau - P) * refDay`). A rule is edited from a form, not dragged,
so storing the two numbers the user typed is simpler and cannot drift when the reference
day changes. The instance exposes `fitSlope`/`fitIntercept` as getters computed from
them with exactly that identity, so `fitLine`, `estimatedPhase`, `lineCopyOffsets` and
the drawing code see the shape they see today. Promote and detach convert with the same
identity (`tauValue`/`thetaValue` already decode it, `PhaseMarker.svelte:79-87`).

`ActogramClass` gains `markerRules = $state([])` and `nextRuleId = $state(1)`.
`toJSON` writes both only when `markerRules.length > 0` (keeps the 14 shipped actogram
sessions byte-identical on regeneration). `fromJSON` reads them with `??` guards and a
shape guard per rule (non-object, missing id, duplicate id: dropped with a load warning
through `addNotification`, the facets migration's channel; unknown `type` becomes
`onset`; numeric fields go through the same `|| default` / `?? null` rules the block
constructor uses, `PhaseMarker.svelte:418-468`). `nextRuleId` is repaired to
`max(numeric suffix) + 1` if it is missing or too small. An old session loads with an
empty rule list and renders exactly as today.

`ActogramDataclass` gains `ruleData = $state({})` and `detachedRules = $state([])`,
written in its `toJSON` only when non-empty, read with `??` and a shape guard
(`ruleData` entries whose rule no longer exists are kept, not pruned, so undoing a rule
deletion restores the series' per-day choices; they are pruned on save only if the rule
id is below `nextRuleId` and absent, i.e. certainly deleted). `PhaseMarkerClass` gains
`fromRule = $state(null)` and (Decision 1a, in place of `excludedDays`)
`fitWithinRange = $state(false)`, both written only when set.

### 1.3 The instance: one computation class, two sources

`PhaseMarkerClass` is refactored so every derived reads settings through `this.cfg`
and per-series data through `this.store`:

- Own block: `cfg = this`, `store = this`. Its fields, JSON and tests are unchanged.
- Instance: `class RuleInstance extends PhaseMarkerClass` with `cfg` = a small adapter
  over the rule (every setting a getter onto the rule; `fitSlope`/`fitIntercept`
  derived from `fixedTau`/`fixedTheta`; `name` = the rule's name), `store` =
  `datum.ruleData[ruleId]` (created on demand as a `$state` object with
  `selectedPeriods` initialised exactly as the block constructor does, 452-468),
  `ruleId`, and `isInstance = true`.

This is composition through two pointers, not accessor overriding: Svelte 5 compiles
class `$state` fields to private storage plus prototype accessors, and overriding those
in a subclass works but is the kind of thing a compiler change silently breaks. With
`cfg`/`store`, the only change to the existing deriveds is the receiver of a few dozen
property reads, and every existing test (which sets `marker.templateHrsBefore` etc. on
own blocks) keeps working because `cfg === this` there.

Writes: `addTime`, the per-day checkbox handlers and "All/None" write
`this.store.selectedPeriods` / `this.store.manualMarkers` (data, no detach). Every
settings writer (`setTau`, `setTheta`, `setLock*`, `editMarker`, the form fields) calls
`this.requireOwn()` first, which on an instance performs the detach (1.6) and returns
the new own block, and the write lands there. This is how decision 3 is enforced in one
place rather than at each control.

Fit scope composes as decision 2 says. **Decision 1a replaces the sketch below:** the
pure `isDaySelected` in `markerSelection.js` is `(selectedPeriods[i] ?? true)` AND, when
the range scopes the fit (always for an instance; `fitWithinRange` for an own block),
`lo <= i + 1 <= hi`; there is no `excludedDays`. The original sketch was: an
`effectiveSelected(i)` getter,
`(store.selectedPeriods[i] ?? true) && !cfg.excludedDays.includes(i + 1)`, replaces the
four raw reads of `selectedPeriods` (`onsetUnwrap` 196-201, `markerPoints` 211,
`markersDrawn` 251-253, and the checkbox list's `checked`). Own blocks get the same
`excludedDays` field (default `[]`) so a detached block is a pure copy of its instance
and composes identically; the UI shows the list on own blocks too, which gives
per-series blocks a feature they lacked (bulk-excluding days without clicking N
checkboxes).

### 1.4 The projection: where instances are materialised

`datum.ruleInstances` is a plain `$state` array of `RuleInstance`, keyed by `ruleId`,
reconciled by ONE function, `reconcileRuleInstances(actogram)`:

```
for each series d, for each rule r in markerRules order:
  if r.id in d.detachedRules: ensure no instance for r
  else: keep the existing instance for r (same object) or create one
drop instances whose rule is gone
```

It is called synchronously from the only places that can change the rule list or a
detachment set: `ActogramClass.fromJSON` (after series are built), `addRule`,
`removeRule`, `detach`, `reattach`, `promote`, `addData`/`removeData`, and the facet
panel rebuild (which is `fromJSON`). All of these run in event handlers, op replays or
microtasks, never inside a running `$effect` or `$derived`, so the derived_inert rule
(`PhaseMarkerClass` has 13 `$derived` fields; created under an active reaction they go
inert when it re-runs) is respected without `queueMicrotask`. There is deliberately no
`$effect` and no `$derived` that constructs instances: a keyed cache inside a
`$derived` would recreate the inert problem on the cached objects (the memory note on
derived_inert: `untrack` does not help).

Cheapness and no unrelated remounts:

- A rule SETTING edit touches no array: the instance's deriveds read the rule through
  `cfg`, so only that rule's N instances recompute, in place, and nothing remounts.
  `{#each}` loops key instances by `ruleId + ':' + seriesIndex`, so the DOM nodes are
  stable across edits and across reconciles that keep the instance.
- A per-day checkbox recomputes one instance.
- Only the list-changing actions rebuild anything, and only the instance list.
- `dataByDays` is per series and shared by every block and instance on it, so R rules
  cost R template matches per series, not R foldings.

Faceted actograms: a panel's inner is `fromJSON(snapshot(generator.plot))` with the
panel's series copies (`facetPanels.svelte.js:437-478`). Because `markerRules`,
`ruleData` and `detachedRules` are in the toJSON contract, a panel projects the
generator's rules through the same `fromJSON` and the same reconcile, with no
facet-specific code. Two facet-side changes are needed:

1. `panelStructureSig` (`facetPanels.svelte.js:352-359`) must include the rule id list
   and each panel series' `detachedRules`, so an id change of equal length (detach r1,
   reattach r2 in one step) is a REBUILD, not a leaf mirror that `setByPath` would apply
   without reconciling instances. A rule SETTING change stays a leaf mirror
   (`markerRules[0].templateHrsBefore`), which is what makes a threshold edit on a
   12-panel generator cost 12 in-place recomputes and zero remounts.
2. `markerWriteTarget` (`PhaseMarker.svelte:749-757`) resolves by block INDEX today.
   Instances are not in `phaseMarkers`, so it must resolve an instance by `ruleId`
   on `panelSeriesTarget(box, j)` and an own block by index as now.

### 1.5 Stable ids and names; what a rename does to ports

- Ids are `'r' + nextRuleId++`, never reused within a plot, so a deleted rule's key is
  never recycled into a different rule (which would silently re-point a downstream wire
  at different numbers). Ids are per plot; two actograms may both have an `r1`.
- Names are unique within the plot. `addRule` names `Rule 1`, `Rule 2`, ...; promote
  uses the block's name; a colliding name gets ` (2)`, ` (3)` (the
  `uniqueStoredValueName` idiom). Renaming to a taken name is refused inline.
- **Port keys are derived from the ID, never the name**: `r1_tau`, `r1_phi`, `r1_r2`,
  `r1_rmse`. Evidence that this is required, not stylistic: `syncPlotMetricColumns`
  deletes the column of any key that leaves `desired` and mints a NEW column (new id)
  for any key that appears (`plotMetricOutputs.svelte.js:106-124`), and consumers hold
  the column id (`ProcessNode.svelte.js:891-898` port `col_<colId>`). A name-derived key
  would therefore delete and re-mint all four columns on every rename and break every
  downstream wire. With id keys, a rename changes only what the user reads: the port's
  `display` becomes `Onsets tau` (needs a `labelFor` hook, 2.1), and the four column
  NAMES are rewritten (`Onsets_tau_0`, ...), which is safe because nothing references a
  column by name except the user reading it.

### 1.6 Detach, reattach, promote

- **Detach(series s, rule r)**: build an own block from the instance: every setting
  copied from the rule (with `fitSlope`/`fitIntercept` encoded from
  `fixedTau`/`fixedTheta`, `colour` resolved to the series colour if the rule's is
  null), `selectedPeriods`/`manualMarkers` copied from `ruleData[r]`,
  `fitWithinRange = true` (Decision 1a; replaces copying `excludedDays`),
  `fromRule = r`, `name = rule.name`. Insert it at the head of
  `phaseMarkers`. Add `r` to `detachedRules`. Reconcile. `ruleData[r]` is kept (undo,
  reattach).
- **Reattach(block b)**: requires `b.fromRule` to name a live rule. Copy b's
  `selectedPeriods` and `manualMarkers` back into `ruleData[b.fromRule]` (they are data,
  decision 2), drop b, remove the id from `detachedRules`, reconcile. b's settings are
  discarded; the UI says so ("Reattach: this series goes back to the rule's settings;
  your per-day choices are kept").
- **Promote(block b on series s)**: create a rule from b's settings (`fixedTau =
  b.tauValue`, `fixedTheta = b.thetaValue`, the range as the rule's (Decision 1a), `colour`
  kept as a fixed colour because the user chose it on one series; the rule form offers
  "Use each series' colour"), `ruleData[newId]` on s from b's per-day data, remove b,
  reconcile (every other series gets a fresh instance with default per-day data).
  Promote is also the "Make this a rule for all series" action of section 5.1.
- **Deleting a rule**: removes it, its instances, and the ids from every
  `detachedRules`; detached own blocks keep `fromRule` pointing at a dead id and show
  "Rule deleted"; their `fromRule` is cleared on the next save. Their statistics stop
  filling any column (the columns are gone).
- **A detached block edited back to identical settings** stays detached. Only an
  explicit reattach reattaches.

## 2. Outputs

### 2.1 Dynamic keys: the smallest change

Add one optional member to a def and one helper; leave the four existing defs untouched:

```js
// plotMetricOutputs.svelte.js
export function plotMetricKeys(plot) {
  const def = PLOT_METRIC_DEFS[plot?.type];
  if (!def) return [];
  return typeof def.keysFor === 'function' ? def.keysFor(plot.plot) : def.keys;
}
// def (optional): labelFor(inner, key) -> string   (port display; default: the key)
// def (optional): columnNameFor(inner, key, plotId) (default: `${key}_${plotId}`)
```

Every consumer of `.keys` switches to `plotMetricKeys(plot)`: `syncPlotMetricColumns`
(104), `writePlotMetricOutputs` (136). `Plot.sourceNodeId.test.js:59` reads a static
def and is unaffected. `ProcessNode.svelte.js:894` changes `port.display = key` to
`labelFor ? labelFor(plot.plot, key) : key`. `statsFor(datum)` needs no signature change:
`ActogramDataclass.parentPlot` gives it the rules.

```js
actogram: {
  keysFor: (inner) => (inner?.markerRules ?? []).flatMap((r) =>
    ['tau', 'phi', 'r2', 'rmse'].map((s) => `${r.id}_${s}`)),
  labelFor: (inner, key) => /* 'Onsets tau' from the rule named by the key's id */,
  statsFor(datum) {
    const out = {};
    for (const r of datum.parentPlot.markerRules) {
      const b = datum.ruleInstances.find((i) => i.ruleId === r.id)
             ?? datum.phaseMarkers.find((m) => m.fromRule === r.id);   // detached, decision 4
      const reg = b?.linearRegression;
      const ok = reg && typeof reg === 'object';
      out[`${r.id}_tau`]  = ok && Number.isFinite(reg.slope) ? reg.slope : NaN;
      out[`${r.id}_phi`]  = b?.estimatedPhase?.phase ?? NaN;
      out[`${r.id}_r2`]   = ok ? (reg.rSquared ?? NaN) : NaN;
      out[`${r.id}_rmse`] = ok ? (reg.rmse ?? NaN) : NaN;
    }
    return out;
  }
}
```

`usePlotMetricOutputs(() => theData, () => which === 'plot')` is added to
`Actogram.svelte`'s instance script, exactly as the four other plot types call it.
`statsFor` reads `linearRegression` and `estimatedPhase`, which the plot already
computes to draw the line, and NEVER `harmonicCheck` or `onsetWarnings` (section 8), so
the outputs add no detection cost beyond what drawing already pays.

`writePlotMetricOutputs` currently iterates `def.keys`; with `plotMetricKeys` the
column set follows the rule list, including creation for a new rule and deletion for a
removed one. Deletion through the effect is NOT undoable (0.5 item 7 and section 4), so
`removeRule` deletes its four columns itself inside the same `atomicBatch` as the rule
edit, with id-preserving `removeColumn` ops, and updates `metricOut` through
`setPlotProperty`; by the time the effect's microtask runs there is nothing stale for it
to delete. Undo re-adds the columns WITH THEIR IDS, so downstream wires come back.

### 2.2 Names, confirmed against the codebase

| Quantity | Existing names | Chosen suffix | Why |
|---|---|---|---|
| Period | Cosinor `period` (`Cosinor.svelte:124`); plots `peak_period` | `tau` | The actogram's own vocabulary everywhere a user meets it: the block's "tau (hrs)" lock label, the handbook's tau-hat (Ch05:108-117), the legacy `tau_` stored values. It is the slope of an onset regression, not a cosine period, and naming it `period` would invite comparison with the Cosinor port as if the two estimated the same thing the same way. |
| Phase | Cosinor `acrophase`, `bathyphase`, `phase_angle` | `phi` | NOT `acrophase`: phi is the predicted onset (or offset) time, not a cosine peak. `nodeNotes.js:135` already invites users to wire onset phases into the Rayleigh test beside Cosinor acrophases; the port name must not blur the two. Matches the block's "Est phi" and the legacy `phi_` names. |
| Goodness of fit | `r2` in TrendFit, DoubleLogistic, FitFunction, RectangularWave (4 nodes); `rsquared` in Cosinor (1) | `r2` | Majority convention for line/curve fits. |
| Error | `rmse` in the same 4 nodes | `rmse` | Same. Units: hours. |

Full keys: `r<id>_tau`, `r<id>_phi`, `r<id>_r2`, `r<id>_rmse`. Port display:
`<rule name> tau (h)`, `<rule name> phi (h)`, `<rule name> R2`, `<rule name> RMSE (h)`.
Column names: `<rule name>_tau_<plotId>` etc. (spaces become `_`, as column names
elsewhere).

**Decision 4a: the fifth key `r<id>_n` (markers fitted) is IN.** The original reasoning
(open question Q2): `qq_n` sets the precedent, R squared of a two-point line is 1 and says nothing,
and a consumer averaging tau across animals should be able to filter on n.

### 2.3 Semantics, per value

- One value per series, in `plot.plot.data` order, exactly like the other defs ("one
  value per series, in plot-data order", `plotMetricOutputs.svelte.js:5`; Cosinor's
  "one value per y input, in yIN order" is the TP analogue). Hidden series (`draw:
  false`) still get a value: their markers are drawn (0.2, Drawing).
- A series with no valid fit (no selected markers and nothing Fixed; one marker with
  both parameters free; empty data) gets `NaN` in all four, matching the `?? NaN` rule
  of the other defs. `r2`/`rmse` are `NaN` when `fitLine` reports `null` (no markers to
  compare against, e.g. a line-only rule with no hand-placed points).
- **Superseded by Decision 2b:** `tau` is the harmonic-check pick
  (`harmonicCheck.strongest.peakPeriod`), cached per instance and recomputed only when
  the fitted slope's value or the series data change. The original bullet follows.
- `tau`: the slope of the line AS DRAWN (`linearRegression.slope`), in hours. When the
  rule's tau lock is Fixed, every series reports the fixed value; that is the honest
  reading of "the line as drawn" and it is what makes `r2`/`rmse` interpretable (they
  describe that line). It is NOT the harmonic-check pick (0.5 item 4); the UI's "Est
  tau" gains a note when the harmonic check prefers tau/2 or 2 tau.
- `phi`: `estimatedPhase.phase` = the line's predicted marker time at the rule's
  reference day (`phaseRefDay ?? lineMinDay ?? 1`, clamped to the plot's days), in
  HOURS after the start of that row, wrapped into `[0, tau)` then folded into `[0, P)`
  (`wrapPhaseToRow`). Row 0 starts at the plot's `startTime`: the earliest valid sample
  over ALL series snapped to start of day in the display zone. So phi is clock time
  only when `P = 24` and the snap lands on midnight, and adding a series whose data
  starts a day earlier shifts every series' day numbering (risk 7.1 item 5). The port
  documentation says this in one sentence.
- `r2`: of absolute marker time against day number. On any real record this sits near
  1 because y spans whole days (measured 0.99997 and 0.99986 on the rest-activity demo),
  so RMSE is the informative fit statistic; the port note says so rather than letting
  R squared look like evidence.
- `rmse`: hours.

### 2.4 Ports on the node, manifest, MCP schema, guards

- **Node**: nothing new. `ProcessNode.svelte.js` already turns every `metricOut` column
  into a `col_<colId>` metric port; the actogram node gains four per rule, in rule
  order, labelled by `labelFor`.
- **Manifest** (`buildNodeManifest.js:109-125`): plots get their outputs from
  `PLOT_METRIC_DEFS` instead of `[]`: static `keys` for the four existing types
  (`{ name, kind: 'column', cardinality: 'one', metric: true }`, the TP shape), and for
  the actogram a documented pattern entry (`{ pattern: '<rule>_tau', metric: true,
  dynamic: 'one set of four per marker rule' }`, x4). `static/nodes.json` and
  `handbook/src/lib/nodeReference.json` regenerate (`GEN_MANIFEST`). This also closes
  the 0.3 gap for the four existing plot types, and brings the periodogram's
  `peak_pvalue` into `sampleSizePolicy.test.js`'s scope: that test must then list
  `periodogram` (decision needed at that point: the chi-squared peak p is 'checked' only
  if the plot warns on short records; if not, an exemption with a reason). The
  actogram's keys carry no p-value and do not engage the policy.
- **MCP schema** (`gen-schema.js:218-232`): each plot gains `metricOutputs` from the same
  source, so `list_capabilities` can say what a plot emits. The MCP ENGINE cannot wire
  to a plot metric column today (the column is minted by the browser at mount; a built
  session has no `metricOut`), for any plot type. Making it wireable is out of scope and
  listed as Phase C; `describe_session` should report an actogram's rules and their
  keys so a model reading a user's session knows they exist.
- **paramNotes**: rules are not node params (plots have `params: []` in the manifest),
  so `paramNotesCoverage.test.js` is unaffected. The port notes live in the manifest
  entry's `description` and in `nodeNotes.js` (actogram entry).
- **portVsStorageFields**: unaffected (no input-field change). One new case: an
  actogram inner with `markerRules` and series `ruleData` written in storage shape
  round-trips through `fromJSON`.
- **Plot JSON robustness** (`plotFromJSONRobustness.test.js`): `markerRules`,
  `ruleData`, `detachedRules`, `fromRule`, `fitWithinRange` join its wrong-shape matrix.

### 2.5 Parity: recommendation and cost

The Python and R runtimes have no phase-marker code (0.1) and no plot-metric code for
ANY plot (0.3): the four existing plot outputs already reach Python and R only as saved
`rawData` snapshots.

**Superseded by the Parity decision (top): Python and R WILL port the marker rules,
with fixtures, in Phase B.** The original recommendation, kept for the cost estimate
below: Phase B ships the rule outputs GUI-only, explicitly, on the existing
precedent, and does not port.

- Make the exclusion explicit rather than implicit: a `PLOT_METRIC_PARITY` registry in
  `tools/README-parity.md` and a guard test (`plotMetricParity.test.js`) that fails when
  a `PLOT_METRIC_DEFS` type is neither ported nor listed as GUI-only with a reason. The
  four existing types and the actogram are listed GUI-only on day one. This is the
  `sampleSizePolicy` pattern: unlisted is a failure, never a pass.
- Python and R exports already carry the snapshot values in `columns.csv`; the export
  header comment gains one line naming snapshot-only columns so a reader of a generated
  script knows those numbers were not recomputed.

Cost of porting instead (so the decision is informed): the per-row template matcher,
centile, absolute-time and unwrap logic (`onsetUnwrap.js` 95-337, about 240 lines), the
constrained fit and residuals (`lineFit.js`, about 90 lines), `wrapPhaseToRow`, and the
series folding into rows at the plot's `startTime` (Python has `_actogram_bins_by_period`
at 5667 to build on; R has no actogram code at all). Roughly 350 lines of Python and 450
of R, plus 8 fixtures (onset, offset, a row-crossing drift, a gap row, the four lock
combinations, excluded days) in `tools/parity/fixtures.json` through a new
`actogramMarkers` kind, about two to three agent-days including the time-zone snap,
which is the part most likely to disagree silently (the parity README's `timeColumn`
section records two ports already getting time wrong). The ongoing cost is larger than
the build: every future change to onset detection becomes a three-language change.
Recommended trigger for doing it anyway: a manuscript claim or benchmark that reports
actogram-derived tau or phi as a method result.

## 3. UI

### 3.1 The plot-level "Marker rules" section

Placement: at the TOP of the actogram's Data tab, above the per-series blocks, not in
Properties. Reasons: markers live in the Data tab today, a user looking for them goes
there, and a rule is about the series listed directly beneath it. Header row: pin icon,
"Marker rules", a "+" button ("Add a rule: the same markers and line on every series"),
and beneath it a muted note "Each rule applies to all 3 series" (count from
`plot.data.length`; "2 of 3 series; 1 detached" when some are detached).

A rule block shows, top to bottom:

1. Name (`Editable`, uniqueness enforced) and delete.
2. Type: Onset / Offset / Line only (hand-placed points). "Line only" is the internal
   `manual` type.
3. N, M, % (onset/offset only).
4. Line fit: the same tau/theta Fit/Fixed segmented rows as a block, with number inputs
   enabled when Fixed. Flipping a rule lock to Fixed seeds the value from the MEDIAN of
   the finite fitted values over its instances (a rule has no single drawn line to pin;
   median is robust to one bad animal), falling back to `P` and `P / 2`. Open question
   Q4.
5. Phi reference day; line min and max day (Decision 1a: the range scopes every
   series' fit as well as the line; no excluded-days field).
6. Style: colour ("Each series' colour" toggle, else a picker), marker size, line width,
   show line.
7. A compact per-series summary table: series label, tau, phi, R2, RMSE, n, and a status
   cell ("rule", "detached", "no fit"). These are exactly the values the four ports
   emit, so the user sees what downstream receives. It reads `linearRegression` and
   `estimatedPhase` only (section 8).

For a facet generator selected through a panel, the panel banner already shows the
generator's controls (views model, `ControlDisplay`); the rule section there reads
"applies to all 4 panels".

### 3.2 A rule instance in a series' Data tab

Under that series' "Markers and lines", instances come first, then own blocks. An
instance renders the same `PhaseMarker` controls with:

- A header chip "From rule: Onsets" and two actions: "Edit rule" (scrolls to and
  flashes the rule block) and "Detach" ("Give this series its own copy of the rule, to
  change it here only").
- Settings fields shown as they are on the rule, EDITABLE, with a one-line hint above
  them: "Changing a setting here detaches this series from the rule." The first
  settings write detaches (1.3 `requireOwn`), and a toast confirms "Onsets detached on
  series 'mouse 2'" with Undo. This implements decision 3 literally and keeps the
  convention of `editMarker` (a change converts, with no dialog).
- The per-day list: checkboxes editable (write `ruleData`, no detach); days excluded by
  the rule show checked-and-disabled with "excluded by rule". Editing a detected time
  in that list is a settings change (0.5 item 3) and detaches, with the same hint.
- "Add markers" (click to place) only on a Line-only rule, writing `ruleData`, no
  detach.
- Statistics and warnings as today, collapsed by default on instances (section 8), and
  the four `StoreValueButton`s removed (decision 4; 5.2).

A detached own block shows "Detached from Onsets" and "Reattach to rule". An own block
with no `fromRule` gains "Make this a rule for all series" in its header icons (the
promote action). On an own block whose `fromRule` names a deleted rule, the chip reads
"Rule deleted" and there is no reattach.

### 3.3 On the plot

Instances draw exactly like blocks (same snippet). Dragging an instance's line is a
settings edit: on pointerup the gesture detaches first, then records (one undo step for
detach plus drag, since both are one `recordInnerEdit` of the same inner, see 4). The
armed-click path (`addPhaseMarkerTo`) searches `ruleInstances` as well as
`phaseMarkers`, and the facet panel's "is the armed marker on this panel" check
(`Actogram.svelte:884-887`) does too.

Legend: an instance's entry is labelled by the rule name. When the rule's colour is
fixed, every instance looks the same, so `getLegendItems` emits ONE entry for the rule
(deduplicated by rule id), placed after the series entries. When the rule follows
series colours, each instance gets its own entry, labelled `"<series>: <rule>"`. Own
blocks keep today's labels. `Actogram.legend.svelte.test.js` gains both cases.

### 3.4 Faceted actograms

Panels project the generator's rules with no extra code (1.4). Per-panel detachment
lives on the GENERATOR SERIES (`detachedRules` and the detached own block), not in
`facetOverrides`. Reasons:

1. Panel i is generator series i (`unit.seriesIdx`), and the detached block is series
   data that the Phase 1 write-through already routes to the generator series
   (`panelSeriesTarget`). Keeping the flag beside the block it describes means one
   mechanism for faceted and unfaceted actograms, and toggling facet off and on changes
   nothing.
2. `facetOverrides` is plot-level PATHS keyed by unit key (Phase 1 content: axis
   limits). A detachment is not a path override of the generator's inner; expressing it
   there would need the projection to delete rule instances from a panel, a second
   reconcile living in facet code.
3. Unit keys are orphaned on rewire by design (facets plan 1.6: a rewire is new data);
   a detachment is a decision about the animal's markers and should follow the series
   object, which is what it does on the series.

## 4. History

| Action | Mechanism | Steps |
|---|---|---|
| Rule setting edit (any field, or several fields from one control) | New op `setMarkerRule { plotId, ruleId, patch }`, inverse = the prior values of the patched fields. Applied IN PLACE on the rule (no `fromJSON`), so only that rule's instances recompute and nothing remounts. On a facet generator the panels mirror the leaf change. | 1 |
| Add rule | `recordInnerEdit` (rule list change) | 1 |
| Delete rule | `atomicBatch([setPlotInner, removeColumn x4, setPlotProperty metricOut])` once Phase B exists; `recordInnerEdit` in Phase A | 1 |
| Rename rule | `setMarkerRule` for the name, plus in Phase B `renameColumn` x4 in the same `atomicBatch` | 1 |
| Detach / reattach | `recordInnerEdit` (series arrays change) | 1 |
| Implicit detach by an instance edit or drag | The detach and the edit inside ONE `recordInnerEdit` mutate callback | 1 |
| Promote | `recordInnerEdit`; in Phase B plus stored-value re-pointing ops in one `atomicBatch` (5.2) | 1 |
| Per-day checkbox / manual point on an instance | Direct write, as for blocks today (not recorded) | 0 (open question Q6) |

`setMarkerRule` needs a stable target, which is why rule ids are persisted (0.5 item
8): a `setPlotInner` between an edit and its undo re-mints marker ids but not rule ids.
The op re-reads the plot by id and the rule by id at apply time and no-ops if either is
gone, like `op_setFacetOverride`. Numeric inputs commit on `change`, not `input`, so one
typed value is one step; the colour picker coalesces a drag into one step on release,
the pattern the line drag already uses.

## 5. Migration

### 5.1 Blocks are never merged into rules automatically

A session whose series carry identical computed blocks loads exactly as saved, as N own
blocks. No detection of "these look the same" runs at load. The opt-in is the promote
action on any own block, labelled "Make this a rule for all series". When promoting a
block whose settings match an own block on another series exactly (settings only, data
ignored), the confirmation offers "Also replace the matching blocks on 2 other series
(their per-day choices are kept)"; accepting removes those blocks and seeds their
`ruleData` from them, in the same undo step. Unticked by default.

### 5.2 Stored-value names

Runs in `importJson` after `migrateFacetChildren` and before the plot loop, as a pure
`migratePhaseMarkerStoredValues(json)` returning `{ json, warnings }` (the facets
migration's shape and channel):

1. Collect the REFERENCED stored-value names (FormulaColumn tokens, BlankColumn
   `storedValueRefs`, StoredValueGroup keys) that match `tau_<n>`, `phi_<n>`,
   `marker_r_squared_<n>`, `marker_rmse_<n>` and whose entry's `source` starts with
   `Actogram phase marker`.
2. For each, find the block: `n` equals a block's `name` or a rule's `name` (the rule
   instance buttons of a Phase-A-era session used the rule name). If it is a RULE (or a
   block with `fromRule` on a live rule) on actogram P, series s: rewrite the entry to a
   ref `{ plotId: P.id, outKey: '<ruleId>_<tau|phi|r2|rmse>', index: s }`. This needs
   `resolveStoredValueRef` to accept a `plotId` ref (resolves `plot.metricOut[outKey]`,
   index into the column), a small, tested extension of `core.svelte.js:604-624`.
   (Decision 2b: the tau port is the harmonic pick, the same quantity the legacy `tau_`
   held, so no tau warning is needed.)
3. Otherwise (an own block with no rule, i.e. every pre-Phase-A session): keep the
   entry as its saved static number, and report once per actogram: "Stored values
   tau_marker_0, phi_marker_0 are now fixed numbers (they came from a marker block,
   which no longer publishes stored values). To keep them live, use 'Make this a rule
   for all series' on that block and wire its tau/phi outputs." Promoting that block
   later performs step 2 for its names in the same undo step (the promote's
   `atomicBatch` includes `setStoredValue` ops).
4. Unreferenced entries matching the four prefixes and source are dropped silently
   (they were created by mounting, 0.4), with one summary line in the console, not a
   toast.

Pins: `src/test/fixtures/facet-actogram-markers.json` already carries eight such
entries, all unreferenced (step 4). Two new fixtures made by today's code path (open the
app at v77.0, act, save), because a hand-written fixture would not carry what the app
actually writes: `actogram-marker-storedvalue-formula.json` (a FormulaColumn using
`tau_marker_0`: step 3 report, value stays the static number) and, after Phase A lands,
`actogram-rule-storedvalue-formula.json` (a rule's instance button name used in a
formula: step 2 rewrite).

## 6. Phasing

### Phase A: rules, projection, detach/reattach/promote, UI, history, persistence

Files: `plots/Actogram/PhaseMarker.svelte` (`cfg`/`store` refactor, `RuleInstance`,
`requireOwn`, `fitWithinRange` (Decision 1a), `fromRule`, controls for instances and own blocks),
`plots/Actogram/markerRules.svelte.js` (new: `MarkerRule`, `reconcileRuleInstances`,
detach/reattach/promote, name uniqueness), `plots/Actogram/Actogram.svelte` (rule
state and JSON, `ruleData`/`detachedRules`/`ruleInstances` on the series, the rule
section, the instance loop in the plot snippet, legend, `addPhaseMarkerTo`, panel click
check), `plots/Actogram/MarkerRuleBlock.svelte` (new), `core/operations.js` +
`mutationService.js` (`setMarkerRule`), `core/facetPanels.svelte.js`
(`panelStructureSig`), handbook Ch05 (a "Marker rules" paragraph) and
`_demos/nodeNotes.js` (actogram entry). The four `StoreValueButton`s STAY in Phase A
(instances show them too, with the rule name), so Phase A changes no stored-value
behaviour and is releasable alone.

Tests:
- Unit (`markerRules.test.js`): rule JSON round trip with `??` guards and the
  wrong-shape matrix; old session loads with `markerRules: []` and byte-identical
  `toJSON`; projection count R x N; a rule setting edit keeps instance identity (same
  object before and after) and recomputes only that rule's instances; detach creates an
  own block with `fromRule` and identical tau/phi/R2/RMSE to the instance it replaced
  (mutation-test by breaking the fixedTau encoding); reattach restores per-day data;
  promote yields identical statistics on the source series and instances elsewhere;
  delete rule then undo restores `ruleData`; day-range composition against
  `selectedPeriods` (Decision 1a); `nextRuleId` never reuses; name collisions.
- Facet (`facetWriteThrough.svelte.test.js` extended): a faceted generator's rule
  projects on every panel; a threshold edit is a MIRROR on every panel (projectPanel
  returns `mode: 'mirror'`), a detach is a REBUILD of that panel only; drag on panel 2's
  instance detaches generator series 2 and no other.
- Legend: fixed-colour rule dedupes to one entry; series-colour rule gives one per
  series.
- History: every action in the section 4 table is one `undoStack` entry and undoes to
  the exact prior JSON.
- Browser E2E (Playwright, dev server via `E2E_BASE_URL`, like `facet-migration.spec.js`):
  (1) `demo-workflow-rest-activity.json` (plot 0, 2 series): add an onset rule, see
  markers and a line on both series, change N and see both move, detach series 2 by
  dragging its line, confirm series 1 still follows a further N change, reattach, undo
  x3 back to the start; (2) `src/test/fixtures/facet-actogram-markers.json` faceted:
  add a rule on the generator, both panels show it, detach on panel 2, save and reload,
  the detachment and the legacy own blocks on series 0 survive.

Pinning: the rest-activity rule's tau/phi for both series recorded in the E2E as
constants (measured today with an onset block: tau 24.143 and 24.627 h, phi 7.357 and
6.180 h, section 8), so any change to detection shows up as a pin diff.

### Phase B: outputs, ports, manifest, guards, stored-value migration, parity

Step 0: fix the faceted metric-output regression (0.5 item 5) for all metric plots, so
the actogram inherits a working path. **DONE (2026-09-30, uncommitted on top of v77.0).**
The facet host (`FacetGroup.svelte` on the workspace, `EmbeddedPlot.svelte`'s facet
branch on the canvas) mounts the generator's own plot component ONCE, headless, through
`components/views/FacetGeneratorCompute.svelte` as `which="compute"`; components gate
their calculation and metric effects on `ownsPlotMetrics(which)` ('plot' or 'compute').
Only types with a `PLOT_METRIC_DEFS` entry are mounted (`hasPlotMetrics`), so when the
actogram gains its def it is mounted automatically, and `Actogram.svelte` must then gate
its `usePlotMetricOutputs` (and anything its stats depend on) on `ownsPlotMetrics(which)`
and render nothing for 'compute'. Pinned by `plots/facetMetricOutputs.svelte.test.js`.
Then: `plotMetricOutputs.svelte.js`
(`plotMetricKeys`, `keysFor`/`labelFor`/`columnNameFor`, actogram def),
`Actogram.svelte` (`usePlotMetricOutputs`), `ProcessNode.svelte.js` (display),
`core.svelte.js` (plot refs in `resolveStoredValueRef`), `markerRules.svelte.js`
(delete/rename column handling in the batch), `PhaseMarker.svelte` (remove the four
`StoreValueButton`s and their import), `core/phaseMarkerStoredValueMigration.js` (new) +
`Setting.svelte` (`importJson` step), `_demos/buildNodeManifest.js` +
`mcp/src/emit/gen-schema.js` (plot outputs), `static/nodes.json` and
`handbook/src/lib/nodeReference.json` (regenerated), `sampleSizePolicy.test.js`
(periodogram entry), `tools/README-parity.md` + `plotMetricParity.test.js` (the GUI-only
registry), handbook Ch05/Ch07 ("Store Value" sentence for actograms replaced by the
ports).

Tests: `plotMetricOutputs` actogram def (keys follow rules; NaN cases; detached block
fills its rule's column; hidden series still emits); rename keeps column ids and
changes names and port display; delete then undo restores the column ids and a
downstream consumer's wiring (the test that proves 2.1's batch); migration on the two
fixtures with warnings asserted verbatim; manifest snapshot for the five plots;
`plotMetricParity` guard fails on an unlisted type (mutation-tested by adding a fake
def).

Browser E2E: on the rest-activity demo, add a rule, open the canvas, wire the actogram
node's "Onsets tau (h)" port into a Describe Data node, read mean tau equal to the mean
of the two pinned values; rename the rule and assert the wire and value survive; delete
the rule, undo, assert the wire is back. Faceted variant: same wiring from a faceted
generator, then change N and assert the downstream value changes (this is the check
that step 0 is real).

Pinning: the `nodes.json` diff (plots gain outputs, nothing else changes), and the
Phase A E2E constants now read from the column.

### Phase B1 as built (2026-09-30): JavaScript outputs. DONE

Uncommitted in the tree. Where the build differs from sections 2, 4, 5.2 and Phase B above,
this list is the record. Phase B2 (the Python and R ports, and their `actogramMarkers`
fixtures) is the next agent's; its hand-off is at the end of this list.

- **Definitions split out.** `plots/plotMetricDefs.js` (new, no imports) holds
  `PLOT_METRIC_DEFS`, `plotMetricKeys(plot)`, `plotMetricLabel(plot, key)`,
  `plotMetricColumnName(plot, key)`, `plotMetricManifestOutputs(type)`,
  `RULE_OUTPUT_SUFFIXES`, `parseRuleOutputKey`, `ruleOutputValues(block)`.
  `plotMetricOutputs.svelte.js` re-exports it and keeps the runtime (sync, writes, hook). The
  split exists because `ProcessNode.svelte.js` (imported by `core.svelte.js`) now needs the
  labels, and the runtime module imports `core`: a cycle. A def has `keys` OR
  `keysFor(inner)`, plus optional `labelFor`, `columnNameFor`, `manifest`.
- **Actogram def.** Keys `r<id>_tau|phi|r2|rmse|n` per rule, in rule order. `tau` is
  `harmonicCheck.strongest.peakPeriod` (Decision 2b; the instance's cached $derived, so the
  output effect reads the three single-period evaluations once per slope value, never the
  warnings periodogram). `phi`, `r2`, `rmse` from the line as drawn; `n` =
  `fitPoints.xs.length`. No valid line: the first four NaN, `n` still the count (the `qq_n`
  precedent); a harmonic check with no candidate inside the record (tau > span / 2 and so on)
  also gives NaN tau. A detached series fills from its own block with `fromRule`. Port labels
  `<rule> τ (h)`, `<rule> φ (h)`, `<rule> R²`, `<rule> RMSE (h)`, `<rule> n`; column names
  `<rule_name>_<stat>_<plotId>`. Node ports list in key order (`ProcessNode.svelte.js`).
- **Actogram.svelte** calls `usePlotMetricOutputs(() => theData, () => ownsPlotMetrics(which))`;
  the facet host mounts it headless automatically (the def makes it a metric type). Pinned:
  `facetMetricOutputs.svelte.test.js` (both views, one write per key per change).
- **History.** New ops `renameColumn { id, name }` (writes `customName`) and
  `setPlotMetricOut { id, metricOut }` (deep-copied both ways; `setPlotProperty`'s inverse
  would hold the live $state map, which the sync mutates in place). `recordInnerEdit` and
  `removeFromInnerWithUndo` take an optional `extraOps(inner)` and then record ONE
  `atomicBatch([setPlotInner, ...extra])`. Delete a rule = `setPlotInner` +
  `setPlotMetricOut` + `removeColumn` per column (consumers keep the ids, as for a deleted
  table process; undo re-adds the columns under the same ids from rawData, which the op
  never deletes). Rename = `setMarkerRule` + `renameColumn` per column in one batch; the key
  and the column id never change. There is no `renameColumn` in the old op set; it was added.
- **Stored values.** The four `StoreValueButton`s are gone from `PhaseMarker.svelte`.
  `resolveStoredValueRef` accepts `{ plotId, outKey, index }`. `core/phaseMarkerStoredValueMigration.js`
  runs in `importJson` right after the facet migration, keyed on USE (FormulaColumn tokens,
  BlankColumn `storedValueRefs`, StoredValueGroup `groups[].keys`): used and named after a
  live rule (or a detached block whose `fromRule` is live) becomes a plot ref (the base name
  is the first mounted cell in Data-tab order, `_k` the k-th, exact stem tried first); used
  otherwise is kept at its saved number with one warning per actogram; unused is dropped with
  one console line. On `facet-actogram-markers.json` all 8 are unused and dropped, no toast.
  The two plan fixtures made through the app were NOT captured; the tests add consumers to
  the app-captured fixture in the consumers' persisted shapes instead. Promote re-points the
  promoted blocks' own `tau_|phi_|marker_r_squared_|marker_rmse_<name>` entries in the same
  undo step (`promoteStoredValueOps`).
- **Harmonic check extracted** to `plots/Actogram/harmonicCheck.js`,
  `harmonicCheck({ xData, yData, binSize, tau }) -> null | { candidates, strongest }`,
  behaviour pinned by `harmonicCheck.pin.svelte.test.js` (an inline snapshot recorded from the
  class BEFORE the extraction: tau, tau/2 and 2 tau each winning; a filtered 2 tau).
- **Manifest and schema.** Plots' `outputs` come from `plotMetricManifestOutputs` (nodes.json:
  only the five metric plots changed, `[]` to their ports); the actogram lists pattern entries
  `r*_tau` ... with `dynamicSuffix` and `per: 'marker rule'`. The MCP schema gains
  `plots.<type>.metricOutputs`; `describe_session` names an actogram's rules and their keys.
  The handbook Node Reference prose for all five plots describes the ports, Ch05 has a
  "Wiring the results" item, Ch07 names the Cosinor ports (its Store Value sentence stays:
  the Cosinor still has those buttons). `nodeNotes.js` actogram and group-phase entries are
  updated; demos NOT regenerated.
- **Guards.** `handbookProseCoverage` maps the plot ports (and pins that plots are in scope);
  `sampleSizePolicy` scans plots and `peak_pvalue` (periodogram: an exemption stating it does
  not warn on record length); `plotFromJSONRobustness` pins a wrong-shaped `metricOut`
  (an array used to spread into `{0: id, 1: id}`, and the next sync deleted those columns:
  FIXED in `Plot.svelte`) and wrong-shaped rule fields against `plotMetricKeys`;
  `portVsStorageFields` pins the rule id/key/label storage contract.
- **Not done / open.** The rule block's summary table still shows the fitted slope as tau
  (Phase A kept periodograms off it); the port reports the harmonic pick, so the two differ
  when the harmonic check prefers tau/2 or 2 tau (Q7's glyph would make that visible). The
  MCP engine still cannot wire plot metric columns (Phase C). The chi-squared periodogram has
  no short-record warning (the sampleSizePolicy exemption says so).
- **Hand-off to Phase B2 (Python and R).** Pure modules to mirror, function by function:
  `onsetUnwrap.js` (`matchTemplateMarkers`, `markerAbsoluteTimes`, `unwrapOnsets`,
  `wrapPhaseToRow`), `markerSelection.js` (`selectionMask`, `isOutsideFitRange`),
  `lineFit.js` (`fitLine(xs, ys, { tau, theta, refDay, periodHrs })`), `harmonicCheck.js`
  (`harmonicCheck({ xData, yData, binSize, tau })`, over `utils/periodogram.js`'s
  Lomb-Scargle), and `ruleOutputValues` in `plotMetricDefs.js` (which of the above feed each
  of the five outputs, and the NaN rules). Row folding is the actogram's `dataByDays` at the
  plot's `startTime` (earliest valid sample over ALL series, snapped to the start of the day in
  the display zone). Fixture kind `actogramMarkers`: onset, offset, a row-crossing drift, a gap
  row, the four lock combinations, a day range with an unticked day inside it, a detached
  series, and harmonic cases where tau/2 and 2 tau win (the pin file's 47 h and 12.3 h lines
  on the rest-activity demo) and where 2 tau is filtered out.

### Phase B2 as built (2026-09-30): Python and R ports. DONE

Uncommitted in the tree. The full record is the `actogramMarkers` section of
`tools/README-parity.md`; in short:

- **Ports.** `tools/ancir_runtime.py` and `tools/ancir_runtime.R` each gained, under the same
  names: `find_centile_value`, `find_best_match_index`, `match_template_markers`,
  `marker_absolute_times`, `unwrap_onsets`, `wrap_phase_to_row`, `fit_day_range`,
  `is_day_selected`, `selection_mask`, `is_outside_fit_range`, `fit_line`, `harmonic_check`
  (over each runtime's existing `_lomb_scargle` / `lomb_scargle`, after the app's validPairs
  filter and degenerate-series guards), `kahan_linear_regression` (the app's compensated
  `linearRegression`; the Python runtime's older `linear_regression` is a different centred fit
  and was left alone), `rule_output_values`, plus the class-side pieces
  (`actogram_start_time` with the display zone, `actogram_series_frame` = dataByDays at the
  shared startTime, `actogram_bin_size`, `actogram_ndays`, `marker_rule_from_json`,
  `marker_block_from_json`, `marker_rule_cfg` = ruleCfg with intercept = theta - (tau - P) *
  refDay, `marker_block_compute`) and the entry points `actogram_marker_rule_outputs(rule,
  series, frame, period_hrs, n_days)` (one rule on one series: the five outputs, with every
  intermediate on request) and `actogram_plot_rule_outputs(inner, series_data, zone)` (a whole
  actogram, with the per-key columns). `periodogramPeak`/`assessOnsetFit` are not ported (they
  feed warnings, never an output). R has no other actogram code; the folding is new there.
- **Fixtures.** Kind `actogramMarkers`, 11 cases (onset, offset on a number axis with 23.5 h
  rows, a two-series row-crossing drift with a later-starting second series, a gap row, the four
  locks, a range with an unticked day, detached with and without a block, the rest-activity
  harmonic cases 12.3/47/24 h, the split-rhythm demo at 24.823/23.379 h, line-only NaN cases,
  a New York display zone). Every intermediate is compared, not only the five outputs.
  Tolerance 1e-9; measured, everything is bit-identical in both ports except the harmonic
  candidates' Lomb-Scargle power (worst 9.8e-15). Six deliberate breaks per language all
  failed at the expected intermediate (table in the README).
- **Counts.** Python parity 120 -> 131, R parity 94 -> 105 (the R leg claims all 11).
- **Exports.** The generated Python and R scripts embed the whole runtime, so the functions
  ship in them, but no exported script computes plot metric outputs for any plot type (the
  saved metric columns reach `columns.csv` as rawData snapshots). Left as that precedent; no
  new mechanism.
- **Noticed, not changed.** The Python plot-data export's `_actogram_bins_by_period` snaps each
  series to ITS OWN first day in UTC, while the app folds every series at the plot's shared
  startTime in the display zone, so a multi-series actogram whose series start on different
  days (or a non-UTC zone) exports bars on different rows from the app. The new
  `actogram_start_time` / `actogram_series_frame` are the app's rule and could replace it.

### Phase C (not planned in detail; listed so it is not forgotten)

MCP engine support for plot metric outputs (all types): `add_plot` with rules and a
build-time `metricOut` so a model can wire them. Worker-side detection if section 8's
large-data numbers bite in practice. The Python/R port of 2.5 if its trigger fires.

## 7. Risks and open questions

### 7.1 Risks

1. **Performance at N series x R rules.** Detection costs about 1.1 ms per 1000 samples
   per instance (33 ms for a 30-day, 1-minute series). 32 series x 2 rules is about
   2.1 s for a full recompute (a `periodHrs` change, a load, any `recordInnerEdit`), and
   a single rule threshold edit is about 1.1 s. The design keeps the common edit on the
   in-place path (one rule's N instances, no rebuild), but the ceiling is real.
   Mitigations in order: `change` not `input` commits (in the plan); instance
   statistics collapsed by default, because `onsetWarnings` calls `periodogramPeak`
   (800 ms per instance at 30 days, 1 minute) and today's Data tab computes it for
   EVERY open block (an existing cost that rules would multiply by N); detection in a
   worker (Phase C) if users hit it. The rule summary table and the output def must
   never read `harmonicCheck`/`onsetWarnings`; a unit test spies on `periodogramPeak`
   and asserts zero calls while the rule table renders.
2. **Rule rename versus port stability** is solved by id keys (1.5), but only if nothing
   ever keys on the name. Two places tempt it: `labelFor` (display only) and the
   stored-value migration (names are how legacy consumers refer, by necessity). A guard
   test asserts every `metricOut` key of an actogram matches `/^r\d+_(tau|phi|r2|rmse)$/`.
3. **Metric column deletion outside history.** Any path that removes a rule without the
   2.1 batch (a `setPlotInner` undo of an "add rule", an AI edit, a facet migration)
   leaves the effect to delete the columns, which undo cannot restore with the same ids.
   The "undo of add rule" direction is benign (the columns are new); the others need the
   batch. The delete-undo-rewire E2E is the pin.
4. **Selected-periods length drift.** `selectedPeriods` is sized at construction from
   the series' row count (`PhaseMarker.svelte:452-468`); `ruleData` created for a series
   before its data is wired would be sized 0 and read as "all selected" through
   `?? true`, which is correct, but any code that treats a short array as "unselected"
   would silently exclude days. The effective-selection getter is the only reader.
5. **Shared row origin.** All series share `startTime` (the earliest sample over all
   series). Adding a series that starts a day earlier renumbers every other series'
   days: `phi` at "day 1" and the excluded-days list both shift meaning. Today's blocks
   have the same property; rules make it more visible because one list applies to all.
   Documented; open question Q3.
6. **The `cfg`/`store` refactor touches every derived of the most intricate class in the
   actogram.** The existing seven test files cover drag, locks, loading, click, legend
   and write-through; the refactor lands first as a pure no-behaviour commit with the
   whole suite green before any rule code.

### 7.2 Open questions

(Q1, Q2, Q7 answered: see Decisions at the top. Q3 stays open. Q4 to Q6 take the
proposals.)

Q1. Should a rule's line min/max day also exclude days outside the range from the
fit (0.5 item 2)? This plan says no, for identical numbers between a block and its
promoted rule; `excludedDays` is the fit scope.
Q2. Add `r<id>_n` (markers fitted) as a fifth key? Recommended (2.2).
Q3. Should a rule's days be anchored to each series' own first day rather than the
shared row origin? Would change phi semantics relative to today's blocks; not proposed.
Q4. Seeding a rule lock flipped to Fixed: median of instances (proposed), first series,
or require a typed value?
Q5. Should "Reattach" be offered when the detached block's settings still equal the
rule's (a no-op detach, for instance after undoing an edit elsewhere)? Proposed: yes,
and a detached block identical to its rule shows "identical to rule" beside the button.
Q6. Per-day checkbox and manual-point edits are not recorded in history today (for
blocks either). Record them (one op per click) in Phase A for rules and blocks alike,
or leave both as they are? This plan leaves both, for consistency, and lists it.
Q7. When the harmonic check prefers tau/2 or 2 tau, should the rule table flag the
series? Proposed: a warning glyph in the status cell, no change to the port value.

## 8. Measurements

Environment: v77.0 plus the two uncommitted changes, Vite dev server on an automatic
port (the user's 5173 untouched), automation browser (`document.hidden`, so paint is
excluded). Modules imported from the running app.

Detection and fit, pure functions (`onsetUnwrap.js`, `lineFit.js`) on synthetic
free-running data (tau 24.3 h, 12 h active), mean of 5 runs:

| Series | Samples | `matchTemplateMarkers` | unwrap + `fitLine` | `periodogramPeak` (warnings) | Fitted tau |
|---|---|---|---|---|---|
| 14 days, 1-min bins | 20,160 | 14.6 ms | 0.1 ms | 373 ms | 24.301 h |
| 30 days, 1-min bins | 43,200 | 33.2 ms | 0.1 ms | 801 ms | 24.300 h |
| 30 days, 6-min bins | 7,200 | 2.5 ms | 0.1 ms | 131 ms | 24.301 h |

`demo-workflow-rest-activity.json`, plot 0 (2 series, 168 hourly samples each, 7 rows,
P = 24), one onset block per series (N 3, M 3, 50 %): detection plus fit 1.7 ms cold and
0.2 ms warm; harmonic check 1.0 and 0.1 ms; warnings 4.5 and 0 ms. Results: series 1
tau 24.143 h, phi 7.357 h, R2 0.99997, RMSE 0.244 h, 6 markers; series 2 tau 24.627 h,
phi 6.180 h, R2 0.99986, RMSE 0.616 h, 6 markers. A full inner rebuild with an onset and
an offset block on each series (`fromJSON` 0.9 ms plus all fits 1.3 ms) and a live
`plot.plot` swap to DOM flush (7.8 ms) keep the same `<svg>` element.

Faceted metric outputs (0.5 item 5): periodogram plot 3 of
`demo-workflow-free-running.json`, column 71: unfaceted edit wrote `[26]`; faceted edit
left `[24.85]`; unfacet caught up to `[26]`.

Reading: on the demos everything is instant. On a realistic 30-day, 1-minute record the
detection is about 33 ms per series per rule and the warnings periodogram about 0.8 s
per block, so the design's two load-bearing choices are the in-place rule op (R x N
recompute only for the rule that changed, no rebuild) and keeping `periodogramPeak` off
every path the rule table and the outputs read.
