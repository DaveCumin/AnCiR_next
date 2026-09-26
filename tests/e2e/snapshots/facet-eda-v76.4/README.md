# Pixel pins: EDA facet children at v76.4

Rendered SVG of the four facet children of generator plot 7 ("Distributions",
`histogram`, `facet: true`, `facetRows: 0`) in
`static/sessions/demos/demo-workflow-stats-eda.json`, captured at v76.4
(`58679bc8`) before the "facets as views" change. The matching saved session
is `src/test/fixtures/facet-eda-children.json`.

## Capture

- v76.4 on the Vite dev server, headless Playwright Chromium, viewport
  1600x1300, page not hidden (rAF runs).
- Loaded via `?loadFromURL=/sessions/demos/demo-workflow-stats-eda.json`,
  waited for the loading overlay to clear, clicked the Workspace view button
  (`[data-testid=nav-workspace-view]`), waited 2.5 s, control panel CLOSED,
  nothing selected, canvas at its default scale and offset.
- Each file is `document.getElementById('plot' + childId).outerHTML`, written
  verbatim (UTF-8). `grid.png` is a viewport clip covering the four panels
  plus their title bars: x 105, y 423, width 1120, height 730 (CSS px).

## Panels

Column order is the generator's series order. `plot x/y` are the child
Plot's own `x`, `y`, `width`, `height` fields (workspace units);
`client rect` is `getBoundingClientRect()` of the SVG in the viewport above.

| file         | child id | facetKey  | column (id)  | plot x, y | plot w x h | client rect (x, y, w, h) |
| ------------ | -------- | --------- | ------------ | --------- | ---------- | ------------------------ |
| `height.svg` | 13       | `7:0:112` | height (112) | 60, 435   | 525 x 300  | 125, 473, 525, 300       |
| `weight.svg` | 14       | `7:1:113` | weight (113) | 615, 435  | 525 x 300  | 680, 473, 525, 300       |
| `income.svg` | 15       | `7:2:114` | income (114) | 60, 795   | 525 x 300  | 125, 833, 525, 300       |
| `noise.svg`  | 16       | `7:3:115` | noise (115)  | 615, 795  | 525 x 300  | 680, 833, 525, 300       |

Every SVG root has `width="525" height="300" viewBox="0 0 525 300"`. The
generator's own fields are `x: 60, y: 60, width: 520, height: 300`; the
children are laid out by `facetGrid.js` (4 facets, auto rows, so 2 x 2).

## Comparing later

- The ONLY `id` attribute in each file is the root's `id="plot<childId>"`
  (`plot13` … `plot16`). There are no `<clipPath>` elements and no
  `url(#…)` references at v76.4, so normalising the root `id` is the whole
  normalisation today; a later renderer that mints clip or overlay ids must
  strip those on both sides before comparing.
- The child ids 13 to 16 are re-minted identically on every fresh load of the
  shipped demo, and the SVGs re-render byte-identical after reloading the
  saved fixture (which, at v76.4, also mints a duplicate child set 18 to 21;
  see `src/test/fixtures/README.md`).
- Under the views model the same panels are expected at ids like
  `plot7:c112#0`; compare after replacing the root id.
