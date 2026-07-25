import { describe, it, expect } from 'vitest';
import { pAdjust, pAdjustWithDecision, PADJUST_METHODS } from './pAdjust.js';

// The 25-value example below is checked digit-for-digit against
// statsmodels.stats.multitest.multipletests (bonferroni / holm / fdr_bh /
// fdr_by) and is pinned again in tools/parity/fixtures.json.
const P25 = [
	0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216, 0.222, 0.251, 0.269, 0.275,
	0.34, 0.341, 0.384, 0.569, 0.594, 0.696, 0.762, 0.94, 0.942, 0.975, 0.986
];

describe('pAdjust — agreement with statsmodels', () => {
	it('bonferroni', () => {
		const got = pAdjust(P25, 'bonferroni');
		expect(got.slice(0, 4)).toEqual([0.025, 0.2, 0.975, 1]);
		expect(got.slice(4).every((v) => v === 1)).toBe(true);
	});

	it('holm', () => {
		const got = pAdjust(P25, 'holm');
		[0.025, 0.192, 0.897, 0.902, 0.902].forEach((want, i) => expect(got[i]).toBeCloseTo(want, 9));
		expect(got.slice(5).every((v) => v === 1)).toBe(true);
	});

	it('benjamini-hochberg', () => {
		const got = pAdjust(P25, 'benjamini-hochberg');
		const want = [0.025, 0.1, 0.21, 0.21, 0.21, 0.25, 0.264285714, 0.491071429];
		want.forEach((w, i) => expect(got[i]).toBeCloseTo(w, 9));
		expect(got[24]).toBeCloseTo(0.986, 9);
	});

	it('benjamini-yekutieli', () => {
		const got = pAdjust(P25, 'benjamini-yekutieli');
		const want = [0.095398954, 0.381595818, 0.801351217, 0.801351217, 0.801351217, 0.953989544];
		want.forEach((w, i) => expect(got[i]).toBeCloseTo(w, 9));
		expect(got.slice(6).every((v) => v === 1)).toBe(true);
	});
});

describe('pAdjust — structural properties', () => {
	it.each(PADJUST_METHODS)('%s preserves input order', (method) => {
		// Deliberately unsorted: the whole class of bugs here is returning
		// results in sorted order.
		const p = [0.5, 0.001, 0.2, 0.04];
		const got = pAdjust(p, method);
		expect(got).toHaveLength(4);
		// The smallest raw p must map to the smallest adjusted p, at index 1.
		const minIdx = got.indexOf(Math.min(...got));
		expect(minIdx).toBe(1);
	});

	it.each(PADJUST_METHODS)('%s is monotone in the raw p-values', (method) => {
		const p = [0.001, 0.01, 0.02, 0.03, 0.5, 0.9];
		const got = pAdjust(p, method);
		for (let i = 1; i < got.length; i++) expect(got[i]).toBeGreaterThanOrEqual(got[i - 1] - 1e-12);
	});

	it.each(PADJUST_METHODS)('%s never exceeds 1 or drops below the raw value', (method) => {
		const p = [0.4, 0.6, 0.8, 0.99];
		pAdjust(p, method).forEach((adj, i) => {
			expect(adj).toBeLessThanOrEqual(1);
			expect(adj).toBeGreaterThanOrEqual(p[i] - 1e-12);
		});
	});

	it('BY is always at least as conservative as BH', () => {
		const bh = pAdjust(P25, 'benjamini-hochberg');
		const by = pAdjust(P25, 'benjamini-yekutieli');
		by.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(bh[i] - 1e-12));
	});

	it('Holm is always at least as conservative as BH', () => {
		const bh = pAdjust(P25, 'benjamini-hochberg');
		const holm = pAdjust(P25, 'holm');
		holm.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(bh[i] - 1e-12));
	});

	it('Holm is never more conservative than Bonferroni', () => {
		const bonf = pAdjust(P25, 'bonferroni');
		const holm = pAdjust(P25, 'holm');
		holm.forEach((v, i) => expect(v).toBeLessThanOrEqual(bonf[i] + 1e-12));
	});

	it('a single p-value is returned unchanged by every method', () => {
		for (const m of PADJUST_METHODS) expect(pAdjust([0.03], m)[0]).toBeCloseTo(0.03, 12);
	});

	it("'none' returns the raw values", () => {
		expect(pAdjust([0.01, 0.5], 'none')).toEqual([0.01, 0.5]);
	});
});

describe('pAdjust — non-finite handling', () => {
	it('passes NaN through and EXCLUDES it from n', () => {
		// A node that failed to converge must not tighten the correction on the
		// ones that succeeded: n here is 2, not 3.
		const got = pAdjust([0.01, NaN, 0.02], 'bonferroni');
		expect(Number.isNaN(got[1])).toBe(true);
		expect(got[0]).toBeCloseTo(0.02, 12);
		expect(got[2]).toBeCloseTo(0.04, 12);
	});

	it('treats null/undefined/strings as non-finite', () => {
		const got = pAdjust([0.01, null, undefined, 'x'], 'bonferroni');
		expect(got[0]).toBeCloseTo(0.01, 12);
		expect(got.slice(1).every(Number.isNaN)).toBe(true);
	});

	it('returns all-NaN when nothing is finite', () => {
		expect(pAdjust([NaN, NaN], 'holm').every(Number.isNaN)).toBe(true);
	});

	it('clamps out-of-range p-values into [0, 1]', () => {
		const got = pAdjust([-0.5, 1.5], 'none');
		expect(got[0]).toBe(0);
		expect(got[1]).toBe(1);
	});
});

describe('pAdjust — guards', () => {
	it('returns [] for empty or non-array input', () => {
		expect(pAdjust([], 'holm')).toEqual([]);
		expect(pAdjust(null, 'holm')).toEqual([]);
		expect(pAdjust(undefined, 'holm')).toEqual([]);
	});

	it('throws on an unknown method rather than silently defaulting', () => {
		expect(() => pAdjust([0.1], 'sidak')).toThrow(/unknown method/);
	});
});

describe('pAdjustWithDecision', () => {
	it('reports rejections at alpha', () => {
		const r = pAdjustWithDecision([0.001, 0.02, 0.9], 'benjamini-hochberg', 0.05);
		expect(r.reject).toEqual([true, true, false]);
		expect(r.nSignificant).toBe(2);
		expect(r.nTested).toBe(3);
	});

	it('counts only finite p-values as tested', () => {
		const r = pAdjustWithDecision([0.001, NaN], 'holm', 0.05);
		expect(r.nTested).toBe(1);
		expect(r.reject).toEqual([true, false]);
	});

	it('a stricter alpha rejects fewer', () => {
		const loose = pAdjustWithDecision(P25, 'benjamini-hochberg', 0.25);
		const tight = pAdjustWithDecision(P25, 'benjamini-hochberg', 0.01);
		expect(tight.nSignificant).toBeLessThanOrEqual(loose.nSignificant);
	});
});
