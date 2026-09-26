# Facet migration fixtures (captured from v76.4)

Four sessions saved FROM THE BROWSER at v76.4 (`58679bc8`), before the
"facets as views" change (`docs/plans/2026-09-26-facets-as-views.md`,
section 2.3). They are the only sessions that carry facet CHILD plots
(`facetParent` / `facetKey` set): shipped demos never do, because the demo
generator runs without the `+page` reconcile effect (plan section 0.4, item 1).

Do not hand-edit these files. They are byte-for-byte what the app's own
Save action downloaded.

## How they were made

- App: v76.4 on the Vite dev server (`pnpm dev`, http://localhost:5173).
- Browser: headless Playwright Chromium (the repo's own `playwright`
  dependency), viewport 1600x1300 (fixture 1) or 1800x1800 (2 to 4). A
  headless page is NOT `document.hidden`, so `requestAnimationFrame` runs and
  session loading completes normally (the Browser pane is hidden and stalls
  on "Loading N columns").
- Every edit went through the rendered UI: real clicks on the workspace
  title bars to select plots, the control panel's tab buttons, `fill` on the
  panel's number inputs (which fires the same `input` event a keyboard does),
  the facet checkbox ("One plot per series (facet)"), the series grip's HTML5
  drag, and clicks on the actogram SVG to place markers.
- Save: the app's own Cmd+S handler in `src/routes/+page.svelte` (which calls
  `outputCoreAsJson()` and downloads `session.json`), captured with
  Playwright's download event and written unchanged. `version` is `β.76.4`.
- Each fixture was reloaded through `?loadFromURL=/@fs/<abs path>` on the dev
  server afterwards (see "Reload behaviour" below).
- The driver scripts lived in a scratchpad and are not part of the repo; the
  steps below are complete enough to redo by hand.

## 1. `facet-eda-children.json` (the plain case)

Source: `static/sessions/demos/demo-workflow-stats-eda.json` opened via
`?loadFromURL=/sessions/demos/demo-workflow-stats-eda.json`, then the
Workspace (plots) view was opened so the panels rendered, then saved. No
other interaction.

- 9 plots, in `core.plots` order: 7, 13, 14, 15, 16, 8, 9, 10, 11 (the
  children are minted by the reconcile mid-import, so they sit right after
  the generator).
- Generator 7 "Distributions": `type: histogram`, `facet: true`,
  `facetRows: 0`, columns in order 112 `height`, 113 `weight`, 114 `income`,
  115 `noise`.
- Children (`facetParent: 7`, one histogram series each):

  | id  | facetKey  | column |
  | --- | --------- | ------ |
  | 13  | `7:0:112` | height |
  | 14  | `7:1:113` | weight |
  | 15  | `7:2:114` | income |
  | 16  | `7:3:115` | noise  |

- `appState.view` is `plots`, control panel closed, nothing selected.
- The rendered SVG of each child is pinned in
  `tests/e2e/snapshots/facet-eda-v76.4/` (see its README).

## 2. `facet-scatter-edited-children.json` (per-child edits)

Source: `static/sessions/demos/demo-workflow-transients.json`, generator
plot 49 "Onset vs day — immediate delay versus advance transients"
(`scatterplot`, x = column 374 `day`, three series y = 375 `onset_freerun`,
376 `onset_delay`, 377 `onset_advance`; the demo draws lines only, points off).

Steps: Workspace view, control panel opened, plot 49 selected by its title
bar, Properties tab, facet checkbox ticked. That spawned:

| id  | facetKey   | series        |
| --- | ---------- | ------------- |
| 53  | `49:0:375` | onset_freerun |
| 54  | `49:1:376` | onset_delay   |
| 55  | `49:2:377` | onset_advance |

Then, each child selected on its own (single selection, so the panel is the
single-plot branch of `ControlDisplay`, not the shared multi-select branch):

- Child 53, Properties tab, "Left Y-Axis" block: Min set to `10`, Max set to
  `40`. Stored as `plot.ylimsLeftIN: [10, 40]` (the generator keeps
  `[null, null]`).
- Child 54, Properties tab, "Padding" block: Top set to `40`, Right set to
  `50`. Stored as `plot.padding: {top: 40, right: 50, bottom: 35, left: 35}`.
  Bottom and Left were NOT edited on purpose: the scatterplot re-fits those
  two sides from the rendered axis labels (`autoScalePadding` in
  `Scatterplot.svelte`) after any relayout, so a typed value there is
  overwritten the moment another property changes. Note also that the child
  started at `{15, 30, 35, 35}` while the generator has `{15, 30, 53, 60}`:
  children are not copies of the generator's whole-plot properties (plan
  section 0.4, item 3).
