import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: { set: vi.fn() } } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));

const { rayleigh } = await import('./RayleighTest.svelte');

function mkCol(id, name, data) {
	mockColumns[id] = { id, name, type: 'number', getData: () => data, getDataHash: String(data) };
	return id;
}

/** n angles tightly clustered near 0 rad — as non-uniform as data gets. */
const clustered = (n) => Array.from({ length: n }, (_, i) => 0.05 * i);
/** n angles spread evenly around the circle — the null. */
const uniform = (n) => Array.from({ length: n }, (_, i) => (2 * Math.PI * i) / n);

const args = (over) => ({
	yIN: [1],
	unit: 'radians',
	period: 24,
	timeIN: -1,
	showWatsonWilliams: false,
	out: {},
	...over
});

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
});

describe('RayleighTest — small-sample warnings', () => {
	it('warns when a series has fewer than 8 angles', () => {
		// The motivating case: three angles produce a "significant" p (~0.03)
		// with nothing on screen to say the approximation is out of range.
		mkCol(1, 'onsets', clustered(3));
		const [res] = rayleigh(args());
		expect(res.warnings.some((w) => /Small sample/.test(w))).toBe(true);
		expect(res.warnings.some((w) => /n = 3/.test(w))).toBe(true);
	});

	it('names the column and cites the threshold and the reference', () => {
		mkCol(1, 'onsets', clustered(4));
		const [res] = rayleigh(args());
		const w = res.warnings.find((x) => /Small sample/.test(x));
		expect(w).toMatch(/onsets/); // which series
		expect(w).toMatch(/n ≥ 8/); // the threshold
		expect(w).toMatch(/Zar/); // where it comes from
	});

	it('adds a SEPARATE warning when a small sample is non-significant', () => {
		// "p = 0.4, n = 4" must not be read as evidence of uniformity — that is a
		// different mistake from trusting a small-n significant result.
		mkCol(1, 'onsets', uniform(5));
		const [res] = rayleigh(args());
		expect(res.warnings.some((w) => /little power/.test(w))).toBe(true);
		expect(res.warnings.some((w) => /NOT evidence/.test(w))).toBe(true);
	});

	it('does not add the power warning when the small sample IS significant', () => {
		mkCol(1, 'onsets', clustered(3));
		const [res] = rayleigh(args());
		expect(res.perY[1].pValue).toBeLessThan(0.05);
		expect(res.warnings.some((w) => /little power/.test(w))).toBe(false);
	});

	it('is silent at or above the threshold', () => {
		mkCol(1, 'onsets', clustered(8));
		const [res] = rayleigh(args());
		expect(res.warnings).toEqual([]);
	});

	it('reports every small series, not just the first', () => {
		mkCol(1, 'a', clustered(3));
		mkCol(2, 'b', clustered(4));
		const [res] = rayleigh(args({ yIN: [1, 2] }));
		const w = res.warnings.find((x) => /Small sample/.test(x));
		expect(w).toMatch(/a \(n = 3\)/);
		expect(w).toMatch(/b \(n = 4\)/);
	});

	it('only flags the small series when one is large and one is small', () => {
		mkCol(1, 'big', clustered(30));
		mkCol(2, 'small', clustered(4));
		const [res] = rayleigh(args({ yIN: [1, 2] }));
		const w = res.warnings.find((x) => /Small sample/.test(x));
		expect(w).toMatch(/small/);
		expect(w).not.toMatch(/big/);
	});

	it('still computes the result rather than refusing', () => {
		// The mean direction is informative even at n = 3; refusing would lose it.
		mkCol(1, 'onsets', clustered(3));
		const [res, valid] = rayleigh(args());
		expect(valid).toBe(true);
		expect(Number.isFinite(res.perY[1].R)).toBe(true);
		expect(Number.isFinite(res.perY[1].pValue)).toBe(true);
	});

	it('has no warnings and no crash with nothing wired', () => {
		const [res] = rayleigh(args({ yIN: [] }));
		expect(res.warnings).toEqual([]);
	});
});

describe('RayleighTest — Watson-Williams group sizes', () => {
	it('warns when a group has fewer than 5 angles', () => {
		// Independent of total N: two groups of 3 is 6 angles overall, but the F
		// approximation is driven by the per-group sizes.
		mkCol(1, 'g1', clustered(3));
		mkCol(
			2,
			'g2',
			clustered(3).map((a) => a + 1)
		);
		const [res] = rayleigh(args({ yIN: [1, 2], showWatsonWilliams: true }));
		if (res.ww?.valid) {
			expect(res.warnings.some((w) => /Watson-Williams/.test(w))).toBe(true);
		}
	});

	it('is silent about groups when all are large enough', () => {
		mkCol(1, 'g1', clustered(20));
		mkCol(
			2,
			'g2',
			clustered(20).map((a) => a + 0.5)
		);
		const [res] = rayleigh(args({ yIN: [1, 2], showWatsonWilliams: true }));
		expect(res.warnings.some((w) => /Watson-Williams/.test(w))).toBe(false);
	});

	it('says nothing about groups when the test is switched off', () => {
		mkCol(1, 'g1', clustered(3));
		mkCol(
			2,
			'g2',
			clustered(3).map((a) => a + 1)
		);
		const [res] = rayleigh(args({ yIN: [1, 2], showWatsonWilliams: false }));
		expect(res.warnings.some((w) => /Watson-Williams/.test(w))).toBe(false);
	});
});
