import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: { set: vi.fn() } } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));

import { crosscorrelation } from './CrossCorrelation.svelte';

const X = [0, 1, 2, 1, 0, -1, -2, -1, 0, 1, 2, 1, 0, -1, -2, -1, 0, 1, 2, 1];
const Y = [2, 1, 0, 1, 2, 1, 0, -1, -2, -1, 0, 1, 2, 1, 0, -1, -2, -1, 0, 1];

const args = (over) => ({ xIN: 1, yIN: 2, maxLag: 4, method: 'pearson', out: { lag: -1, correlation: -1, pvalue: -1 }, ...over });

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mockColumns[1] = { name: 'A', getData: () => X };
	mockColumns[2] = { name: 'B', getData: () => Y };
});

describe('crosscorrelation', () => {
	it('is invalid without both inputs wired', () => {
		expect(crosscorrelation(args({ yIN: -1 }))[1]).toBe(false);
		expect(crosscorrelation(args({ xIN: -1 }))[1]).toBe(false);
	});

	it('emits the correlogram and finds the peak lag', () => {
		const [r, valid] = crosscorrelation(args());
		expect(valid).toBe(true);
		expect(r.lag).toEqual([-4, -3, -2, -1, 0, 1, 2, 3, 4]);
		expect(r.peakLag).toBe(2);
		expect(r.peakR).toBeCloseTo(1, 6);
		expect(r.correlation).toHaveLength(9);
	});

	it('names which series leads', () => {
		const [r] = crosscorrelation(args());
		expect(r.aName).toBe('A');
		expect(r.bName).toBe('B');
	});

	it('honours maxLag=0 as auto', () => {
		const [r] = crosscorrelation(args({ maxLag: 0 }));
		expect(Math.max(...r.lag)).toBe(5); // n=20 → quarter = 5
	});
});
