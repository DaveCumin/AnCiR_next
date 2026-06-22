import { describe, it, expect, beforeEach } from 'vitest';

import { getCachedProcessNodeGraph, clearProcessNodeGraphCache } from './ProcessNode.svelte.js';

// Build a fake appConsts with one multi-Y table process ("fakeTP") whose
// nodeSpec declares xIN (one) + yIN (many) inputs and an x + per-y output.
function makeAppConsts() {
	return {
		processMap: new Map(),
		tableProcessMap: new Map([
			[
				'fakeTP',
				{
					nodeSpec: {
						inputs: [
							{ name: 'xIN', cardinality: 'one' },
							{ name: 'yIN', cardinality: 'many' }
						],
						outputs: [{ name: 'xOut' }, { name: 'yOut_', dynamicPrefix: true }]
					},
					xOutKey: 'xOut',
					yOutKeyPrefix: 'yOut_'
				}
			]
		]),
		plotMap: new Map([
			['scatter', { defaultInputs: ['x', 'y'] }],
			// Time-series plots (Actogram/Periodogram/Correlogram/FFT) label their
			// inputs time/values, but the Plot classes STORE every data point as
			// {x, y} (addData remaps time→x, values→y). The graph must wire them
			// from the x/y refs, exactly like an x/y plot.
			['periodogram', { defaultInputs: ['time', 'values'] }],
			// Single-input plots (Histogram) expose one dynamic `data` port and
			// store each series under its declared field name.
			['histogram', { defaultInputs: ['column'] }]
		])
	};
}

// A column whose two outputs (colId 100 = xOut, 101 = yOut) come from the TP,
// plus a plain source column (colId 1) feeding xIN.
function makeCore() {
	return {
		data: [
			{ id: 1, name: 'A', refId: null, processes: [] },
			{ id: 100, name: 'X out', refId: null, processes: [] },
			{ id: 101, name: 'Y out', refId: null, processes: [] }
		],
		tableProcesses: [
			{
				id: 5,
				name: 'fakeTP',
				displayName: 'Fake TP',
				args: {
					xIN: 1,
					yIN: [],
					out: { xOut: 100, yOut_101: 101 },
					tableProcesses: []
				}
			}
		],
		plots: [],
		notes: [],
		groups: [],
		orphanProcesses: []
	};
}

beforeEach(() => clearProcessNodeGraphCache());

