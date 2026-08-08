import { describe, it, expect } from 'vitest';
import { violinCurve, violinOutline, VIOLIN_MIN_N } from './violin.js';

const sample = [1, 2, 2.5, 3, 3.5, 4, 4.2, 5, 6, 7];

describe('violinCurve', () => {
	it('gates on the minimum n (default 5)', () => {
		expect(VIOLIN_MIN_N).toBe(5);
		expect(violinCurve([1, 2, 3, 4])).toBeNull();
		expect(violinCurve([1, 2, 3, 4, 5])).not.toBeNull();
	});

	it('returns null for all-equal values (sigma 0, no density estimate)', () => {
		expect(violinCurve([3, 3, 3, 3, 3, 3])).toBeNull();
	});

	it('returns null for empty/garbage input', () => {
		expect(violinCurve([])).toBeNull();
		expect(violinCurve(null)).toBeNull();
		expect(violinCurve([null, NaN, Infinity, null, null, null])).toBeNull();
	});

	it('ignores null/NaN when counting towards the gate', () => {
		// 4 valid values padded with nulls must still be gated
		expect(violinCurve([1, 2, 3, 4, null, null])).toBeNull();
	});

	it('trims the curve to the data range with exact endpoints', () => {
		const curve = violinCurve(sample);
		expect(curve).not.toBeNull();
		const vs = curve.points.map((p) => p.v);
		expect(Math.min(...vs)).toBe(1);
		expect(Math.max(...vs)).toBe(7);
		// strictly inside-or-at the data range — no ±3h tails
		for (const v of vs) {
			expect(v).toBeGreaterThanOrEqual(1);
			expect(v).toBeLessThanOrEqual(7);
		}
		// monotone in v (right flank runs bottom to top)
		for (let i = 1; i < vs.length; i++) expect(vs[i]).toBeGreaterThanOrEqual(vs[i - 1]);
	});

	it('all densities are positive and maxDensity matches the points', () => {
		const curve = violinCurve(sample);
		for (const p of curve.points) expect(p.d).toBeGreaterThan(0);
		expect(curve.maxDensity).toBe(Math.max(...curve.points.map((p) => p.d)));
	});

	it('a manual bandwidth changes the curve; 0 and null both mean auto', () => {
		const auto = violinCurve(sample);
		const nullBw = violinCurve(sample, { bandwidth: null });
		const zeroBw = violinCurve(sample, { bandwidth: 0 });
		const wide = violinCurve(sample, { bandwidth: 5 });
		expect(nullBw.maxDensity).toBe(auto.maxDensity);
		expect(zeroBw.maxDensity).toBe(auto.maxDensity);
		expect(wide.maxDensity).not.toBe(auto.maxDensity);
	});
});

describe('violinOutline', () => {
	it('is symmetric about the centre line', () => {
		const curve = violinCurve(sample);
		const outline = violinOutline(curve, {
			xCenter: 100,
			halfWidthPx: 40,
			yscale: (v) => 200 - v * 10
		});
		expect(outline.length).toBe(curve.points.length * 2);
		const n = curve.points.length;
		for (let i = 0; i < n; i++) {
			const [rx, ry] = outline[i]; // right flank, bottom→top
			const [lx, ly] = outline[2 * n - 1 - i]; // left flank mirror
			expect(lx).toBeCloseTo(2 * 100 - rx, 9);
			expect(ly).toBeCloseTo(ry, 9);
		}
	});

	it('the peak reaches exactly halfWidthPx from the centre', () => {
		const curve = violinCurve(sample);
		const outline = violinOutline(curve, { xCenter: 0, halfWidthPx: 40, yscale: (v) => v });
		const maxX = Math.max(...outline.map(([x]) => x));
		expect(maxX).toBeCloseTo(40, 9);
	});
});
