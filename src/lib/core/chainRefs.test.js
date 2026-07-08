import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/Column.svelte', () => ({
	Column: vi.fn(),
	getColumnById: (id) => mockColumns[id]
}));
vi.mock('$lib/core/Plot.svelte', () => ({ Plot: vi.fn() }));

import { core } from '$lib/core/core.svelte';
import { recordChainRef, reconcileChainRefs, plotUsesColumn } from './chainRefs.js';

function seed() {
	core.plots.length = 0;
	core.tableProcesses.length = 0;
	core.chainRefs = [];
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mockColumns[5] = { id: 5, name: 'hour' };
	mockColumns[6] = { id: 6, name: 'activity' };
	mockColumns[7] = { id: 7, name: 'hour_v2' };
	// Via plot: periodogram showing x=5, y=6 (series 1).
	core.plots.push({
		id: 9,
		type: 'periodogram',
		facetParent: null,
		plot: { data: [{ x: { refId: 5 }, y: { refId: 6 } }] }
	});
	// Consumer plot: scatter chained x from the periodogram's passthrough.
	core.plots.push({
		id: 10,
		type: 'scatterplot',
		facetParent: null,
		plot: { data: [{ x: { refId: 5 }, y: { refId: 6 } }] }
	});
}

beforeEach(seed);

describe('recordChainRef', () => {
	it('replaces an existing entry for the same target and refuses self-chains', () => {
		recordChainRef({
			toId: 'plot_10',
			toPort: 'x1',
			viaPlotId: 9,
			colId: 5,
			channel: 'x',
			series: 1
		});
		recordChainRef({
			toId: 'plot_10',
			toPort: 'x1',
			viaPlotId: 9,
			colId: 5,
			channel: 'x',
			series: 1
		});
		expect(core.chainRefs).toHaveLength(1);
		recordChainRef({ toId: 'plot_9', toPort: 'x1', viaPlotId: 9, colId: 5 });
		expect(core.chainRefs).toHaveLength(1); // self-chain ignored
	});
});

describe('reconcileChainRefs', () => {
	const entry = () => ({
		toId: 'plot_10',
		toPort: 'x1',
		viaPlotId: 9,
		colId: 5,
		channel: 'x',
		series: 1
	});

	it('keeps an in-sync entry', () => {
		core.chainRefs = [entry()];
		reconcileChainRefs();
		expect(core.chainRefs).toHaveLength(1);
	});

	it('drops the entry when the via plot is deleted', () => {
		core.chainRefs = [entry()];
		core.plots.splice(0, 1);
		reconcileChainRefs();
		expect(core.chainRefs).toHaveLength(0);
	});

	it('drops the entry when the consumer moved off the column (undo-safe)', () => {
		core.chainRefs = [entry()];
		core.plots[1].plot.data[0].x.refId = 7; // consumer manually rewired
		reconcileChainRefs();
		expect(core.chainRefs).toHaveLength(0);
		// Consumer keeps its own choice.
		expect(core.plots[1].plot.data[0].x.refId).toBe(7);
	});

	it("FOLLOWS an upstream x rewire: consumer ref moves to the plot's new x", () => {
		core.chainRefs = [entry()];
		core.plots[0].plot.data[0].x.refId = 7; // via plot rewired its x 5 → 7
		reconcileChainRefs();
		expect(core.plots[1].plot.data[0].x.refId).toBe(7);
		expect(core.chainRefs[0].colId).toBe(7);
	});

	it('follows a y rewire only when the series has exactly one y', () => {
		mockColumns[8] = { id: 8, name: 'temp' };
		core.chainRefs = [
			{ toId: 'plot_10', toPort: 'ys1', viaPlotId: 9, colId: 6, channel: 'y', series: 1 }
		];
		core.plots[0].plot.data[0].y.refId = 8; // via plot y 6 → 8 (sole y)
		reconcileChainRefs();
		expect(core.plots[1].plot.data[0].y.refId).toBe(8);
		expect(core.chainRefs[0].colId).toBe(8);
	});

	it('drops the entry when a y rewire is ambiguous (multiple ys in the series)', () => {
		mockColumns[8] = { id: 8, name: 'temp' };
		mockColumns[9] = { id: 9, name: 'light' };
		core.chainRefs = [
			{ toId: 'plot_10', toPort: 'ys1', viaPlotId: 9, colId: 6, channel: 'y', series: 1 }
		];
		// Via plot now shows TWO other ys on the same x — replacement unclear.
		core.plots[0].plot.data = [
			{ x: { refId: 5 }, y: { refId: 8 } },
			{ x: { refId: 5 }, y: { refId: 9 } }
		];
		reconcileChainRefs();
		expect(core.chainRefs).toHaveLength(0);
		expect(core.plots[1].plot.data[0].y.refId).toBe(6); // consumer untouched
	});

	it('follows into TP consumers (yIN array member)', () => {
		core.tableProcesses.push({ id: 3, name: 'cosinor', args: { xIN: 5, yIN: [6] } });
		core.chainRefs = [
			{ toId: 'tableprocess_3', toPort: 'xIN', viaPlotId: 9, colId: 5, channel: 'x', series: 1 }
		];
		core.plots[0].plot.data[0].x.refId = 7;
		reconcileChainRefs();
		expect(core.tableProcesses[0].args.xIN).toBe(7);
	});
});

describe('plotUsesColumn', () => {
	it('checks x/y channels and tableplot columnRefs', () => {
		expect(plotUsesColumn(core.plots[0], 5)).toBe(true);
		expect(plotUsesColumn(core.plots[0], 99)).toBe(false);
		expect(plotUsesColumn({ plot: { columnRefs: [4] } }, 4)).toBe(true);
	});
});