describe('TableProcess inline output columns', () => {
	it('does NOT emit standalone data_ nodes for TP output columns', () => {
		const graph = getCachedProcessNodeGraph(makeCore(), makeAppConsts());
		const ids = graph.nodes.map((n) => n.id);
		expect(ids).not.toContain('data_100');
		expect(ids).not.toContain('data_101');
		// The plain source column still gets a data node.
		expect(ids).toContain('data_1');
		expect(ids).toContain('tableprocess_5');
	});

	it('exposes per-column output ports (col_<id>) plus an all port on the TP node', () => {
		const graph = getCachedProcessNodeGraph(makeCore(), makeAppConsts());
		const tp = graph.nodes.find((n) => n.id === 'tableprocess_5');
		const outNames = tp.ports.outputs.map((p) => p.name);
		expect(outNames).toContain('all');
		expect(outNames).toContain('col_100');
		expect(outNames).toContain('col_101');
		// No abstract xOut / yOut_* output ports any more.
		expect(outNames).not.toContain('xOut');
		expect(outNames.some((n) => n.startsWith('yOut_'))).toBe(false);
	});

	it('attaches the ordered output-column list to the TP node meta', () => {
		const graph = getCachedProcessNodeGraph(makeCore(), makeAppConsts());
		const tp = graph.nodes.find((n) => n.id === 'tableprocess_5');
		expect(tp.outputColumns).toEqual([
			{ key: 'xOut', colId: 100, port: 'col_100' },
			{ key: 'yOut_101', colId: 101, port: 'col_101' }
		]);
	});

	it('keeps the input ports on the TP node', () => {
		const graph = getCachedProcessNodeGraph(makeCore(), makeAppConsts());
		const tp = graph.nodes.find((n) => n.id === 'tableprocess_5');
		const inNames = tp.ports.inputs.map((p) => p.name);
		expect(inNames).toContain('xIN');
		expect(inNames).toContain('yIN');
	});

	it('emits no tp-data self→data edges', () => {
		const graph = getCachedProcessNodeGraph(makeCore(), makeAppConsts());
		expect(graph.connections.some((c) => c.type === 'tp-data')).toBe(false);
	});

	it('routes a downstream plot consumer to the TP node inline output port', () => {
		const core = makeCore();
		core.plots.push({
			id: 7,
			name: 'P',
			type: 'scatter',
			plot: { data: [{ x: { refId: 100 }, y: { refId: 101 } }] }
		});
		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const toPlot = graph.connections.filter((c) => c.toId === 'plot_7');
		// x wire comes from the TP node's col_100 port, y from col_101.
		const xEdge = toPlot.find((c) => c.toPort === 'x1');
		const yEdge = toPlot.find((c) => c.toPort === 'ys1');
		expect(xEdge).toMatchObject({ fromId: 'tableprocess_5', fromPort: 'col_100' });
		expect(yEdge).toMatchObject({ fromId: 'tableprocess_5', fromPort: 'col_101' });
		// And there is no data_100 / data_101 node feeding the plot.
		expect(toPlot.every((c) => c.fromId === 'tableprocess_5')).toBe(true);
	});

	it('wires time/values plots (Actogram/Periodogram/FFT/Correlogram) from their x/y refs', () => {
		const core = makeCore();
		core.plots.push({
			id: 11,
			name: 'A Periodogram',
			type: 'periodogram',
			// Stored as {x, y} — addData() remaps the time/values inputs to x/y.
			plot: { data: [{ x: { refId: 1 }, y: { refId: 100 } }] }
		});
		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const toPlot = graph.connections.filter((c) => c.toId === 'plot_11');
		// One wire for x (from the plain source col 1) and one for y (from the
		// TP-produced col 100). Before the fix these plots emitted zero edges
		// because the builder looked for non-existent dp.time / dp.values fields.
		expect(toPlot.length).toBe(2);
		expect(toPlot.some((c) => c.fromId === 'data_1')).toBe(true);
		expect(toPlot.some((c) => c.fromId === 'tableprocess_5')).toBe(true);
	});

	it('exposes x/ys input ports on time/values plots', () => {
		const core = makeCore();
		core.plots.push({
			id: 12,
			name: 'A Periodogram',
			type: 'periodogram',
			plot: { data: [{ x: { refId: 1 }, y: { refId: 100 } }] }
		});
		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const plot = graph.nodes.find((n) => n.id === 'plot_12');
		const inNames = plot.ports.inputs.map((p) => p.name);
		// One populated set (x1/ys1) plus a trailing empty set to add more.
		expect(inNames).toContain('x1');
		expect(inNames).toContain('ys1');
		expect(inNames).toContain('x2');
		expect(inNames).toContain('ys2');
	});

});

