import { describe, it, expect } from 'vitest';
import {
	binData,
	binOnSharedGrid,
	linearRegression,
	removeNullsFromXY,
	mean,
	min,
	max,
	minMax,
	makeSeqArray
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

describe('binData — uniform mode return shape', () => {
	it('returns binEnds matching bins length', () => {
		const result = binData([0, 1, 2, 3], [0, 1, 2, 3], 2, 0);
		expect(result.binEnds).toHaveLength(result.bins.length);
		// For uniform: binEnds[i] = bins[i] + binSize
		result.bins.forEach((b, i) => expect(result.binEnds[i]).toBeCloseTo(b + 2, 8));
	});

	it('returns droppedCount = 0 when all points fit', () => {
		const result = binData([0, 1, 2, 3], [0, 1, 2, 3], 2, 0);
		expect(result.droppedCount).toBe(0);
	});

	it('counts points below binStart as dropped', () => {
		const result = binData([-2, -1, 0, 1, 2], [1, 1, 1, 1, 1], 1, 0);
		expect(result.droppedCount).toBe(2);
	});
});

describe('binData — count aggregation', () => {
	it('returns row counts and ignores y values', () => {
		// Three points in [0,2): x=0,1,1.5; one point in [2,4): x=3
		const result = binData([0, 1, 1.5, 3], [99, 99, 99, 99], 2, 0, null, 'count');
		expect(result.y_out[0]).toBe(3);
		expect(result.y_out[1]).toBe(1);
	});

	it('count works with x=y for single-column histogramming', () => {
		const values = [0.1, 0.5, 0.9, 1.2, 1.7, 2.5];
		const result = binData(values, values, 1, 0, null, 'count');
		// [0,1): 0.1, 0.5, 0.9 → 3
		// [1,2): 1.2, 1.7 → 2
		// [2,3): 2.5 → 1
		expect(result.y_out[0]).toBe(3);
		expect(result.y_out[1]).toBe(2);
		expect(result.y_out[2]).toBe(1);
	});
});

describe('binData — custom cuts', () => {
	it('produces n-1 bins for n cut edges', () => {
		const result = binData([1, 2, 3, 4], [1, 1, 1, 1], 0, 0, null, 'count', [0, 2, 5]);
		expect(result.bins).toEqual([0, 2]);
		expect(result.binEnds).toEqual([2, 5]);
	});

	it('uses cut edges literally (variable width)', () => {
		const cuts = [0, 1, 2.5, 5, 10];
		// values: 0.5 → [0,1), 2 → [1,2.5), 3,4 → [2.5,5), 6,9,10 → [5,10]
		const x = [0.5, 2, 3, 4, 6, 9, 10];
		const result = binData(x, x, 0, 0, null, 'count', cuts);
		expect(result.y_out).toEqual([1, 1, 2, 3]);
		expect(result.binEnds).toEqual([1, 2.5, 5, 10]);
	});

	it('final bin is right-inclusive on cuts[n-1]', () => {
		// 10 should land in the final bin [5,10], not be dropped
		const result = binData([10], [10], 0, 0, null, 'count', [0, 5, 10]);
		expect(result.y_out[1]).toBe(1);
		expect(result.droppedCount).toBe(0);
	});

	it('non-final bins are half-open on the right', () => {
		// value exactly at an interior edge falls in the higher bin
		const result = binData([2.5], [2.5], 0, 0, null, 'count', [0, 2.5, 5]);
		expect(result.y_out).toEqual([0, 1]);
	});

	it('counts droppedCount for points below first cut and above last cut', () => {
		const result = binData([-1, 0, 5, 11], [1, 1, 1, 1], 0, 0, null, 'count', [0, 5, 10]);
		// 0 → bin 0, 5 → bin 1, -1 dropped (below), 11 dropped (above)
		expect(result.droppedCount).toBe(2);
	});

	it('non-ascending cuts → empty result', () => {
		const result = binData([1, 2, 3], [1, 1, 1], 0, 0, null, 'count', [5, 2, 8]);
		expect(result.bins).toEqual([]);
		expect(result.y_out).toEqual([]);
	});

	it('duplicate cuts (not strictly ascending) → empty result', () => {
		const result = binData([1, 2, 3], [1, 1, 1], 0, 0, null, 'count', [0, 5, 5, 10]);
		expect(result.bins).toEqual([]);
	});

	it('single-bin cuts (length=2) work', () => {
		const result = binData([0, 1, 2], [0, 1, 2], 0, 0, null, 'count', [0, 2]);
		expect(result.bins).toEqual([0]);
		expect(result.binEnds).toEqual([2]);
		expect(result.y_out).toEqual([3]); // 0, 1, 2 all in [0,2]
	});

	it('< 2 cuts falls back to uniform mode (cuts ignored)', () => {
		const result = binData([0, 1, 2], [0, 1, 2], 1, 0, null, 'count', [5]);
		// Should behave like uniform binSize=1
		expect(result.bins[0]).toBe(0);
		expect(result.bins[1]).toBe(1);
	});

	it('mean aggregation with custom cuts', () => {
		// bin [0,2): values 1, 3 → mean=2; bin [2,5): values 4, 6 → mean=5
		const result = binData([0, 1.5, 2, 4], [1, 3, 4, 6], 0, 0, null, 'mean', [0, 2, 5]);
		expect(result.y_out[0]).toBeCloseTo(2, 6);
		expect(result.y_out[1]).toBeCloseTo(5, 6);
	});
});

// A missing value is ABSENCE, not zero. The pair filter used the global `isFinite`, and
// `isFinite(null)` and `isFinite('')` are both TRUE (they coerce to 0), so a null or blank y
// was averaged in as 0 and a null or blank x put its y in the bin at 0. The house rule
// (utils/validPairs.js, utils/stats.js isInvalidValue): a real 0 is data; null, undefined,
// a blank string and NaN are not.
describe('binData — missing values are dropped, not read as 0', () => {
	// Bin [0,3): y 16, 20, 20 -> mean 18.667, min 16. A null y in the bin must change nothing.
	const x = [0, 1, 2, 2.5, 3, 4];
	const y = [16, 20, 20, null, 7, 9];

	it('a null y leaves the bin mean unchanged (was 14, i.e. (16+20+20+0)/4)', () => {
		const r = binData(x, y, 3, 0);
		expect(r.bins.slice(0, 2)).toEqual([0, 3]);
		expect(r.y_out[0]).toBeCloseTo(56 / 3, 12);
		expect(r.y_out[1]).toBeCloseTo(8, 12);
	});

	it('a null y does not become the bin min (was 0)', () => {
		expect(binData(x, y, 3, 0, null, 'min').y_out[0]).toBe(16);
	});

	it('a null y is not counted', () => {
		expect(binData(x, y, 3, 0, null, 'count').y_out.slice(0, 2)).toEqual([3, 2]);
	});

	it('a blank-string y is dropped too', () => {
		const r = binData(x, [16, 20, 20, '', 7, 9], 3, 0);
		expect(r.y_out[0]).toBeCloseTo(56 / 3, 12);
	});

	it('a null or blank x drops its row instead of binning it at 0', () => {
		// Without the fix both rows land in [0,3) as x = 0 and drag the mean to (16+20+20+100+100)/5.
		const r = binData([0, 1, 2, null, '', 4], [16, 20, 20, 100, 100, 9], 3, 0);
		expect(r.y_out[0]).toBeCloseTo(56 / 3, 12);
		expect(
			binData([0, 1, 2, null, '', 4], [16, 20, 20, 100, 100, 9], 3, 0, null, 'count').y_out[0]
		).toBe(3);
	});

	it('a real zero is data', () => {
		const r = binData([0, 1, 2], [0, 0, 6], 3, 0);
		expect(r.y_out[0]).toBeCloseTo(2, 12);
	});

	it('NaN and Infinity are still dropped', () => {
		const r = binData([0, 1, 2, Infinity, 2.5], [16, 20, 20, 5, NaN], 3, 0);
		expect(r.y_out[0]).toBeCloseTo(56 / 3, 12);
	});

	it('cuts mode drops missing values the same way', () => {
		const r = binData(
			[0.5, 1, 1.5, null, 2.5],
			[16, 20, 20, 5, null],
			1,
			0,
			null,
			'mean',
			[0, 2, 3]
		);
		expect(r.y_out[0]).toBeCloseTo(56 / 3, 12);
		expect(r.y_out[1]).toBeNaN();
	});
});

// The Histogram plot counts a single column by passing it as both x and y with 'count'.
describe('binData — a histogram of a column with missing values', () => {
	it('does not count missing values in the bin at 0', () => {
		// Two real zeros and two missing cells. Reading null and '' as 0 gave 4 in [0,1).
		const v = [0, 0, null, '', 1.5, 2.5];
		const r = binData(v, v, 1, 0, null, 'count');
		expect(r.y_out.slice(0, 3)).toEqual([2, 1, 1]);
	});
});

// Import-time binning (ImportData binParsedData) writes every numeric column on ONE grid.
describe('binOnSharedGrid', () => {
	it('pads a column whose trailing cells are missing out to the full grid', () => {
		const t = [0, 1, 2, 3, 4, 5];
		const full = [1, 1, 2, 2, 3, 3];
		const tail = [5, 5, 6, null, null, null];
		const r = binOnSharedGrid(t, [tail, full], 2, 0, 2, 'mean');
		// binData's grid ends with the bin that starts at or past the last x (6 here).
		expect(r.bins).toEqual([0, 2, 4, 6]);
		expect(r.y_outs[1]).toEqual([1, 2, 3, NaN]);
		// On its own, `tail` bins only to x = 2 (two bins); here it is padded to four.
		expect(r.y_outs[0]).toEqual([5, 6, NaN, NaN]);
	});

	it('takes the grid from the valid x alone, not from the first column', () => {
		// First column is entirely missing: the grid must still span every valid time.
		const r = binOnSharedGrid(
			[0, 1, 2, 3],
			[
				[null, null, null, null],
				[1, 2, 3, 4]
			],
			2,
			0,
			2
		);
		expect(r.bins).toEqual([0, 2, 4]);
		expect(r.y_outs[0]).toEqual([NaN, NaN, NaN]);
		expect(r.y_outs[1]).toEqual([1.5, 3.5, NaN]);
	});

	it('matches binData exactly for complete columns', () => {
		const t = Array.from({ length: 50 }, (_, i) => i * 0.25);
		const y = t.map((h) => Math.sin(h));
		const r = binOnSharedGrid(t, [y], 1, 0, 1, 'mean');
		const b = binData(t, y, 1, 0, 1, 'mean');
		expect(r.bins).toEqual(b.bins);
		expect(r.y_outs[0]).toEqual(b.y_out);
	});
});

// ─── makeSeqArray ────────────────────────────────────────────────────────────

describe('makeSeqArray', () => {
	it('counts from `from` to `to` inclusive', () => {
		expect(makeSeqArray(0, 3, 1)).toEqual([0, 1, 2, 3]);
		expect(makeSeqArray(5, 0, 1)).toEqual([]);
	});

	// ROB-24: a zero, negative or NaN step used to loop forever (i += 0 never reaches
	// `to`), and so did a non-finite `to`. Both now give an empty sequence.
	it.each([0, -1, NaN, null, undefined])('returns [] for step %s', (step) => {
		expect(makeSeqArray(0, 5, step)).toEqual([]);
	});

	it.each([
		[0, Infinity],
		[-Infinity, 0],
		[0, NaN]
	])('returns [] for a non-finite range %s..%s', (from, to) => {
		expect(makeSeqArray(from, to, 1)).toEqual([]);
	});
});
