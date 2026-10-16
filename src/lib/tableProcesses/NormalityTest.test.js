import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: { set: vi.fn() } } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));

import { normalitytest } from './NormalityTest.svelte';

const OUT = { variable: -1, statistic: -1, pvalue: -1, n: -1, normal: -1 };
const args = (over) => ({ yIN: [1, 2], out: { ...OUT }, method: 'shapiro', alpha: 0.05, ...over });

const NORMALISH = [
	2.1, -0.3, 1.4, 0.2, -1.1, 0.8, 0.05, 1.9, -0.7, 0.4, 1.2, -0.9, 0.6, -0.2, 0.9, 1.5, -1.3, 0.3,
	0.7, -0.5, 0.1, -0.4, 1.1, -0.8, 0.5
];
const SKEWED = [1, 1, 1, 1, 2, 2, 3, 10, 4, 5, 6, 7, 3, 2, 8, 1, 1, 9, 2, 1, 1, 2, 3, 1, 15];

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mockColumns[1] = { name: 'normalish', getData: () => NORMALISH };
	mockColumns[2] = { name: 'skewed', getData: () => SKEWED };
});

describe('normalitytest', () => {
	it('is invalid with no wired columns', () => {
		expect(normalitytest(args({ yIN: [] }))[1]).toBe(false);
	});

	it('emits one row per variable with statistic/pvalue/n/normal', () => {
		const [r, valid] = normalitytest(args());
		expect(valid).toBe(true);
		expect(r.rows).toHaveLength(2);
		expect(r.rows.map((x) => x.variable)).toEqual(['normalish', 'skewed']);
	});

	it('flags a near-normal column as normal and a skewed one as not', () => {
		const [r] = normalitytest(args());
		expect(r.rows[0].normal).toBe(1); // normalish, p > 0.05
		expect(r.rows[1].normal).toBe(0); // skewed, p < 0.05
		expect(r.rows[1].pvalue).toBeLessThan(0.05);
		expect(r.warnings.some((w) => w.includes('Non-normal'))).toBe(true);
	});

	it('defaults to Shapiro-Wilk with scipy-matching statistics', () => {
		const [r] = normalitytest(args());
		expect(r.methodUsed).toBe('shapiro');
		expect(r.rows[0].statistic).toBeCloseTo(0.981784, 4); // scipy.stats.shapiro(NORMALISH).W
		expect(r.rows[1].statistic).toBeCloseTo(0.765046, 4); // scipy.stats.shapiro(SKEWED).W
	});

	it('honours the jarquebera method choice', () => {
		const [r] = normalitytest(args({ method: 'jarquebera' }));
		expect(r.methodUsed).toBe('jarquebera');
		expect(r.rows[0].statistic).toBeCloseTo(0.788088, 4);
	});

	it('reports NaN (not evaluable) for a zero-variance column', () => {
		mockColumns[1] = { name: 'flat', getData: () => Array(12).fill(7) };
		const [r] = normalitytest(args());
		expect(Number.isNaN(r.rows[0].pvalue)).toBe(true);
		expect(Number.isNaN(r.rows[0].normal)).toBe(true);
	});
});

describe('normalitytest: Shapiro-Wilk across n = 5000', () => {
	const big = (n) =>
		Array.from({ length: n }, (_, i) => 10 + 3 * Math.sin(i / 7) + ((i * 7919) % 101) / 50);
	it('n = 5000: a p-value and a verdict, no large-sample warning', () => {
		mockColumns[3] = { name: 'hive', getData: () => big(5000) };
		const [r] = normalitytest(args({ yIN: [3] }));
		expect(Number.isFinite(r.rows[0].pvalue)).toBe(true);
		expect([0, 1]).toContain(r.rows[0].normal);
		expect(r.warnings.some((w) => w.includes('No Shapiro-Wilk p-value'))).toBe(false);
	});
	it('n = 5001: W shown, p and verdict missing, and a note that says why and what to use', () => {
		mockColumns[3] = { name: 'hive', getData: () => big(5001) };
		const [r] = normalitytest(args({ yIN: [3, 1] }));
		const row = r.rows[0];
		expect(row.statistic).toBeGreaterThan(0);
		expect(row.pvalue).toBeNaN();
		expect(row.normal).toBeNaN();
		expect(r.warnings).toContain(
			'No Shapiro-Wilk p-value above n = 5,000 (hive: n = 5,001). W is shown, but ' +
				"Royston's p-value approximation is only validated up to n = 5,000, and at this size " +
				"any test flags trivial departures. Use D'Agostino-Pearson, and judge the shape from " +
				'a Q-Q plot.'
		);
		// Not mistaken for a column that could not be tested.
		expect(r.warnings.some((w) => w.includes('could not be tested'))).toBe(false);
	});
});
