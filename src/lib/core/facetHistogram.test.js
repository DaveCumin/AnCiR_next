// @ts-nocheck
// Column-based faceting: a histogram generator shows one PANEL per wired column, each panel
// carrying that single column (facets as views, plan 2026-09-26, section 1.2). Panels are
// derived on read from the generator; nothing is spawned into core.plots.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { panelsFor, projectPanel } from '$lib/core/facetPanels.svelte.js';

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function makeHistogram(colRefs) {
	const gen = new Plot({ type: 'histogram', facet: true, plot: { data: [] } });
	for (const ref of colRefs) gen.plot.addData({ column: { refId: ref } });
	core.plots.push(gen);
	return gen;
}

beforeEach(async () => {
	appConsts.plotMap = await loadPlots();
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
});

describe('histogram faceting (column-based)', () => {
	it('shows one histogram panel per wired column, each with that single column', () => {
		const a = mkCol('A', [1, 2, 3, 4, 5]);
		const b = mkCol('B', [10, 20, 30]);
		const gen = makeHistogram([a, b]);

		const panels = panelsFor(gen);
		panels.forEach((p) => projectPanel(p));

		expect(panels).toHaveLength(2);
		expect(panels.every((p) => p.type === 'histogram')).toBe(true);
		expect(panels.every((p) => p.plot.data.length === 1)).toBe(true);
		expect(panels.map((p) => p.plot.data[0]?.column?.refId)).toEqual([a, b]);
		expect(panels.map((p) => p.name)).toEqual(['A', 'B']);
		expect(panels.map((p) => p.unitKey)).toEqual([`c${a}#0`, `c${b}#0`]);
		// Views, not plots: the generator is the only plot in the session.
		expect(core.plots).toEqual([gen]);
	});

	it('keeps the same panel objects across reads while nothing changed', () => {
		const gen = makeHistogram([mkCol('A', [1, 2, 3]), mkCol('B', [4, 5, 6])]);
		const first = panelsFor(gen);
		const again = panelsFor(gen);
		expect(again).toBe(first);
		again.forEach((p, i) => expect(p).toBe(first[i]));
	});

	it('drops a panel when its column is unwired, and every panel when facet is off', () => {
		const a = mkCol('A', [1, 2, 3]);
		const b = mkCol('B', [4, 5, 6]);
		const gen = makeHistogram([a, b]);
		const [pa] = panelsFor(gen);
		expect(panelsFor(gen)).toHaveLength(2);

		gen.plot.data = gen.plot.data.filter((dp) => dp.column.refId === a);
		const after = panelsFor(gen);
		expect(after).toHaveLength(1);
		expect(after[0]).toBe(pa);
		projectPanel(after[0]);
		expect(after[0].plot.data[0].column.refId).toBe(a);

		gen.facet = false;
		expect(panelsFor(gen)).toHaveLength(0);
		expect(core.plots).toEqual([gen]);
	});
});
