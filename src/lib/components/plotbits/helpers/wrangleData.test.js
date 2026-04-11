import { describe, it, expect } from 'vitest';
import {
	binData,
	linearRegression,
	removeNullsFromXY,
	mean,
	min,
	max,
	minMax
} from './wrangleData.js';

// ─── mean / min / max / minMax ───────────────────────────────────────────────

describe('mean', () => {
	it('computes simple mean', () => {
		expect(mean([1, 2, 3, 4, 5])).toBeCloseTo(3, 10);
	});

	it('skips NaN and undefined', () => {
		expect(mean([1, NaN, 3, undefined, 5])).toBeCloseTo(3, 10);
	});

	it('returns 0 for empty array', () => {
		expect(mean([])).toBe(0);
	});

	it('returns 0 for all-NaN array', () => {
		expect(mean([NaN, NaN])).toBe(0);
	});
});

describe('min', () => {
	it('returns smallest value', () => {
		expect(min([3, 1, 4, 1, 5])).toBe(1);
	});

	it('skips NaN and undefined', () => {
		expect(min([5, NaN, 2, undefined])).toBe(2);
	});

	it('returns null for empty array', () => {
		expect(min([])).toBeNull();
	});
});

describe('max', () => {
	it('returns largest value', () => {
		expect(max([3, 1, 4, 1, 5])).toBe(5);
	});

	it('skips NaN and undefined', () => {
		expect(max([1, NaN, 9, undefined])).toBe(9);
	});

	it('returns null for empty array', () => {
		expect(max([])).toBeNull();
	});
});

describe('minMax', () => {
	it('returns both min and max', () => {
		const result = minMax([3, 1, 4, 1, 5, 9, 2, 6]);
		expect(result.min).toBe(1);
		expect(result.max).toBe(9);
	});

	it('handles single element', () => {
		expect(minMax([7])).toEqual({ min: 7, max: 7 });
	});

	it('returns nulls for empty array', () => {
		expect(minMax([])).toEqual({ min: null, max: null });
	});

	it('skips NaN values', () => {
		const result = minMax([2, NaN, 8]);
		expect(result.min).toBe(2);
		expect(result.max).toBe(8);
	});
});

// ─── removeNullsFromXY ───────────────────────────────────────────────────────

describe('removeNullsFromXY', () => {
	it('removes pairs where either value is null', () => {
		const [x, y] = removeNullsFromXY([1, null, 3], [4, 5, null]);
		expect(x).toEqual([1]);
		expect(y).toEqual([4]);
	});

	it('removes pairs where either value is NaN', () => {
		const [x, y] = removeNullsFromXY([1, NaN, 3], [4, 5, 6]);
		expect(x).toEqual([1, 3]);
		expect(y).toEqual([4, 6]);
	});

	it('returns empty arrays when all pairs are invalid', () => {
		const [x, y] = removeNullsFromXY([null, NaN], [1, 2]);
		expect(x).toEqual([]);
		expect(y).toEqual([]);
	});

	it('passes through clean data unchanged', () => {
		const [x, y] = removeNullsFromXY([1, 2, 3], [4, 5, 6]);
		expect(x).toEqual([1, 2, 3]);
		expect(y).toEqual([4, 5, 6]);
	});
});

// ─── linearRegression ────────────────────────────────────────────────────────

describe('linearRegression', () => {
	it('recovers exact slope and intercept for perfect line', () => {
		const x = [0, 1, 2, 3, 4];
		const y = x.map((xi) => 3 * xi + 2); // slope=3, intercept=2
		const result = linearRegression(x, y);
		expect(result.slope).toBeCloseTo(3, 8);
		expect(result.intercept).toBeCloseTo(2, 8);
	});

	it('returns R² = 1 for perfect linear data', () => {
		const x = [1, 2, 3, 4, 5];
		const y = x.map((xi) => -0.5 * xi + 10);
		expect(linearRegression(x, y).rSquared).toBeCloseTo(1, 8);
	});

	it('returns R² near 0 for uncorrelated data', () => {
		const x = [1, 2, 3, 4, 5];
		const y = [3, 1, 4, 1, 5]; // essentially random
		const result = linearRegression(x, y);
		expect(result.rSquared).toBeLessThan(0.5);
	});

	it('throws for arrays of different length', () => {
		expect(() => linearRegression([1, 2], [3])).toThrow();
	});

	it('throws for empty arrays', () => {
		expect(() => linearRegression([], [])).toThrow();
	});

	it('computes RMSE correctly for perfect fit', () => {
		const x = [0, 1, 2, 3];
		const y = x.map((xi) => 2 * xi);
		expect(linearRegression(x, y).rmse).toBeCloseTo(0, 8);
	});
});

