// @ts-nocheck
// The one list of columns a plot series reads (core/seriesChannelRefs.js), and the callers
// that used to keep their own copy. Real plot classes from the registry, not hand-built
// objects: the bug these pin (column delete and ref remapping knew x/y/z but not `column`)
// only exists on the real series shapes.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appConsts, replaceColumnRefs, swapColumnRefsBulk } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column, removeColumn } from '$lib/core/Column.svelte';
import { plotUsesColumn } from '$lib/core/chainRefs.js';
import {
	SERIES_COLUMN_FIELDS,
	seriesChannelRefs,
	seriesColumnIds,
	seriesReadsColumn,
	seriesHasData,
	remapSeriesRefs,
	plotColumnIds,
	plotInnerUsesColumn
} from '$lib/core/seriesChannelRefs.js';

function mkCol(name, values = [1, 2, 3]) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function mkPlot(type, series) {
	const p = new Plot({ type, plot: { data: [] } });
	for (const s of series) p.plot.addData(s);
	core.plots.push(p);
	return core.plots[core.plots.length - 1];
}

const columnsOf = (p) => p.plot.data.map((dp) => seriesColumnIds(dp));

beforeEach(async () => {
	appConsts.plotMap = await loadPlots();
	core.data = [];
	core.plots = [];
	core.groups = [];
	core.tableProcesses = [];
	core.chainRefs = [];
	core.rawData = new Map();
});

describe('seriesChannelRefs', () => {
	it('lists the fixed fields in order, including the vestigial z', () => {
		expect(SERIES_COLUMN_FIELDS).toEqual(['x', 'y', 'z', 'column']);
		const dp = { x: { refId: 1 }, y: { refId: 2 }, z: { refId: 3 }, column: { refId: 4 } };
		expect(seriesChannelRefs(dp).map((c) => [c.field, c.refId, c.display, c.axis])).toEqual([
			['x', 1, 'x', 'x'],
			['y', 2, 'y', 'y'],
			['z', 3, 'z', 'y'],
			['column', 4, '', null]
		]);
	});

	it('reads a real scatter series (x, y) and a real histogram series (column)', () => {
		const a = mkCol('a');
		const b = mkCol('b');
		const sc = mkPlot('scatterplot', [{ x: { refId: a }, y: { refId: b } }]);
		const hi = mkPlot('histogram', [{ column: { refId: b } }]);
		expect(seriesChannelRefs(sc.plot.data[0]).map((c) => c.field)).toEqual(['x', 'y']);
		expect(seriesColumnIds(sc.plot.data[0])).toEqual([a, b]);
		expect(seriesChannelRefs(hi.plot.data[0]).map((c) => c.field)).toEqual(['column']);
		expect(seriesColumnIds(hi.plot.data[0])).toEqual([b]);
	});

	it('treats -1, null and non-numbers as unwired; column id 0 is wired', () => {
		const dp = { x: { refId: 0 }, y: { refId: -1 }, column: { refId: null } };
		expect(seriesColumnIds(dp)).toEqual([0]);
		expect(seriesReadsColumn(dp, 0)).toBe(true);
		expect(seriesReadsColumn(dp, -1)).toBe(false);
		expect(seriesHasData(dp)).toBe(true);
		expect(seriesHasData({ x: { refId: -1 }, column: { refId: null } })).toBe(false);
		expect(seriesChannelRefs(null)).toEqual([]);
	});

	it('remaps in place, keeping the wrapper instance', () => {
		const a = mkCol('a');
		const b = mkCol('b');
		const c = mkCol('c');
		const sc = mkPlot('scatterplot', [{ x: { refId: a }, y: { refId: b } }]);
		const dp = sc.plot.data[0];
		const xWrapper = dp.x;
		remapSeriesRefs(dp, (id) => (id === a ? c : id));
		expect(dp.x).toBe(xWrapper);
		expect(seriesColumnIds(dp)).toEqual([c, b]);
	});

	it('plotColumnIds and plotInnerUsesColumn cover Table columnRefs and every series channel', () => {
		const a = mkCol('a');
		const b = mkCol('b');
		const hi = mkPlot('histogram', [{ column: { refId: a } }, { column: { refId: b } }]);
		expect(plotColumnIds(hi.plot)).toEqual([a, b]);
		expect(plotInnerUsesColumn(hi.plot, b)).toBe(true);
		expect(plotColumnIds({ columnRefs: [b, a, -1] })).toEqual([b, a]);
		expect(plotInnerUsesColumn({ columnRefs: [a] }, a)).toBe(true);
		expect(plotInnerUsesColumn(hi.plot, 999)).toBe(false);
	});
});