- Child 55, Data tab, "Points" block: Radius set to `7`. Stored as
  `plot.data[0].points.radius: 7`. The child already drew points (a child
  series is a fresh `ScatterDataclass` with default style: points on, radius
  4, whereas the generator's series have points off and lines on; plan
  section 0.4, item 4). Nothing else on the series was touched.

State at save: child 55 selected, control panel open on the Data tab.

## 3. `facet-actogram-markers.json` (marker blocks on one child)

Source: `static/sessions/demos/demo-workflow-rest-activity.json`, generator
plot 0 "Representative actograms" (`actogram`, two series: column 1
`Consolidated1` and column 7 `Fragmented1`, x = `hour`).

Steps: Workspace view, panel opened, plot 0 selected, Properties tab, facet
checkbox ticked. Children:

| id  | facetKey | series        |
| --- | -------- | ------------- |
| 4   | `0:0:1`  | Consolidated1 |
| 5   | `0:1:7`  | Fragmented1   |

On child 4 ONLY, Data tab, "Markers and lines" header of its single series:

1. "Add markers" (the plus icon) clicked twice, giving two manual blocks
   `marker_0` (id 0) and `marker_1` (id 1).
2. `marker_0`: Type select changed to **Onset**. Its template parameters are
   the defaults N `3`, M `3`, `%` `50`; the detected onsets are computed, not
   stored (`manualMarkers: []`).
3. `marker_1` stays **Manual**: its "Add markers" button was clicked to arm
   click-to-place, two clicks were made on the child's SVG (day index 2 at
   25 % across the double-plotted width, day index 5 at 35 % across), then
   "Stop adding". Stored as
   `manualMarkers: [59.97525773195876, 136.82474226804123]` (hours from the
   start; the panel shows them as period 3 at 11.98 h and period 6 at
   16.82 h).

Child 5 and the generator's own series carry no `phaseMarkers`. State at
save: child 4 selected, panel open on the Data tab.

## 4. `facet-reordered-children.json` (series reorder respawns children)

Made in the SAME browser session as fixture 2, continuing from its exact
state (not from a reload; see below for why a reload would differ).

A faceted generator has no Data tab in v76.4: selecting it (from the
workflow canvas, or as the parent of a selected child) routes the panel to
the shared multi-select branch, which offers the facet toggle, alignment and
shared properties but no series blocks. So the real-UI route to a reorder is:

1. Workflow (canvas) view, click the generator's node title
   (`canvasMultiSelectedNodeIds: ['plot_49']`).
2. Untick the facet checkbox: children 53, 54, 55 are removed and the
   generator is drawn again.
3. Data tab: HTML5 drag of the LAST series grip (button
   `aria-label="Drag to reorder this series (Alt+Up/Down moves it)"`) onto
   the FIRST series block (`.dataBlock`). Series order went from
   `[375, 376, 377]` to `[377, 375, 376]` (`reorderSeriesWithUndo`, one undo
   step).
4. Properties tab, tick the facet checkbox again. New children:

| id  | facetKey   | series        |
| --- | ---------- | ------------- |
| 56  | `49:0:377` | onset_advance |
| 57  | `49:1:375` | onset_freerun |
| 58  | `49:2:376` | onset_delay   |

Key sets: before `{49:0:375, 49:1:376, 49:2:377}` (ids 53, 54, 55); after
`{49:0:377, 49:1:375, 49:2:376}` (ids 56, 57, 58). None of the fixture-2
per-child edits survive (every child was destroyed), which is the point of
the fixture: migration must key on the column, not the index, and the
column 375 series that had y-limits `[10, 40]` is now at index 1 with none.
State at save: generator 49 selected, panel open on Properties, Workspace
view.

## Reload behaviour at v76.4 (relevant to the migration)

Loading any of these four files back into v76.4 (via `?loadFromURL=`) mints
a SECOND set of children: the `+page` reconcile fires while `importJson` is
still pushing plots, sees the generator with no children yet, and spawns
new ones (fixture 1 loads as 13 plots: 18, 19, 20, 21 plus the file's 13,
14, 15, 16, same four keys twice; fixture 2 gets 59 to 61 beside 53 to 55;
fixture 3 gets 7, 8 beside 4, 5; fixture 4 gets 62 to 64 beside 56 to 58).
The file's own children keep their edits (fixture 2's limits, padding and
radius, fixture 3's marker blocks all reload intact on 53/54/55 and 4). The
minted duplicates are plain. A saved-from-browser session therefore shows
"Faceted plot — 6 facets" on reload today. The migration that replaces the
reconcile should collapse both sets onto the same panel keys.

Despite the duplicate set, fixture 1's four child SVGs (`#plot13` to
`#plot16`) re-render byte-identical to the pinned files after a reload.
