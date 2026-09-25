import { describe, it, expect } from 'vitest';
import { rowHeight } from './rowHeight.js';

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
