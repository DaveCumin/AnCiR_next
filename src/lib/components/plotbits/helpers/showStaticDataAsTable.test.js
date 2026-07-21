import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture what the "View stats" button hands to the plot layer, without constructing a real Plot.
const added = [];
vi.mock('$lib/core/mutationService.js', () => ({
	mutationService: {
		addPlot: (spec) => {
			added.push(spec);
			return { plot: {} };
		}
	}
}));

import { showStaticDataAsTable } from './save.svelte.js';
import { core } from '$lib/core/core.svelte.js';

beforeEach(() => {
	added.length = 0;
	core.nodeLayout = { tableprocess_5: { x: 440, y: 314 } };
});

describe('showStaticDataAsTable placement', () => {
	it('places the stats table next to its source node, not at a fixed off-screen corner', () => {
		// Regression: the table used to spawn at a hard-coded (80,80) — usually off-screen or
		// behind other content — so "View stats" looked like it did nothing.
		showStaticDataAsTable('Trend fit stats', ['column', 'r2'], [['y', 0.9]], null, 'tableprocess_5');
		expect(added).toHaveLength(1);
		expect(added[0].x).toBe(440 + 360);
		expect(added[0].y).toBe(314 + 40);
		expect(added[0].sourceNodeId).toBe('tableprocess_5');
		expect(added[0].type).toBe('dataview');
		expect(added[0].plot.staticRows).toEqual([['y', 0.9]]);
	});

	it('falls back to (80,80) when no source node id is supplied', () => {
		showStaticDataAsTable('T', ['a'], [[1]]);
		expect(added[0].x).toBe(80);
		expect(added[0].y).toBe(80);
	});

	it('falls back to (80,80) when the source node has no layout entry yet', () => {
		showStaticDataAsTable('T', ['a'], [[1]], null, 'tableprocess_999');
		expect(added[0].x).toBe(80);
		expect(added[0].y).toBe(80);
	});

	it('does nothing for empty headers or rows', () => {
		showStaticDataAsTable('T', [], [], null, 'tableprocess_5');
		showStaticDataAsTable('T', ['a'], [], null, 'tableprocess_5');
		expect(added).toHaveLength(0);
	});
});
