// @ts-nocheck
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { PLOT_CHROME } from '$lib/core/workspaceLayout.js';
import { panelsFor } from '$lib/core/facetPanels.svelte.js';

// The user-settable row count for a facet set, end to end through the panel geometry: the
// pure grid maths is pinned in facetGrid.test.js, this checks the real panels land where
// that grid says (their x/y getters), and that the setting survives a save/load.
//
// A histogram generator is used because its facet units are plain columns, one panel per
// wired column, so a test can vary the facet COUNT without building x/y pairings.
function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function makeGenerator(nSeries, extra = {}) {
	const gen = new Plot({ type: 'histogram', facet: true, plot: { data: [] }, ...extra });
	for (let i = 0; i < nSeries; i++) {
		gen.plot.addData({ column: { refId: mkCol(`col${i}`, [1, 2, 3, 4, 5]) } });
	}
	core.plots.push(gen);
	return gen;
}

const uniq = (xs) => [...new Set(xs)].sort((a, b) => a - b);

beforeEach(async () => {
	appConsts.plotMap = await loadPlots();
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	appState.gridSize = 15;
});

describe('facetRows: panel layout', () => {
	it('defaults to 0 (automatic) and keeps the near-square grid', () => {
		const gen = makeGenerator(4);
		expect(gen.facetRows).toBe(0);

		const panels = panelsFor(gen);
		expect(panels).toHaveLength(4);
		// ceil(sqrt(4)) = 2 columns: 2 distinct x and 2 distinct y.
		expect(uniq(panels.map((k) => k.x))).toHaveLength(2);
		expect(uniq(panels.map((k) => k.y))).toHaveLength(2);
	});

	it('lays every facet on one row when rows = 1', () => {
		const panels = panelsFor(makeGenerator(4, { facetRows: 1 }));
		expect(uniq(panels.map((k) => k.y))).toHaveLength(1);
		expect(uniq(panels.map((k) => k.x))).toHaveLength(4);
	});

	it('honours a chosen row count, deriving the columns from it', () => {
		const panels = panelsFor(makeGenerator(6, { facetRows: 3 }));
		expect(uniq(panels.map((k) => k.y))).toHaveLength(3);
		expect(uniq(panels.map((k) => k.x))).toHaveLength(2);
	});

	// The reported bug, end to end: four facets on three rows came back as a 2x2 grid because the
	// row count was treated as an upper bound. Three rows means three rows.
	it('gives exactly the chosen number of rows even when it does not divide evenly', () => {
		const panels = panelsFor(makeGenerator(4, { facetRows: 3 }));
		expect(panels).toHaveLength(4);
		const ys = uniq(panels.map((k) => k.y));
		const xs = uniq(panels.map((k) => k.x));
		expect(ys).toHaveLength(3);
		expect(xs).toHaveLength(2);
		// [2, 1, 1], left-aligned: the two short rows sit at the FIRST column.
		expect(ys.map((y) => panels.filter((k) => k.y === y).length)).toEqual([2, 1, 1]);
		for (const y of ys.slice(1)) expect(panels.filter((k) => k.y === y)[0].x).toBe(xs[0]);
	});

	it('clamps a row count larger than the number of facets', () => {
		const panels = panelsFor(makeGenerator(3, { facetRows: 9 }));
		// One per row, single column, not nine rows with six of them empty.
		expect(uniq(panels.map((k) => k.y))).toHaveLength(3);
		expect(uniq(panels.map((k) => k.x))).toHaveLength(1);
	});

	// The alignment half of the feature. Equal cell size, one pitch per axis, and a partial
	// last row that reuses the column positions of the rows above it, so the panels' axes
	// line up down the grid instead of drifting.
	it('aligns the grid: equal steps, shared column x, shared row y', () => {
		const panels = panelsFor(makeGenerator(5, { facetRows: 2 }));
		expect(panels).toHaveLength(5);
		expect(uniq(panels.map((k) => k.width))).toHaveLength(1);
		expect(uniq(panels.map((k) => k.height))).toHaveLength(1);

		const xs = uniq(panels.map((k) => k.x));
		const ys = uniq(panels.map((k) => k.y));
		expect(xs).toHaveLength(3); // ceil(5/2) columns
		expect(ys).toHaveLength(2);
		// One pitch per axis: consecutive column/row positions are evenly spaced.
		expect(xs[1] - xs[0]).toBe(xs[2] - xs[1]);

		// The partial last row sits at the FIRST columns of the grid above it.
		const lastRow = panels.filter((k) => k.y === ys[1]).map((k) => k.x);
		expect(uniq(lastRow)).toEqual([xs[0], xs[1]]);
	});

	it('steps by the wrapper size so rows do not overlap the header chrome', () => {
		const panels = panelsFor(makeGenerator(4, { facetRows: 2 }));
		const ys = uniq(panels.map((k) => k.y));
		expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(panels[0].height + PLOT_CHROME.y);
	});

	it('re-lays the panels out when the row count changes: same panel objects, new positions', () => {
		const gen = makeGenerator(6);
		const before = panelsFor(gen);
		expect(uniq(before.map((k) => k.y))).toHaveLength(2);

		gen.facetRows = 1;

		const after = panelsFor(gen);
		expect(after).toBe(before);
		after.forEach((p, i) => expect(p).toBe(before[i]));
		expect(uniq(after.map((k) => k.y))).toHaveLength(1);
		expect(core.plots).toEqual([gen]);
	});
});

describe('facetRows: persistence', () => {
	it('round-trips through toJSON/fromJSON', () => {
		const p = new Plot({ type: 'histogram', facet: true, facetRows: 3, plot: { data: [] } });
		expect(p.toJSON().facetRows).toBe(3);
		expect(Plot.fromJSON(p.toJSON()).facetRows).toBe(3);
	});

	// `??` not `||`: 0 IS the value that means automatic, so it has to survive the round trip
	// rather than being re-defaulted (which happens to land on 0 too, hence the toJSON check,
	// which would still catch the field being dropped from the payload entirely).
	it('keeps an explicit 0 (automatic) in the saved payload', () => {
		const p = new Plot({ type: 'histogram', facet: true, facetRows: 0, plot: { data: [] } });
		expect(p.toJSON()).toHaveProperty('facetRows', 0);
		expect(Plot.fromJSON(p.toJSON()).facetRows).toBe(0);
	});

	it('loads an old session (no facetRows) as automatic', () => {
		const legacy = new Plot({ type: 'histogram', facet: true, plot: { data: [] } }).toJSON();
		delete legacy.facetRows;
		expect(Plot.fromJSON(legacy).facetRows).toBe(0);
	});
});
