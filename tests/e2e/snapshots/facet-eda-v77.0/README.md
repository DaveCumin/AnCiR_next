# Pixel pins: EDA facet panels at v77.0

The four panels of generator plot 7 in `static/sessions/demos/demo-workflow-stats-eda.json`,
captured at v77.0 under the "facets as views" model, with the same procedure as
`../facet-eda-v76.4/README.md` (dev server, headless Chromium 1600x1300, Workspace view,
2.5 s settle).

## Why these exist beside the v76.4 pins

The v76.4 pins prove that Phase 1 of facets as views rendered each panel exactly as v76.4
rendered the matching child plot (that comparison passed at commit `02ed0424`). v77.0 then
changed plot rendering on purpose, for every histogram and not only facets:

- the x domain is padded by 2% of the bin range so no bar sits on an axis line;
- the dashed gridline at the axis minimum is no longer drawn over the solid axis.

Those changes move tick positions and drop one gridline, so the v76.4 files can no longer
match. They are kept unchanged as the historical evidence; `facet-migration.spec.js` test (a)
now compares against these v77.0 files, which pin the panels against future regressions.

## Normalisation

Each file is the panel SVG's `outerHTML` with two tokens normalised exactly as the spec does:
the root `id` is written as the old child id (`plot13` to `plot16`), and the panel's series
colour (the generator's colour for that column) is written as the v76.4 child colour
`#234154`. The spec undoes both before comparing.