// ─── binData ─────────────────────────────────────────────────────────────────

describe('binData — basic behaviour', () => {
	it('returns empty for empty input', () => {
		const result = binData([], [], 1, 0);
		expect(result.bins).toEqual([]);
		expect(result.y_out).toEqual([]);
	});

	it('bins equal-spaced data correctly (mean)', () => {
		// x = [0,1,2,3], y = [0,1,2,3], binSize=2, binStart=0
		// bin [0,2) → values 0,1 → mean=0.5
		// bin [2,4) → values 2,3 → mean=2.5
		// binData appends one trailing empty bin after the last data point
		const result = binData([0, 1, 2, 3], [0, 1, 2, 3], 2, 0);
		expect(result.y_out[0]).toBeCloseTo(0.5, 8);
		expect(result.y_out[1]).toBeCloseTo(2.5, 8);
		expect(result.bins[0]).toBe(0);
		expect(result.bins[1]).toBe(2);
	});

	it('produces bins array matching y_out length', () => {
		const x = Array.from({ length: 48 }, (_, i) => i * 0.5);
		const y = x.map((xi) => Math.sin(xi));
		const result = binData(x, y, 1, 0);
		expect(result.bins).toHaveLength(result.y_out.length);
	});

	it('handles unsorted input (sorts internally)', () => {
		const result = binData([3, 1, 2, 0], [30, 10, 20, 0], 2, 0);
		// Same as sorted input [0,1,2,3] → y [0,10,20,30]
		expect(result.y_out[0]).toBeCloseTo(5, 6); // mean(0,10)
		expect(result.y_out[1]).toBeCloseTo(25, 6); // mean(20,30)
	});
});

describe('binData — aggregation functions', () => {
	// x values end exactly on a bin boundary so there is no trailing empty bin
	const x = [0, 1, 2, 3, 4];
	const y = [1, 3, 2, 8, 4];

	it('mean aggregation', () => {
		const result = binData(x, y, 3, 0, null, 'mean');
		// bin [0,3): [1,3,2] → mean=2
		expect(result.y_out[0]).toBeCloseTo(2, 6);
	});

	it('min aggregation', () => {
		const result = binData(x, y, 3, 0, null, 'min');
		// bin [0,3): min of [1,3,2] = 1
		expect(result.y_out[0]).toBe(1);
	});

	it('max aggregation', () => {
		const result = binData(x, y, 3, 0, null, 'max');
		// bin [0,3): max of [1,3,2] = 3
		expect(result.y_out[0]).toBe(3);
	});

	it('median aggregation', () => {
		const result = binData(x, y, 3, 0, null, 'median');
		// bin [0,3): [1,2,3] sorted → median=2
		expect(result.y_out[0]).toBeCloseTo(2, 6);
	});

	it('stddev aggregation — single element → 0', () => {
		const result = binData([0], [5], 1, 0, null, 'stddev');
		expect(result.y_out[0]).toBe(0);
	});

	it('falls back to mean for unknown aggregation type', () => {
		const resultMean = binData(x, y, 3, 0, null, 'mean');
		const resultUnknown = binData(x, y, 3, 0, null, 'bogus');
		expect(resultUnknown.y_out[0]).toBeCloseTo(resultMean.y_out[0], 6);
	});
});

describe('binData — step size', () => {
	it('overlapping bins when stepSize < binSize', () => {
		const x = Array.from({ length: 10 }, (_, i) => i);
		const y = x.map(() => 1);
		const sliding = binData(x, y, 3, 0, 1, 'mean'); // bin=3, step=1
		// Should have more bins than non-sliding
		const fixed = binData(x, y, 3, 0, null, 'mean');
		expect(sliding.bins.length).toBeGreaterThan(fixed.bins.length);
	});
});
