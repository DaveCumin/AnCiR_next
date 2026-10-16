import { describe, it, expect } from 'vitest';
import { rowHeight, rowGeometry } from './rowHeight.js';

describe('rowHeight', () => {
	it('shares the plot height between rows and gaps', () => {
		expect(rowHeight(118, 10, 2)).toBe(10);
	});

	it('is 0, not Infinity, while there are no rows yet', () => {
		expect(rowHeight(400, 0, 2)).toBe(0);
	});

	it('is never negative or non-finite', () => {
		expect(rowHeight(10, 20, 2)).toBe(0);
		expect(rowHeight(NaN, 5, 2)).toBe(0);
		expect(rowHeight(400, undefined, 2)).toBe(0);
	});
});

describe('rowGeometry: rows never vanish under their gaps', () => {
	it('keeps the user gap while rows get at least 1 px (unchanged picture)', () => {
		expect(rowGeometry(118, 10, 2)).toEqual({ gap: 2, height: 10 });
		expect(rowGeometry(598, 200, 2)).toEqual({ gap: 2, height: 1 });
	});
	it('two years in a 600 px plot: the gap shrinks so each row keeps 1 px (was 0 px, blank)', () => {
		expect(rowHeight(600, 730, 2)).toBe(0);
		const g = rowGeometry(600, 730, 2);
		expect(g.gap).toBe(0);
		expect(g.height).toBeCloseTo(600 / 730, 12);
		const g2 = rowGeometry(600, 400, 2);
		expect(g2.height).toBeCloseTo(1, 12);
		expect(g2.gap).toBeCloseTo(200 / 399, 12);
		// Rows and gaps still fill exactly the plot height.
		expect(400 * g2.height + 399 * g2.gap).toBeCloseTo(600, 9);
	});
	it('fewer than 1 px per row: no gap, the rows share the height', () => {
		expect(rowGeometry(600, 20_000, 2)).toEqual({ gap: 0, height: 0.03 });
	});
	it('no rows, or no height: as rowHeight', () => {
		expect(rowGeometry(400, 0, 2)).toEqual({ gap: 2, height: 0 });
		expect(rowGeometry(0, 10, 2)).toEqual({ gap: 2, height: 0 });
	});
});
