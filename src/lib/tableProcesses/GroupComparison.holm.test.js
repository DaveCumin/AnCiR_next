// @ts-nocheck
/**
 * STAT-U6 (2026-10-03 review, "possible issue, not confirmed"): GroupComparison's Holm step
 * (post-hoc Mann-Whitney pairs) read a non-finite pair p as 1 and counted it in the family
 * size n, so every other pair's adjusted p was inflated.
 *
 * Verdict: CONFIRMED in the code, with no visible effect today (an invalid Mann-Whitney pair is
 * dropped before Holm, and a valid one always has a finite p). FIXED here and in the ports
 * (_gc_holm_adjust / gc_holm_adjust): Holm now goes through the shared pAdjust, so a
 * non-finite p is NaN adjusted and left out of n, as R p.adjust does for NA.
 * Reference: R 4.5.2, p.adjust(c(0.01, NA, 0.04, 0.03), "holm") = 0.03, NA, 0.06, 0.06.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: { set: vi.fn(), get: vi.fn(), has: vi.fn() } }
}));
vi.mock('$lib/core/Column.svelte', () => ({
	Column: class {},
	getColumnById: () => undefined,
	removeColumn: vi.fn()
}));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/StoreValueButton.svelte', () => ({ default: {} }));
vi.mock('$lib/components/plotbits/Table.svelte', () => ({ default: {} }));
vi.mock('$lib/components/plotbits/helpers/save.svelte.js', () => ({
	showNodeResultTable: vi.fn(),
	saveStaticDataAsCSV: vi.fn()
}));

import { holmAdjust, pairwiseMannWhitney } from './GroupComparison.svelte';

describe('STAT-U6: Holm in GroupComparison leaves a non-finite p out of the family', () => {
	it('matches R p.adjust(c(0.01, NA, 0.04, 0.03), "holm")', () => {
		const pairs = [0.01, NaN, 0.04, 0.03].map((pValue, i) => ({ groupA: `g${i}`, pValue }));
		const adj = holmAdjust(pairs).map((p) => p.pAdjusted);
		expect(adj[0]).toBeCloseTo(0.03, 15);
		expect(adj[1]).toBeNaN();
		expect(adj[2]).toBeCloseTo(0.06, 15);
		expect(adj[3]).toBeCloseTo(0.06, 15);
	});

	it('null and Infinity p are missing too; other fields and order are kept', () => {
		const pairs = [
			{ groupA: 'A', groupB: 'B', pValue: 0.02, effect: 0.5 },
			{ groupA: 'A', groupB: 'C', pValue: null },
			{ groupA: 'B', groupB: 'C', pValue: Infinity }
		];
		const out = holmAdjust(pairs);
		expect(out.map((p) => p.groupB)).toEqual(['B', 'C', 'C']);
		expect(out[0].effect).toBe(0.5);
		expect(out[0].pAdjusted).toBe(0.02); // n = 1
		expect(out[1].pAdjusted).toBeNaN();
		expect(out[2].pAdjusted).toBeNaN();
	});

	it('finite-only families are unchanged (Holm, statsmodels / R reference)', () => {
		// p.adjust(c(0.04, 0.01, 0.03), "holm") = 0.06, 0.03, 0.06
		const adj = holmAdjust([0.04, 0.01, 0.03].map((pValue) => ({ pValue }))).map(
			(p) => p.pAdjusted
		);
		expect(adj[0]).toBeCloseTo(0.06, 15);
		expect(adj[1]).toBeCloseTo(0.03, 15);
		expect(adj[2]).toBeCloseTo(0.06, 15);
	});

	it('pairwiseMannWhitney still adjusts and flags its pairs', () => {
		const g = (name, values) => ({ name, values, n: values.length });
		const out = pairwiseMannWhitney([
			g('A', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
			g('B', [11, 12, 13, 14, 15, 16, 17, 18, 19]),
			g('C', [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5])
		]);
		expect(out).toHaveLength(3);
		for (const p of out) expect(Number.isFinite(p.pAdjusted)).toBe(true);
		expect(out.find((p) => p.groupA === 'A' && p.groupB === 'B').significant).toBe(true);
	});
});
