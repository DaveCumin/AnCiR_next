import { describe, it, expect, beforeEach } from 'vitest';

import {
	getCachedProcessNodeGraph,
	clearProcessNodeGraphCache
} from './ProcessNode.svelte.js';

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
						outputs: [
							{ name: 'xOut' },
							{ name: 'yOut_', dynamicPrefix: true }
						]
					},
					xOutKey: 'xOut',
					yOutKeyPrefix: 'yOut_'
				}
			]
		]),
		plotMap: new Map([['scatter', { defaultInputs: ['x', 'y'] }]])
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
			{ key: 'xOut', colId: 100 },
			{ key: 'yOut_101', colId: 101 }
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

	it('handles nested TP output columns the same way', () => {
		const core = makeCore();
		core.tableProcesses[0].args.tableProcesses.push({
			id: 9,
			type: 'fakeTP',
			args: { xIN: 1, yIN: [], out: { xOut: 200 }, tableProcesses: [] }
		});
		core.data.push({ id: 200, name: 'nested out', refId: null, processes: [] });
		// Make the nested entry discoverable via collectedType lookup.
		const appConsts = makeAppConsts();
		appConsts.tableProcessMap.get('fakeTP').defaults = new Map([
			['collectedType', { val: 'fakeTP' }]
		]);
		const graph = getCachedProcessNodeGraph(core, appConsts);
		const ids = graph.nodes.map((n) => n.id);
		expect(ids).not.toContain('data_200');
		const nested = graph.nodes.find((n) => n.id === 'tableprocess_nested_9');
		expect(nested.ports.outputs.map((p) => p.name)).toContain('col_200');
		expect(nested.outputColumns).toEqual([{ key: 'xOut', colId: 200 }]);
	});
});
