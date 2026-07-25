import { describe, it, expect } from 'vitest';
import {
	layoutWorkspacePlots,
	plotSizeFor,
	facetFootprint,
	PLOT_CHROME
} from './workspaceLayout.js';

const mk = (id, type, extra = {}) => ({ id, type, facetParent: null, ...extra });

/**
 * Overlap is judged on the RENDERED box, not the plot's own width/height: Draggable adds side
 * chrome and a header bar, and laying out on the bare numbers is exactly what left rows
 * overlapping by the header's height on screen while looking fine in the data.
 */
const overlaps = (a, b) => {
	const aw = a.width + PLOT_CHROME.x;
	const ah = a.height + PLOT_CHROME.y;
	const bw = b.width + PLOT_CHROME.x;
	const bh = b.height + PLOT_CHROME.y;
	return a.x < b.x + bw && b.x < a.x + aw && a.y < b.y + bh && b.y < a.y + ah;
};

describe('plotSizeFor', () => {
	it('gives matrices and polar plots a squarer box than a table', () => {
		expect(plotSizeFor('pairsplot').height).toBeGreaterThan(plotSizeFor('tableplot').height);
		expect(plotSizeFor('circularphase').width).toBe(plotSizeFor('circularphase').height);
	});

	it('falls back to a usable default for an unknown type', () => {
		const s = plotSizeFor('something-new');
		expect(s.width).toBeGreaterThan(0);
		expect(s.height).toBeGreaterThan(0);
	});
});

describe('facetFootprint', () => {
	it('is the plot plus its chrome when nothing is faceted', () => {
		expect(facetFootprint({ width: 500, height: 250 }, 0)).toEqual({
			width: 500 + PLOT_CHROME.x,
			height: 250 + PLOT_CHROME.y
		});
	});

	it('reserves the child grid below the generator', () => {
		// 4 children → 2x2 grid under the parent, so roughly three plot-heights tall.
		const f = facetFootprint({ width: 500, height: 250 }, 4, 15);
		expect(f.height).toBeGreaterThan(250 * 3);
		expect(f.width).toBeGreaterThan(500);
	});
});

describe('layoutWorkspacePlots', () => {
	it('does not leave every plot stacked at one position', () => {
		const plots = [mk(1, 'histogram'), mk(2, 'tableplot'), mk(3, 'pairsplot')];
		layoutWorkspacePlots(plots);
		const seen = new Set(plots.map((p) => `${p.x},${p.y}`));
		expect(seen.size).toBe(plots.length);
	});

	it('leaves no two top-level plots overlapping', () => {
		const plots = [
			mk(1, 'histogram'),
			mk(2, 'correlationheatmap'),
			mk(3, 'pairsplot'),
			mk(4, 'tableplot'),
			mk(5, 'tableplot'),
			mk(6, 'actogram')
		];
		layoutWorkspacePlots(plots);
		for (let i = 0; i < plots.length; i++)
			for (let j = i + 1; j < plots.length; j++)
				expect(overlaps(plots[i], plots[j])).toBe(false);
	});

	it('reserves room under a faceted plot so its children do not land on the next plot', () => {
		const plots = [mk(1, 'histogram', { facet: true }), mk(2, 'tableplot')];
		layoutWorkspacePlots(plots, { columns: 1, facetChildCounts: { 1: 4 } });
		const foot = facetFootprint(plotSizeFor('histogram'), 4);
		expect(plots[1].y).toBeGreaterThanOrEqual(plots[0].y + foot.height);
	});

	it('skips facet children, which are positioned by their parent at runtime', () => {
		const child = { id: 9, type: 'histogram', facetParent: 1, x: 111, y: 222 };
		const plots = [mk(1, 'histogram'), child];
		layoutWorkspacePlots(plots);
		expect(child.x).toBe(111);
		expect(child.y).toBe(222);
	});

	it('packs the shortest column first, so a tall plot does not strand a gap', () => {
		// Tall first, then two shorts: both shorts should stack in the other column.
		const plots = [mk(1, 'pairsplot'), mk(2, 'tableplot'), mk(3, 'tableplot')];
		layoutWorkspacePlots(plots, { columns: 2 });
		expect(plots[1].x).not.toBe(plots[0].x);
		expect(plots[2].x).toBe(plots[1].x);
		expect(plots[2].y).toBeGreaterThan(plots[1].y);
	});

	it('reserves enough room that a facet child grid clears the next plot', () => {
		// Regression: the reservation used bare plot heights, so the last child row ran 15px into
		// the plot packed beneath it — invisible in the numbers, obvious on screen.
		const size = plotSizeFor('histogram');
		const childCount = 4;
		const padding = 15;
		const plots = [mk(1, 'histogram', { facet: true }), mk(2, 'tableplot')];
		layoutWorkspacePlots(plots, { columns: 1, padding, facetChildCounts: { 1: childCount } });

		// Bottom of the lowest child, laid out the way syncFacetChildren does it.
		const cols = Math.ceil(Math.sqrt(childCount));
		const rows = Math.ceil(childCount / cols);
		const stepY = size.height + PLOT_CHROME.y + padding;
		const lastChildTop =
			plots[0].y + size.height + PLOT_CHROME.y + 2 * padding + (rows - 1) * stepY;
		const lastChildBottom = lastChildTop + size.height + PLOT_CHROME.y;

		expect(plots[1].y).toBeGreaterThanOrEqual(lastChildBottom);
	});

	it('is a no-op on an empty session', () => {
		expect(() => layoutWorkspacePlots([])).not.toThrow();
		expect(() => layoutWorkspacePlots(undefined)).not.toThrow();
	});
});
