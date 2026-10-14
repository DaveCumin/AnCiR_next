// @ts-nocheck
/* global $state, $effect */
// Table source modes (plan 2026-10-15 "fold Data View into Table", step 1): Columns,
// Plot's computed data, Node results. The class (serialisation, live view, snapshot) and the
// rendered body.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot } from '$lib/core/Plot.svelte';
import {
	registerNodeResultTables,
	clearNodeResultTables
} from '$lib/core/nodeResultTables.svelte.js';
import Tableplot from './Tableplot.svelte';

appConsts.plotMap = await loadPlots();

// A plot with computed data that follows a reactive row list (stands in for a periodogram).
function fakeSourcePlot(id, rowsState) {
	const src = {
		id,
		name: `Source ${id}`,
		type: 'scatterplot',
		x: 0,
		y: 0,
		width: 400,
		height: 300,
		plot: {
			getDownloadData: () => ({
				headers: ['t', 'v'],
				rows: rowsState.rows,
				...(rowsState.note && { note: rowsState.note })
			})
		}
	};
	core.plots.push(src);
	return src;
}

const table = (plot, extra = {}) => new Plot({ type: 'tableplot', name: 'T', ...extra, plot });

beforeEach(() => {
	core.plots.length = 0;
	core.tableProcesses = [{ id: 5, name: 'Cosinor', args: {} }];
	clearNodeResultTables();
});
afterEach(() => cleanup());

describe('serialisation per mode', () => {
	it('a Columns Table writes exactly the v81.13 fields, in the same order', () => {
		const t = table({ columnRefs: [1, 2], showCol: [true, false], decimalPlaces: 3 });
		const json = JSON.parse(JSON.stringify(t.plot));
		expect(Object.keys(json)).toEqual([
			'columnRefs',
			'showCol',
			'colWidths',
			'colCurrent',
			'showColNumber',
			'decimalPlaces'
		]);
		expect(json.columnRefs).toEqual([1, 2]);
		const back = Plot.fromJSON(JSON.parse(JSON.stringify(t)));
		expect(back.plot.source).toBe('columns');
		expect(back.plot.columnRefs).toEqual([1, 2]);
		expect(back.plot.showCol).toEqual([true, false]);
	});

	it("a Plot's-computed-data Table saves its source and no rows at all", () => {
		const rows = $state({ rows: [[1, 2]] });
		fakeSourcePlot(3, rows);
		const t = table({ source: 'plot', sourcePlotId: 3 });
		expect(t.plot.view.rows).toEqual([[1, 2]]);
		const json = JSON.parse(JSON.stringify(t.plot));
		expect(json.source).toBe('plot');
		expect(json.sourcePlotId).toBe(3);
		expect(json.columnRefs).toEqual([]);
		expect(JSON.stringify(json)).not.toMatch(/snapshot|staticRows|"rows"/);
		const back = Plot.fromJSON(JSON.parse(JSON.stringify(t)));
		expect(back.plot.source).toBe('plot');
		expect(back.plot.view.rows).toEqual([[1, 2]]);
	});

	it('a Node-results Table saves its key and snapshot, and loads them back', () => {
		const t = table(
			{ source: 'node', resultKey: 'permutations', snapshot: { headers: ['a'], rows: [[1]] } },
			{ sourceNodeId: 'tableprocess_5' }
		);
		const json = JSON.parse(JSON.stringify(t));
		expect(json.sourceNodeId).toBe('tableprocess_5');
		expect(json.plot).toMatchObject({
			source: 'node',
			resultKey: 'permutations',
			snapshot: { headers: ['a'], rows: [[1]] },
			columnRefs: []
		});
		const back = Plot.fromJSON(json);
		expect(back.plot.resultKey).toBe('permutations');
		expect(back.plot.view).toMatchObject({ headers: ['a'], rows: [[1]], status: 'updating' });
	});

	it('columns in a non-Columns file are ignored (a Table outside Columns mode takes none)', () => {
		const t = table({ source: 'node', resultKey: 'stats', columnRefs: [4], showCol: [true] });
		expect(t.plot.columnRefs).toEqual([]);
		expect(t.plot.showCol).toEqual([]);
	});
});

describe('live view and snapshot (node mode)', () => {
	it('shows the provider live, keeps the last rows as the snapshot, and falls back to it', () => {
		const rows = $state({ rows: [[1]] });
		const off = registerNodeResultTables('tableprocess_5', {
			permutations: { title: 'P', get: () => ({ headers: ['x'], rows: rows.rows }) }
		});
		const t = table(
			{ source: 'node', resultKey: 'permutations', snapshot: { headers: ['x'], rows: [[0]] } },
			{ sourceNodeId: 'tableprocess_5' }
		);
		expect(t.plot.view).toMatchObject({ rows: [[1]], status: 'live' });
		rows.rows = [[1], [2]];
		expect(t.plot.view.rows).toEqual([[1], [2]]);
		// The provider goes (hand-over between instances, or the node recomputing after a load).
		off();
		expect(t.plot.view).toMatchObject({ rows: [[1], [2]], status: 'updating' });
		expect(JSON.parse(JSON.stringify(t.plot)).snapshot.rows).toEqual([[1], [2]]);
		// The node itself is gone: the snapshot is all there is.
		core.tableProcesses = [];
		expect(t.plot.view.status).toBe('snapshot');
		expect(t.plot.getDownloadData().rows).toEqual([[1], [2]]);
	});

	it('serialising the Table never subscribes to the live rows (the graph signature path)', () => {
		const rows = $state({ rows: [[1]] });
		registerNodeResultTables('tableprocess_5', {
			stats: { title: 'S', get: () => ({ headers: ['x'], rows: rows.rows }) }
		});
		const t = table({ source: 'node', resultKey: 'stats' }, { sourceNodeId: 'tableprocess_5' });
		let jsonRuns = 0;
		let viewRuns = 0;
		const stop = $effect.root(() => {
			$effect(() => {
				JSON.stringify(t.plot);
				jsonRuns++;
			});
			$effect(() => {
				void t.plot.view;
				viewRuns++;
			});
		});
		flushSync();
		expect(jsonRuns).toBe(1);
		expect(viewRuns).toBe(1);
		rows.rows = [[1], [2]];
		flushSync();
		rows.rows = [[3]];
		flushSync();
		// The view follows every update; the serialisation is not re-run by any of them.
		expect(viewRuns).toBe(3);
		expect(jsonRuns).toBe(1);
		stop();
	});

	it("a plot-mode Table's serialisation does not read the source plot's data", () => {
		let reads = 0;
		core.plots.push({
			id: 3,
			name: 'S',
			type: 'scatterplot',
			plot: {
				getDownloadData: () => {
					reads++;
					return { headers: ['a'], rows: [[1]] };
				}
			}
		});
		const t = table({ source: 'plot', sourcePlotId: 3 });
		JSON.stringify(t);
		expect(reads).toBe(0);
	});
});

