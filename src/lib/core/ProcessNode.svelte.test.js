import { describe, it, expect, beforeEach } from 'vitest';

import {
	getCachedProcessNodeGraph,
	clearProcessNodeGraphCache,
	plotNodeSlots
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

	it('exposes per-column output ports (col_<id>) on the TP node, and no `all` port', () => {
		const graph = getCachedProcessNodeGraph(makeCore(), makeAppConsts());
		const tp = graph.nodes.find((n) => n.id === 'tableprocess_5');
		const outNames = tp.ports.outputs.map((p) => p.name);
		expect(outNames).toContain('col_100');
		expect(outNames).toContain('col_101');
		// The `all` bundle port was removed.
		expect(outNames).not.toContain('all');
		// No abstract xOut / yOut_* output ports any more.
		expect(outNames).not.toContain('xOut');
		expect(outNames.some((n) => n.startsWith('yOut_'))).toBe(false);
	});

	it('attaches the ordered output-column list to the TP node meta', () => {
		const graph = getCachedProcessNodeGraph(makeCore(), makeAppConsts());
		const tp = graph.nodes.find((n) => n.id === 'tableprocess_5');
		expect(tp.outputColumns).toEqual([
			{ key: 'xOut', colId: 100, port: 'col_100', metric: false },
			{ key: 'yOut_101', colId: 101, port: 'col_101', metric: false }
		]);
	});

	it('marks out-keys matching metric nodeSpec outputs (exact and dynamic-prefix)', () => {
		const core = makeCore();
		core.data.push(
			{ id: 102, name: 'r2', refId: null, processes: [] },
			{ id: 103, name: 'stat_peak', refId: null, processes: [] }
		);
		core.tableProcesses[0].args.out.r2 = 102;
		core.tableProcesses[0].args.out.stat_peak = 103;
		const appConsts = makeAppConsts();
		appConsts.tableProcessMap
			.get('fakeTP')
			.nodeSpec.outputs.push(
				{ name: 'r2', metric: true },
				{ name: 'stat_*', dynamicPrefix: 'stat_', metric: true }
			);

		const graph = getCachedProcessNodeGraph(core, appConsts);
		const tp = graph.nodes.find((n) => n.id === 'tableprocess_5');
		const byKey = Object.fromEntries(tp.outputColumns.map((c) => [c.key, c.metric]));
		expect(byKey).toEqual({ xOut: false, yOut_101: false, r2: true, stat_peak: true });
		// The metric flag also rides on the emitted ports (CompactNode styling).
		const metricPorts = tp.ports.outputs.filter((p) => p.metric).map((p) => p.name);
		expect(metricPorts).toEqual(['col_102', 'col_103']);
	});

	it('plot metric out-columns become metric ports on the plot node (no data_ node)', () => {
		const core = makeCore();
		core.data.push({ id: 200, name: 'peak_period_9', refId: null, processes: [] });
		core.plots.push({
			id: 9,
			name: 'P',
			type: 'periodogram',
			metricOut: { peak_period: 200 },
			plot: { data: [{ x: { refId: 1 }, y: { refId: 100 } }] }
		});
		// A downstream scatter consumes the metric column.
		core.plots.push({
			id: 10,
			name: 'S',
			type: 'scatter',
			plot: { data: [{ x: { refId: 1 }, y: { refId: 200 } }] }
		});

		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		expect(graph.nodes.map((n) => n.id)).not.toContain('data_200');
		const plotNode = graph.nodes.find((n) => n.id === 'plot_9');
		const metricPort = plotNode.ports.outputs.find((p) => p.name === 'col_200');
		expect(metricPort).toMatchObject({ metric: true, display: 'peak_period' });
		// The consumer's y wire routes from the owning plot's metric port.
		const yEdge = graph.connections.find((c) => c.toId === 'plot_10' && c.toPort === 'ys1');
		expect(yEdge).toMatchObject({ fromId: 'plot_9', fromPort: 'col_200' });
	});

	it('chainRefs route a chained consumer edge from the via-plot passthrough', () => {
		const core = makeCore();
		core.plots.push(
			{
				id: 9,
				name: 'P',
				type: 'periodogram',
				plot: { data: [{ x: { refId: 1 }, y: { refId: 100 } }] }
			},
			{
				id: 10,
				name: 'S',
				type: 'scatter',
				plot: { data: [{ x: { refId: 1 }, y: { refId: 100 } }] }
			}
		);
		core.chainRefs = [
			{ toId: 'plot_10', toPort: 'x1', viaPlotId: 9, colId: 1, channel: 'x', series: 1 }
		];

		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const xEdge = graph.connections.find((c) => c.toId === 'plot_10' && c.toPort === 'x1');
		expect(xEdge).toMatchObject({ fromId: 'plot_9', fromPort: 'col_1' });
		// The un-chained y wire still draws from its true owner (the TP node).
		const yEdge = graph.connections.find((c) => c.toId === 'plot_10' && c.toPort === 'ys1');
		expect(yEdge).toMatchObject({ fromId: 'tableprocess_5', fromPort: 'col_100' });
		// The periodogram itself still draws from the true sources.
		const viaX = graph.connections.find((c) => c.toId === 'plot_9' && c.toPort === 'x1');
		expect(viaX).toMatchObject({ fromId: 'data_1' });
	});

	it('a stale chainRef (via-plot no longer shows the column) falls back to the owner', () => {
		const core = makeCore();
		core.plots.push(
			{
				id: 9,
				name: 'P',
				type: 'periodogram',
				plot: { data: [{ x: { refId: 100 }, y: { refId: 101 } }] } // does NOT show col 1
			},
			{
				id: 10,
				name: 'S',
				type: 'scatter',
				plot: { data: [{ x: { refId: 1 }, y: { refId: 100 } }] }
			}
		);
		core.chainRefs = [
			{ toId: 'plot_10', toPort: 'x1', viaPlotId: 9, colId: 1, channel: 'x', series: 1 }
		];

		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const xEdge = graph.connections.find((c) => c.toId === 'plot_10' && c.toPort === 'x1');
		expect(xEdge).toMatchObject({ fromId: 'data_1' });
	});

	it('plotNodeSlots aligns passthrough outputs with their series; metrics trail', () => {
		const inputs = [
			{ name: 'x1', axis: 'x', series: 1 },
			{ name: 'ys1', axis: 'y', series: 1 },
			{ name: 'x2', axis: 'x', series: 2, newSeries: true },
			{ name: 'ys2', axis: 'y', series: 2, newSeries: true }
		];
		const outputs = [
			{ name: 'col_1', series: 1, axis: 'x' },
			{ name: 'col_2', series: 1, axis: 'y' },
			{ name: 'col_18', metric: true }
		];
		const { inputRows, outputRows, totalSlots } = plotNodeSlots(inputs, outputs);

		// Inputs: header(0) x1(1) ys1(2) header(3) x2(4) ys2(5)
		const inSlot = (name) => inputRows.find((r) => r.kind === 'port' && r.port.name === name)?.slot;
		expect(inSlot('x1')).toBe(1);
		expect(inSlot('ys1')).toBe(2);
		expect(inSlot('x2')).toBe(4);
		expect(inSlot('ys2')).toBe(5);

		// Outputs: x passthrough BESIDE the x row, y beside the ys row, metric
		// after all series.
		const outSlot = (name) => outputRows.find((r) => r.port.name === name)?.slot;
		expect(outSlot('col_1')).toBe(1);
		expect(outSlot('col_2')).toBe(2);
		expect(outSlot('col_18')).toBe(6);
		expect(totalSlots).toBe(7);
	});

	it('plotNodeSlots stretches a series block when it has multiple y outputs', () => {
		const inputs = [
			{ name: 'x1', axis: 'x', series: 1 },
			{ name: 'ys1', axis: 'y', series: 1 },
			{ name: 'x2', axis: 'x', series: 2, newSeries: true },
			{ name: 'ys2', axis: 'y', series: 2, newSeries: true }
		];
		const outputs = [
			{ name: 'col_1', series: 1, axis: 'x' },
			{ name: 'col_2', series: 1, axis: 'y' },
			{ name: 'col_3', series: 1, axis: 'y' },
			{ name: 'col_18', metric: true }
		];
		const { inputRows, outputRows, totalSlots } = plotNodeSlots(inputs, outputs);

		const outSlot = (name) => outputRows.find((r) => r.port.name === name)?.slot;
		// y outputs run downward from the ys row; series 2 starts below them.
		expect(outSlot('col_2')).toBe(2);
		expect(outSlot('col_3')).toBe(3);
		const inSlot = (name) => inputRows.find((r) => r.kind === 'port' && r.port.name === name)?.slot;
		expect(inSlot('x2')).toBe(5); // header at 4
		expect(inSlot('ys2')).toBe(6);
		expect(outSlot('col_18')).toBe(7);
		expect(totalSlots).toBe(8);
	});

	it('plot input columns are re-exposed as passthrough output ports', () => {
		const core = makeCore();
		core.plots.push({
			id: 9,
			name: 'P',
			type: 'scatter',
			plot: { data: [{ x: { refId: 1 }, y: { refId: 100 } }] }
		});
		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const plotNode = graph.nodes.find((n) => n.id === 'plot_9');
		const outNames = plotNode.ports.outputs.map((p) => p.name);
		expect(outNames).toContain('col_1');
		expect(outNames).toContain('col_100');
		const xPass = plotNode.ports.outputs.find((p) => p.name === 'col_1');
		expect(xPass.passthrough).toBe(true);
		expect(xPass.display).toBe('A (x)');
		// Passthrough is a drag-source convenience only: the source column keeps
		// its own data node (it is not owned by the plot).
		expect(graph.nodes.map((n) => n.id)).toContain('data_1');
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

	it('emits separate per-column edges (no `all` bundling) when all outputs feed one target', () => {
		const core = makeCore();
		core.plots.push({ id: 50, type: 'tableplot', plot: { columnRefs: [100, 101] } });
		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const toTable = graph.connections.filter((c) => c.toId === 'plot_50' && c.toPort === 'series');
		// The `all` port + edge-bundling were removed → each output is its own edge.
		expect(toTable.length).toBe(2);
		expect(toTable.every((c) => c.fromId === 'tableprocess_5')).toBe(true);
		expect(toTable.map((c) => c.fromPort).sort()).toEqual(['col_100', 'col_101']);
		expect(toTable.some((c) => c.fromPort === 'all')).toBe(false);
	});

	it('a single output feeding a target is a plain col_ edge', () => {
		const core = makeCore();
		core.plots.push({ id: 51, type: 'tableplot', plot: { columnRefs: [100] } });
		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const toTable = graph.connections.filter((c) => c.toId === 'plot_51' && c.toPort === 'series');
		expect(toTable.length).toBe(1);
		expect(toTable[0].fromPort).toBe('col_100');
	});

	it('a multi-output free process exposes per-column ports and no `all` port or bundle', () => {
		const core = makeCore();
		core.orphanProcesses.push({
			id: 9,
			name: 'Add',
			displayName: 'Add',
			args: { inIN: [1, 100], value: 0 }
		});
		core.data.push(
			{
				id: 200,
				name: 'A → Add',
				producerNodeId: 'process_9',
				producerPort: 'out_1',
				refId: null,
				processes: []
			},
			{
				id: 201,
				name: 'X → Add',
				producerNodeId: 'process_9',
				producerPort: 'out_100',
				refId: null,
				processes: []
			}
		);
		core.plots.push({ id: 60, type: 'tableplot', plot: { columnRefs: [200, 201] } });
		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const proc = graph.nodes.find((n) => n.id === 'process_9');
		expect(proc.ports.outputs.map((p) => p.name)).not.toContain('all');
		const toTable = graph.connections.filter((c) => c.toId === 'plot_60' && c.toPort === 'series');
		// Two separate per-column edges, no `all` bundle.
		expect(toTable.length).toBe(2);
		expect(toTable.some((c) => c.fromPort === 'all')).toBe(false);
	});

	it('a single-output free process has no `all` port', () => {
		const core = makeCore();
		core.orphanProcesses.push({
			id: 8,
			name: 'Add',
			displayName: 'Add',
			args: { inIN: [1], value: 0 }
		});
		core.data.push({
			id: 210,
			name: 'A → Add',
			producerNodeId: 'process_8',
			producerPort: 'out_1',
			refId: null,
			processes: []
		});
		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const proc = graph.nodes.find((n) => n.id === 'process_8');
		expect(proc.ports.outputs.map((p) => p.name)).not.toContain('all');
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