// Reproduced in the running app (demo-workflow-stats-eda, 2026-10-20): deleting the
// "noise" column emptied the Histogram, the Correlation heatmap and the Pairs plot, which
// all read height, weight, income and noise. The scrub knew x/y/z, so it left `column`
// alone, then dropped every series without a wired x or y: all of them.
describe('deleting a column from column-based plots', () => {
	for (const type of ['histogram', 'qqplot', 'correlationheatmap', 'pairsplot']) {
		it(`${type}: keeps the other series and drops only the deleted column's`, () => {
			const a = mkCol('a');
			const b = mkCol('b');
			const unrelated = mkCol('unrelated');
			const p = mkPlot(type, [{ column: { refId: a } }, { column: { refId: b } }]);
			removeColumn(unrelated);
			expect(columnsOf(p)).toEqual([[a], [b]]);
			removeColumn(a);
			expect(columnsOf(p)).toEqual([[b]]);
		});
	}

	it('scatterplot: clearing x keeps the series while y is wired (unchanged rule)', () => {
		const t = mkCol('t');
		const y = mkCol('y');
		const p = mkPlot('scatterplot', [{ x: { refId: t }, y: { refId: y } }]);
		removeColumn(t);
		expect(p.plot.data).toHaveLength(1);
		expect(p.plot.data[0].x.refId).toBe(-1);
		expect(p.plot.data[0].y.refId).toBe(y);
		removeColumn(y);
		expect(p.plot.data).toHaveLength(0);
	});
});

describe('re-pointing column references reaches every channel', () => {
	it('replaceColumnRefs re-points a histogram column (as a 1:1 node delete bridges it)', () => {
		const src = mkCol('source');
		const out = mkCol('output');
		const p = mkPlot('histogram', [{ column: { refId: out } }]);
		replaceColumnRefs(src, out);
		expect(columnsOf(p)).toEqual([[src]]);
	});

	it('swapColumnRefsBulk swaps histogram columns and scatter channels in one pass', () => {
		const a = mkCol('a');
		const b = mkCol('b');
		const hi = mkPlot('histogram', [{ column: { refId: a } }]);
		const sc = mkPlot('scatterplot', [{ x: { refId: a }, y: { refId: b } }]);
		swapColumnRefsBulk([[a, b]]);
		expect(columnsOf(hi)).toEqual([[b]]);
		expect(columnsOf(sc)).toEqual([[b, a]]);
	});
});

describe('chain validation', () => {
	it('plotUsesColumn sees a histogram column and a Table column', () => {
		const a = mkCol('a');
		const hi = mkPlot('histogram', [{ column: { refId: a } }]);
		expect(plotUsesColumn(hi, a)).toBe(true);
		expect(plotUsesColumn(hi, a + 100)).toBe(false);
		expect(plotUsesColumn({ plot: { columnRefs: [a] } }, a)).toBe(true);
	});
});

describe('plot node passthrough ports read the channels from the helper', () => {
	it('x and y carry series and axis; a column-based series carries neither', async () => {
		const { getCachedProcessNodeGraph, clearProcessNodeGraphCache } =
			await import('$lib/core/ProcessNode.svelte.js');
		clearProcessNodeGraphCache();
		const fakeCore = {
			data: [
				{ id: 1, name: 'time', refId: null, processes: [] },
				{ id: 2, name: 'temp', refId: null, processes: [] },
				{ id: 3, name: 'weight', refId: null, processes: [] }
			],
			tableProcesses: [],
			plots: [
				{
					id: 9,
					name: 'S',
					type: 'scatterplot',
					plot: { data: [{ x: { refId: 1 }, y: { refId: 2 } }], overlays: [] }
				},
				{ id: 10, name: 'H', type: 'histogram', plot: { data: [{ column: { refId: 3 } }] } }
			],
			notes: [],
			groups: [],
			orphanProcesses: []
		};
		const consts = {
			processMap: new Map(),
			tableProcessMap: new Map(),
			plotMap: new Map([
				['scatterplot', { defaultInputs: ['x', 'y'] }],
				['histogram', { defaultInputs: ['column'] }]
			])
		};
		const graph = getCachedProcessNodeGraph(fakeCore, consts);
		const outs = (id) =>
			graph.nodes
				.find((n) => n.id === id)
				.ports.outputs.filter((p) => p.passthrough)
				.map((p) => [p.name, p.series ?? null, p.axis ?? null]);
		expect(outs('plot_9')).toEqual([
			['col_1', 1, 'x'],
			['col_2', 1, 'y']
		]);
		expect(outs('plot_10')).toEqual([['col_3', null, null]]);
	});
});