describe('setSource', () => {
	it('leaving Columns drops the wired columns and a wired Column Set', () => {
		const t = table({ columnRefs: [1, 2], showCol: [true, true] }, { setRefs: { series: [9] } });
		t.plot.setSource('plot');
		expect(t.plot.source).toBe('plot');
		expect(t.plot.columnRefs).toEqual([]);
		expect(t.plot.showCol).toEqual([]);
		expect(t.setRefs.series).toEqual([]);
	});

	it('leaving Node results drops the node link and the snapshot', () => {
		const t = table(
			{ source: 'node', resultKey: 'stats', snapshot: { headers: ['a'], rows: [] } },
			{ sourceNodeId: 'tableprocess_5' }
		);
		t.plot.setSource('columns');
		expect(t.sourceNodeId).toBeNull();
		expect(t.plot.resultKey).toBeNull();
		expect(t.plot.snapshot).toBeNull();
	});

	it('ignores an unknown mode', () => {
		const t = table({ columnRefs: [1] });
		t.plot.setSource('bogus');
		expect(t.plot.source).toBe('columns');
		expect(t.plot.columnRefs).toEqual([1]);
	});
});

describe('rendered body', () => {
	const cells = (container) =>
		[...container.querySelectorAll('.tp-tr .tp-td')].map((d) => d.textContent.trim());

	it("plot mode renders the source's rows, follows it, and says when the data was reduced", async () => {
		const rows = $state({ rows: [[1, 2.5]], note: null });
		fakeSourcePlot(3, rows);
		const t = table({ source: 'plot', sourcePlotId: 3, decimalPlaces: 1 });
		const { container } = render(Tableplot, { props: { theData: t, which: 'plot' } });
		flushSync();
		expect([...container.querySelectorAll('.tp-th')].map((h) => h.textContent.trim())).toEqual([
			't',
			'v'
		]);
		expect(cells(container)).toEqual(['1.0', '2.5']);
		expect(container.querySelector('input, [contenteditable]')).toBeNull(); // read-only
		rows.rows = [
			[1, 2],
			[3, 4]
		];
		flushSync();
		expect(container.querySelector('.tableplot-row-bar').textContent).toMatch(/^2 rows/);
		expect(container.querySelector('.tp-status')).toBeNull();
		// A reduced export carries a note; the row bar says so and its title holds the note.
		rows.note = 'Binned to 10 min';
		flushSync();
		const bar = container.querySelector('.tableplot-row-bar');
		expect(bar.textContent).toMatch(/Reduced from the full data/);
		expect(bar.getAttribute('title')).toBe('Binned to 10 min');
	});

	it('plot mode with a missing source says so', () => {
		const t = table({ source: 'plot', sourcePlotId: 42 });
		const { container } = render(Tableplot, { props: { theData: t, which: 'plot' } });
		expect(container.textContent).toMatch(/Source plot not found/);
	});

	it('node mode renders the provider, then the snapshot with a status line when it goes', () => {
		const off = registerNodeResultTables('tableprocess_5', {
			stats: { title: 'S', get: () => ({ headers: ['column', 'r2'], rows: [['y', 0.91]] }) }
		});
		const t = table({ source: 'node', resultKey: 'stats' }, { sourceNodeId: 'tableprocess_5' });
		const { container } = render(Tableplot, { props: { theData: t, which: 'plot' } });
		flushSync();
		expect(cells(container)).toEqual(['y', '0.91']);
		expect(container.querySelector('.tp-status')).toBeNull();
		off();
		flushSync();
		expect(cells(container)).toEqual(['y', '0.91']);
		expect(container.querySelector('.tp-status').textContent).toMatch(
			/saved rows until Cosinor has results/
		);
		// The node is deleted (core.tableProcesses is reassigned, as removal does).
		core.tableProcesses = [];
		flushSync();
		expect(container.querySelector('.tp-status').textContent).toMatch(/source node was not found/);
	});

	it('the panel shows the Source control and hides the Columns tree outside Columns mode', () => {
		const t = table({ source: 'plot', sourcePlotId: null });
		const { container, getByRole } = render(Tableplot, {
			props: { theData: t.plot, which: 'controls' }
		});
		const radios = [...container.querySelectorAll('input[type="radio"]')].map((r) => r.value);
		expect(radios).toEqual(['columns', 'plot', 'node']);
		expect(getByRole('combobox', { name: 'Source plot' })).toBeTruthy();
		expect(container.textContent).not.toMatch(/Columns\s*\d* selected|No data available/);
		expect(container.querySelector('.tree-list')).toBeNull();
	});
});
