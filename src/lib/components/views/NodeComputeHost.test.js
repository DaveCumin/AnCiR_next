// @ts-nocheck
import { describe, it, expect } from 'vitest';
import NodeComputeHost, { selectComputeNodes } from './NodeComputeHost.svelte';

// Regression guard for the workspace-view reactivity bug: in the plots view only
// the *selected* node mounts (via CanvasNodeControls), so downstream computed
// nodes never re-run and plots read stale columns. NodeComputeHost fixes this by
// mounting every compute node headlessly. If this predicate ever stops including
// table-processes or free processes, that staleness returns — hence this test.
describe('NodeComputeHost.selectComputeNodes', () => {
	const graph = [
		{ id: 'tableprocess_0', type: 'tableprocess' },
		{ id: 'process_0', type: 'process' },
		{ id: 'data_1', type: 'data' },
		{ id: 'plot_0', type: 'plot' },
		{ id: 'group_0', type: 'group' },
		{ id: 'note_0', type: 'note' },
		{ id: 'composite_0', type: 'composite' }
	];

	it('keeps exactly the nodes that own a compute effect (tableprocess + process)', () => {
		expect(selectComputeNodes(graph).map((n) => n.id)).toEqual(['tableprocess_0', 'process_0']);
	});

	it('excludes data, plot, group, note and composite nodes', () => {
		const kept = new Set(selectComputeNodes(graph).map((n) => n.type));
		for (const t of ['data', 'plot', 'group', 'note', 'composite']) expect(kept.has(t)).toBe(false);
	});

	it('tolerates missing / empty input', () => {
		expect(selectComputeNodes(undefined)).toEqual([]);
		expect(selectComputeNodes([])).toEqual([]);
		expect(selectComputeNodes([null, {}])).toEqual([]);
	});

	it('exports a component', () => {
		expect(NodeComputeHost).toBeDefined();
	});
});
