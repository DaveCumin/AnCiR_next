import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: { set: vi.fn() } } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));

import { normalitytest } from './NormalityTest.svelte';

const OUT = { variable: -1, statistic: -1, pvalue: -1, n: -1, normal: -1 };
const args = (over) => ({ yIN: [1, 2], out: { ...OUT }, method: 'dagostino', alpha: 0.05, ...over });

const NORMALISH = [2.1, -0.3, 1.4, 0.2, -1.1, 0.8, 0.05, 1.9, -0.7, 0.4, 1.2, -0.9, 0.6, -0.2, 0.9, 1.5, -1.3, 0.3, 0.7, -0.5, 0.1, -0.4, 1.1, -0.8, 0.5];
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
