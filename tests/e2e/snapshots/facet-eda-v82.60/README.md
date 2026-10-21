# Pixel pins: EDA facet panels at v82.60

The four panels of generator plot 7 in `static/sessions/demos/demo-workflow-stats-eda.json`,
captured at v82.60 with the same procedure as `../facet-eda-v77.0/README.md` (dev server,
headless Chromium 1600x1300, Workspace view, 2.5 s settle).

## Why these replace the v77.0 pins

Between v77.0 and v82.60 every plot gained markup that draws nothing for these panels:

- the empty overlay layers (`overlay-bands-layer`, `overlay-lines-layer`) added with plot
  overlays in v82;
- a `plot-legend` class and an inner `<g>` around the legend (same translate);
- Svelte scope classes on the axes once the axis component gained its own CSS.

A line-by-line comparison of the v77.0 and v82.60 files shows only those additions: tick
positions, bars, gridlines, labels and the legend position are unchanged. The v76.4 and v77.0
folders are kept unchanged as history.

## Normalisation

As for v77.0: the root `id` is written as the old child id (`plot13` to `plot16`) and the
panel's series colour as the v76.4 child colour `#234154`. In addition, Svelte scope classes
(`s-…` in dev, `svelte-…` in a build) are removed from every `class` attribute, and an
attribute left empty is dropped, so a CSS-only change to a component does not break the pins.
`facet-migration.spec.js` applies the same normalisation to the live SVG before comparing.