describe('plot wiring edge cases', () => {
	it('splits two distinct x.refIds into separate (x1/ys1, x2/ys2) sets', () => {
		const core = makeCore();
		core.plots.push({
			id: 30,
			type: 'scatter',
			plot: {
				data: [
					{ x: { refId: 1 }, y: { refId: 101 } },
					{ x: { refId: 100 }, y: { refId: 101 } }
				]
			}
		});
		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const toPlot = graph.connections.filter((c) => c.toId === 'plot_30');
		expect(toPlot.find((c) => c.toPort === 'x1')).toMatchObject({ fromId: 'data_1' });
		expect(toPlot.find((c) => c.toPort === 'x2')).toMatchObject({ fromId: 'tableprocess_5' });
		// Each set carries its own ys wire.
		expect(toPlot.filter((c) => c.toPort === 'ys1').length).toBe(1);
		expect(toPlot.filter((c) => c.toPort === 'ys2').length).toBe(1);
		const inPorts = graph.nodes.find((n) => n.id === 'plot_30').ports.inputs.map((p) => p.name);
		expect(inPorts).toEqual(expect.arrayContaining(['x1', 'ys1', 'x2', 'ys2', 'x3', 'ys3']));
	});

	it('routes multiple series that share one x into the same ysN port', () => {
		const core = makeCore();
		core.plots.push({
			id: 31,
			type: 'scatter',
			plot: {
				data: [
					{ x: { refId: 1 }, y: { refId: 100 } },
					{ x: { refId: 1 }, y: { refId: 101 } }
				]
			}
		});
		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const toPlot = graph.connections.filter((c) => c.toId === 'plot_31');
		expect(toPlot.filter((c) => c.toPort === 'x1').length).toBe(1); // shared x → single wire
		expect(toPlot.filter((c) => c.toPort === 'ys1').length).toBe(2); // two y series
	});

	it('emits no edge for a data point whose ref points at a missing column', () => {
		const core = makeCore();
		core.plots.push({
			id: 32,
			type: 'scatter',
			plot: { data: [{ x: { refId: 1 }, y: { refId: 9999 } }] }
		});
		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const toPlot = graph.connections.filter((c) => c.toId === 'plot_32');
		expect(toPlot.find((c) => c.toPort === 'x1')).toBeTruthy();
		expect(toPlot.find((c) => c.toPort === 'ys1')).toBeUndefined();
	});

	it('wires a single-input (data-port) plot from each series column', () => {
		const core = makeCore();
		core.plots.push({
			id: 33,
			type: 'histogram',
			plot: { data: [{ column: { refId: 1 } }, { column: { refId: 100 } }] }
		});
		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const toPlot = graph.connections.filter((c) => c.toId === 'plot_33');
		expect(toPlot.every((c) => c.toPort === 'data')).toBe(true);
		expect(toPlot.length).toBe(2);
	});

	it('collapses an all-output bundle into a single all-port edge (tableplot series)', () => {
		const core = makeCore();
		core.plots.push({ id: 50, type: 'tableplot', plot: { columnRefs: [100, 101] } });
		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const toTable = graph.connections.filter((c) => c.toId === 'plot_50' && c.toPort === 'series');
		// Both of the TP's outputs flow to the table → one edge from its `all` port.
		expect(toTable.length).toBe(1);
		expect(toTable[0].fromId).toBe('tableprocess_5');
		expect(toTable[0].fromPort).toBe('all');
	});

	it('does NOT collapse when only some of a node’s outputs feed the target', () => {
		const core = makeCore();
		core.plots.push({ id: 51, type: 'tableplot', plot: { columnRefs: [100] } });
		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const toTable = graph.connections.filter((c) => c.toId === 'plot_51' && c.toPort === 'series');
		expect(toTable.length).toBe(1);
		expect(toTable[0].fromPort).toBe('col_100'); // single column → not bundled
	});
});

describe('process-chain + token-input wiring', () => {
	it('chains data → process → process along a column', () => {
		const core = makeCore();
		core.data[0].processes = [
			{ id: 40, name: 'Add', args: {} },
			{ id: 41, name: 'Sub', args: {} }
		];
		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const c = graph.connections;
		expect(c.find((e) => e.fromId === 'data_1' && e.toId === 'process_40')).toBeTruthy();
		expect(c.find((e) => e.fromId === 'process_40' && e.toId === 'process_41')).toBeTruthy();
	});

	it('extracts only col-typed tokens from a token-array input (FormulaColumn style)', () => {
		const core = makeCore();
		core.tableProcesses.push({
			id: 50,
			name: 'fakeFormula',
			args: {
				tokens: [
					{ type: 'col', id: 1 },
					{ type: 'text', value: ' + ' },
					{ type: 'stored', key: 'k' },
					{ type: 'col', id: 100 }
				],
				out: { result: -1 }
			}
		});
		const appConsts = makeAppConsts();
		appConsts.tableProcessMap.set('fakeFormula', {
			nodeSpec: {
				inputs: [{ name: 'tokens', kind: 'column', cardinality: 'many' }],
				outputs: [{ name: 'result' }]
			}
		});
		const graph = getCachedProcessNodeGraph(core, appConsts);
		const toTP = graph.connections.filter((c) => c.toId === 'tableprocess_50');
		// Only the two `col` tokens wire; text/stored tokens are ignored.
		expect(toTP.length).toBe(2);
		expect(toTP.every((c) => c.toPort === 'tokens')).toBe(true);
		expect(toTP.some((c) => c.fromId === 'data_1')).toBe(true);
		expect(toTP.some((c) => c.fromId === 'tableprocess_5')).toBe(true);
	});
});
