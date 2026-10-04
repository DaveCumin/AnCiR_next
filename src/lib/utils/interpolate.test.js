import { describe, it, expect } from 'vitest';
import { knownPoints, makeInterpolator, interpolate, makeGrid } from './interpolate.js';

describe('knownPoints', () => {
	it('keeps only finite (x,y) pairs, sorted by x', () => {
		const { xs, ys } = knownPoints([2, 0, 1, 3], [20, 0, NaN, 30]);
		// x=1 dropped (y NaN); sorted → x 0,2,3
		expect(xs).toEqual([0, 2, 3]);
		expect(ys).toEqual([0, 20, 30]);
	});
	it('dedupes on x (later wins)', () => {
		const { xs, ys } = knownPoints([1, 1, 2], [10, 11, 20]);
		expect(xs).toEqual([1, 2]);
		expect(ys).toEqual([11, 20]);
	});
});

describe('makeInterpolator — linear', () => {
	const f = makeInterpolator([0, 10], [0, 100], 'linear');
	it('interpolates between points', () => {
		expect(f(0)).toBe(0);
		expect(f(5)).toBe(50);
		expect(f(10)).toBe(100);
		expect(f(2.5)).toBe(25);
	});
	it('does not extrapolate: out-of-range is missing (NaN), as in the Python and R ports', () => {
		expect(f(-5)).toBeNaN();
		expect(f(999)).toBeNaN();
		expect(f(NaN)).toBeNaN();
	});
});

describe('makeInterpolator — nearest', () => {
	const f = makeInterpolator([0, 10], [1, 2], 'nearest');
	it('snaps to the nearest known x', () => {
		expect(f(1)).toBe(1);
		expect(f(9)).toBe(2);
		expect(f(4)).toBe(1); // 4 closer to 0
		expect(f(6)).toBe(2); // 6 closer to 10
	});
});

describe('makeInterpolator — spline', () => {
	it('passes through the knots exactly', () => {
		const xs = [0, 1, 2, 3];
		const ys = [0, 1, 4, 9]; // y = x^2 samples
		const f = makeInterpolator(xs, ys, 'spline');
		for (let i = 0; i < xs.length; i++) expect(f(xs[i])).toBeCloseTo(ys[i], 10);
	});
	it('approximates a smooth function between knots better than linear', () => {
		// Samples of y = x^2; at x=1.5 the true value is 2.25. Linear gives 2.5.
		const xs = [0, 1, 2, 3];
		const ys = [0, 1, 4, 9];
		const spline = makeInterpolator(xs, ys, 'spline')(1.5);
		const linear = makeInterpolator(xs, ys, 'linear')(1.5);
		expect(Math.abs(spline - 2.25)).toBeLessThan(Math.abs(linear - 2.25));
	});
});

describe('makeInterpolator — degenerate', () => {
	it('0 points → NaN', () => {
		expect(makeInterpolator([], [], 'linear')(5)).toBeNaN();
	});
	it('1 point → its value at that x only, missing elsewhere (no extrapolation)', () => {
		const f = makeInterpolator([3], [7], 'spline');
		expect(f(3)).toBe(7);
		expect(f(0)).toBeNaN();
		expect(f(100)).toBeNaN();
	});
});

describe('interpolate (fill-gaps use)', () => {
	it('fills NaN y at the original x from surrounding finite points', () => {
		const x = [0, 1, 2, 3, 4];
		const y = [0, NaN, 20, NaN, 40];
		// query at the same x → gaps filled linearly
		expect(interpolate(x, y, x, 'linear')).toEqual([0, 10, 20, 30, 40]);
	});
});

describe('makeGrid', () => {
	it('builds an inclusive evenly-spaced grid', () => {
		expect(makeGrid(0, 4, 2)).toEqual([0, 2, 4]);
		expect(makeGrid(0, 1, 0.25)).toEqual([0, 0.25, 0.5, 0.75, 1]);
	});
	it('rejects bad params', () => {
		expect(makeGrid(0, 4, 0)).toEqual([]);
		expect(makeGrid(4, 0, 1)).toEqual([]);
		expect(makeGrid(0, 1e12, 1e-6)).toEqual([]); // runaway size guarded
	});
});

// STAT-3: knownPoints converted with Number() and then checked finiteness, and Number(null),
// Number('') and Number(' ') are all 0, so a missing y became a known point of value 0 and a
// missing x a known point at x = 0. Reviewer's exact inputs.
describe('interpolate with missing values (STAT-3)', () => {
	it('a missing y is not a known point: interpolate([0,1,2,3],[1,null,3,4],[1]) is 2', () => {
		expect(interpolate([0, 1, 2, 3], [1, null, 3, 4], [1])).toEqual([2]);
	});

	it('a missing x is not a known point at 0: interpolate([0,null,2,3],[1,50,3,4],[0.5]) is 1.5', () => {
		// Known points (0,1), (2,3), (3,4): linear at 0.5 is 1.5. (The reviewer's "correct 2"
		// was for the query x = 1; at 0.5 the line through (0,1) and (2,3) gives 1.5.)
		expect(interpolate([0, null, 2, 3], [1, 50, 3, 4], [0.5])).toEqual([1.5]);
	});

	for (const blank of ['', ' ', undefined, NaN, 'n/a']) {
		it(`a ${JSON.stringify(blank)} y or x is dropped, for every method`, () => {
			for (const method of ['linear', 'nearest', 'spline']) {
				expect(interpolate([0, 1, 2, 3], [1, blank, 3, 4], [1], method)[0]).toBeCloseTo(
					method === 'nearest' ? 1 : 2,
					12
				);
				expect(knownPoints([0, blank, 2, 3], [1, 50, 3, 4]).xs).toEqual([0, 2, 3]);
			}
		});
	}

	it('a real 0 is data', () => {
		expect(knownPoints([0, 1, 2], [0, 0, 6])).toEqual({ xs: [0, 1, 2], ys: [0, 0, 6] });
		expect(interpolate([0, 2], [0, 6], [1])).toEqual([3]);
	});

	it('numeric strings are read as numbers', () => {
		expect(interpolate(['0', '2'], ['0', '6'], ['1'])).toEqual([3]);
	});

	it('a missing query is missing, not x = 0', () => {
		expect(interpolate([0, 2], [10, 30], [null, '', 1])).toEqual([NaN, NaN, 20]);
	});
});
