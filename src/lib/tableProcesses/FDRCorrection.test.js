import { describe, it, expect, vi, beforeEach } from 'vitest';

const columns = new Map();
const rawData = new Map();

vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => columns.get(Number(id)) ?? null
}));
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData }
}));

const { fdrcorrection } = await import('./FDRCorrection.svelte');

function mkColumn(id, data) {
	columns.set(id, { id, getData: () => data, name: `col${id}`, getDataHash: String(data) });
	return id;
}

beforeEach(() => {
	columns.clear();
	rawData.clear();
});

const OUT = { padj: 100, reject: 101 };

describe('fdrcorrection', () => {
	it('adjusts p-values by the chosen method', () => {
		mkColumn(1, [0.001, 0.008, 0.039, 0.041, 0.042]);
		const [res, valid] = fdrcorrection({
			xIN: 1,
			method: 'bonferroni',
			alpha: 0.05,
			out: OUT
		});
		expect(valid).toBe(true);
		expect(res.padj[0]).toBeCloseTo(0.005, 9);
		expect(res.padj[1]).toBeCloseTo(0.04, 9);
		expect(res.padj[4]).toBeCloseTo(0.21, 9);
	});

	it('flags rejections at alpha', () => {
		mkColumn(1, [0.001, 0.5, 0.9]);
		const [res] = fdrcorrection({ xIN: 1, method: 'benjamini-hochberg', alpha: 0.05, out: OUT });
		expect(res.reject).toEqual([1, 0, 0]);
		expect(res.nSignificant).toBe(1);
		expect(res.nTested).toBe(3);
	});

	it('writes both output columns into rawData', () => {
		mkColumn(1, [0.01, 0.2]);
		columns.set(100, { id: 100 });
		columns.set(101, { id: 101 });
		fdrcorrection({ xIN: 1, method: 'holm', alpha: 0.05, out: OUT });
		expect(rawData.get(100)).toHaveLength(2);
		expect(rawData.get(101)).toHaveLength(2);
		expect(columns.get(100).type).toBe('number');
	});

	it('keeps missing p-values MISSING and excludes them from n', () => {
		// A test that failed to run must not tighten the correction on the others.
		mkColumn(1, [0.01, null, 0.02]);
		const [res] = fdrcorrection({ xIN: 1, method: 'bonferroni', alpha: 0.05, out: OUT });
		expect(res.nTested).toBe(2);
		expect(res.padj[0]).toBeCloseTo(0.02, 9); // x2, not x3
		expect(res.reject[1]).toBeNull();
	});

	it('BY is more conservative than BH on the same input', () => {
		const p = [0.001, 0.01, 0.02, 0.03, 0.04];
		mkColumn(1, p);
		const bh = fdrcorrection({ xIN: 1, method: 'benjamini-hochberg', alpha: 0.05, out: OUT })[0];
		const by = fdrcorrection({ xIN: 1, method: 'benjamini-yekutieli', alpha: 0.05, out: OUT })[0];
		expect(by.nSignificant).toBeLessThanOrEqual(bh.nSignificant);
		by.padj.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(bh.padj[i] - 1e-12));
	});

	it("'none' leaves the p-values untouched", () => {
		mkColumn(1, [0.01, 0.6]);
		const [res] = fdrcorrection({ xIN: 1, method: 'none', alpha: 0.05, out: OUT });
		expect(res.padj).toEqual([0.01, 0.6]);
	});

	it('falls back to BH for an unrecognised method rather than throwing', () => {
		mkColumn(1, [0.01, 0.6]);
		const [res, valid] = fdrcorrection({ xIN: 1, method: 'sidak', alpha: 0.05, out: OUT });
		expect(valid).toBe(true);
		expect(res.padj[0]).toBeCloseTo(0.02, 9);
	});

	it('defaults alpha to 0.05 when it is missing or unusable', () => {
		mkColumn(1, [0.001, 0.9]);
		const [res] = fdrcorrection({ xIN: 1, method: 'none', alpha: 'abc', out: OUT });
		expect(res.reject).toEqual([1, 0]);
	});

	it('is invalid with no input, a missing column, or empty data', () => {
		expect(fdrcorrection({ xIN: -1, out: OUT })[1]).toBe(false);
		expect(fdrcorrection({ xIN: 99, out: OUT })[1]).toBe(false);
		mkColumn(1, []);
		expect(fdrcorrection({ xIN: 1, out: OUT })[1]).toBe(false);
	});

	it('is invalid when nothing in the column is a usable p-value', () => {
		mkColumn(1, [null, '', undefined]);
		const [res, valid] = fdrcorrection({ xIN: 1, method: 'holm', alpha: 0.05, out: OUT });
		expect(valid).toBe(false);
		expect(res.nTested).toBe(0);
	});

	it('does not throw when no output columns are wired yet', () => {
		mkColumn(1, [0.01, 0.2]);
		expect(() => fdrcorrection({ xIN: 1, method: 'holm', alpha: 0.05, out: {} })).not.toThrow();
	});
});
