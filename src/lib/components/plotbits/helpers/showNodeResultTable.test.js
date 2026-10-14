import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture what the "View stats" button hands to the plot layer, without constructing a real Plot.
const added = [];
vi.mock('$lib/core/mutationService.js', () => ({
	mutationService: {
		addPlot: (spec) => {
			added.push(spec);
			return { id: 99, ...spec, plot: spec.plot };
		}
	}
}));

import { showNodeResultTable } from './save.svelte.js';
import { core, appState } from '$lib/core/core.svelte.js';

const stats = () => ({ headers: ['column', 'r2'], rows: [['y', 0.9]] });

beforeEach(() => {
	added.length = 0;
	core.plots.length = 0;
	core.nodeLayout = { tableprocess_5: { x: 440, y: 314 } };
	appState.focusNodeRequest = null;
});

describe('showNodeResultTable', () => {
	it('spawns a Node-results Table linked to the node, seeded with the current rows', () => {
		const p = showNodeResultTable({
			sourceNodeId: 'tableprocess_5',
			resultKey: 'stats',
			title: 'Trend fit stats',
			get: stats
		});
		expect(added).toHaveLength(1);
		expect(added[0].type).toBe('tableplot');
		expect(added[0].name).toBe('Trend fit stats');
		expect(added[0].sourceNodeId).toBe('tableprocess_5');
		expect(added[0].plot).toEqual({
			source: 'node',
			resultKey: 'stats',
			snapshot: stats()
		});
		expect(p).toBeTruthy();
	});

	it('places the table next to its source node, not at a fixed off-screen corner', () => {
		// Regression: the table used to spawn at a hard-coded (80,80), usually off-screen or
		// behind other content, so "View stats" looked like it did nothing.
		showNodeResultTable({
			sourceNodeId: 'tableprocess_5',
			resultKey: 'stats',
			title: 'T',
			get: stats
		});
		expect(added[0].x).toBe(440 + 360);
		expect(added[0].y).toBe(314 + 40);
	});

	it('falls back to (80,80) when the source node has no layout entry yet', () => {
		showNodeResultTable({
			sourceNodeId: 'tableprocess_999',
			resultKey: 'stats',
			title: 'T',
			get: stats
		});
		expect(added[0].x).toBe(80);
		expect(added[0].y).toBe(80);
	});

	it('does nothing for empty headers or rows, or without a node or key', () => {
		const empty = () => ({ headers: [], rows: [] });
		const noRows = () => ({ headers: ['a'], rows: [] });
		showNodeResultTable({
			sourceNodeId: 'tableprocess_5',
			resultKey: 'stats',
			title: 'T',
			get: empty
		});
		showNodeResultTable({
			sourceNodeId: 'tableprocess_5',
			resultKey: 'stats',
			title: 'T',
			get: noRows
		});
		showNodeResultTable({ sourceNodeId: null, resultKey: 'stats', title: 'T', get: stats });
		showNodeResultTable({
			sourceNodeId: 'tableprocess_5',
			resultKey: null,
			title: 'T',
			get: stats
		});
		expect(added).toHaveLength(0);
	});

	it('focuses the existing Table for the same node and table instead of spawning a duplicate', () => {
		const existing = {
			id: 12,
			type: 'tableplot',
			sourceNodeId: 'tableprocess_5',
			plot: { source: 'node', resultKey: 'permutations' }
		};
		core.plots.push(existing);
		const p = showNodeResultTable({
			sourceNodeId: 'tableprocess_5',
			resultKey: 'permutations',
			title: 'Cosinor: permutations',
			get: stats
		});
		expect(p.id).toBe(existing.id);
		expect(added).toHaveLength(0);
		expect(appState.focusNodeRequest?.id).toBe('plot_12');
	});

	it('a different table of the same node, or a quick plot of it, is not a duplicate', () => {
		core.plots.push(
			{
				id: 12,
				type: 'tableplot',
				sourceNodeId: 'tableprocess_5',
				plot: { source: 'node', resultKey: 'permutations' }
			},
			{ id: 13, type: 'scatterplot', sourceNodeId: 'tableprocess_5', plot: {} }
		);
		showNodeResultTable({
			sourceNodeId: 'tableprocess_5',
			resultKey: 'stats',
			title: 'T',
			get: stats
		});
		expect(added).toHaveLength(1);
	});
});
