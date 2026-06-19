// src/lib/core/producerGraph.test.js
// @ts-nocheck
//
// Phase 2 (canvas authoring) adapter wiring for the dataflow model. A free
// process node (core.orphanProcesses) declares its input column via args.inIN and
// feeds a producer column (producerNodeId). The graph must:
//   - hide the producer column as a standalone data node,
//   - wire the free process's input from its source column,
//   - route downstream consumers of the producer column to the node's output.
import { describe, it, expect, beforeEach } from 'vitest';
import { getCachedProcessNodeGraph, clearProcessNodeGraphCache } from './ProcessNode.svelte.js';

function makeAppConsts() {
	return {
		processMap: new Map(), // entry undefined → default 1-in/1-out port spec
		tableProcessMap: new Map(),
		plotMap: new Map([['scatter', { defaultInputs: ['x', 'y'] }]])
	};
}

// Source column A (id 1) → free Add node (process_7, inIN: 1) → producer column
// (id 2). A scatter plot reads A on x and the producer column on y.
function makeCore() {
	return {
		data: [
			{ id: 1, name: 'A', refId: null, data: 1, processes: [] },
			{
				id: 2,
				name: 'A → Add',
				refId: null,
				data: null,
				producerNodeId: 'process_7',
				producerPort: 'output',
				processes: []
			}
		],
		orphanProcesses: [{ id: 7, name: 'Add', displayName: 'Add', args: { inIN: 1, value: 5 } }],
		tableProcesses: [],
		plots: [{ id: 3, type: 'scatter', plot: { data: [{ x: { refId: 1 }, y: { refId: 2 } }] } }],
		notes: [],
		groups: []
	};
}

beforeEach(() => clearProcessNodeGraphCache());

describe('Phase 2: free process + producer column wiring', () => {
	it('hides the producer column as a standalone data node', () => {
		const graph = getCachedProcessNodeGraph(makeCore(), makeAppConsts());
		const ids = graph.nodes.map((n) => n.id);
		expect(ids).not.toContain('data_2'); // producer column is model-only
		expect(ids).toContain('data_1'); // the real source still gets a node
		expect(ids).toContain('process_7'); // the free process node
	});

	it('wires the free process input from its source column (args.inIN)', () => {
		const graph = getCachedProcessNodeGraph(makeCore(), makeAppConsts());
		const edge = graph.connections.find(
			(c) => c.toId === 'process_7' && c.toPort === 'input'
		);
		expect(edge).toBeTruthy();
		expect(edge.fromId).toBe('data_1');
		expect(edge.fromPort).toBe('column');
	});

	it('routes a downstream consumer of the producer column to the node output', () => {
		const graph = getCachedProcessNodeGraph(makeCore(), makeAppConsts());
		// The plot's y references the producer column (id 2); its wire must come
		// from process_7.output, not a data_2 node.
		const edge = graph.connections.find(
			(c) => c.toId === 'plot_3' && c.fromId === 'process_7'
		);
		expect(edge).toBeTruthy();
		expect(edge.fromPort).toBe('output');
	});
});
