import { describe, it, expect, beforeEach } from 'vitest';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { Plot, syncFacetChildren } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';

// Column-based faceting: a histogram generator spawns one child histogram per wired column.
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

const children = (gen) => core.plots.filter((p) => p.facetParent === gen.id);

beforeEach(async () => {
	appConsts.plotMap = await loadPlots();
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
});

describe('histogram faceting (column-based)', () => {
	it('spawns one child histogram per wired column, each with that single column', () => {
		const a = mkCol('A', [1, 2, 3, 4, 5]);
		const b = mkCol('B', [10, 20, 30]);
		const gen = makeHistogram([a, b]);

		syncFacetChildren(gen);

		const kids = children(gen);
		expect(kids).toHaveLength(2);
		expect(kids.every((c) => c.type === 'histogram')).toBe(true);
		expect(kids.every((c) => c.plot.data.length === 1)).toBe(true);
		expect(kids.map((c) => c.plot.data[0]?.column?.refId).sort()).toEqual([a, b].sort());
		expect(kids.map((c) => c.name).sort()).toEqual(['A', 'B']);
	});

	it('is idempotent — re-running reuses the same child plots', () => {
		const gen = makeHistogram([mkCol('A', [1, 2, 3]), mkCol('B', [4, 5, 6])]);
		syncFacetChildren(gen);
		const firstIds = children(gen)
			.map((c) => c.id)
			.sort();
		syncFacetChildren(gen);
		expect(
			children(gen)
				.map((c) => c.id)
				.sort()
		).toEqual(firstIds);
	});

	it('prunes a child when its column is unwired, and all children when facet is off', () => {
		const a = mkCol('A', [1, 2, 3]);
		const b = mkCol('B', [4, 5, 6]);
		const gen = makeHistogram([a, b]);
		syncFacetChildren(gen);
		expect(children(gen)).toHaveLength(2);

		gen.plot.data = gen.plot.data.filter((dp) => dp.column.refId === a);
		syncFacetChildren(gen);
		expect(children(gen)).toHaveLength(1);
		expect(children(gen)[0].plot.data[0].column.refId).toBe(a);

		gen.facet = false;
		syncFacetChildren(gen);
		expect(children(gen)).toHaveLength(0);
	});
});
