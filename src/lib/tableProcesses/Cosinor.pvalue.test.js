// The `pvalue` PORT must carry the ANALYTIC fit p-value, not the permutation p.
//
// Reported by David (2026-08-31): "for a cosinor fit ... there is a p-value output
// that seems to be the permutation p-value, rather than the fit p-value."
// Confirmed E2E on demo-tp-cosinor: with the permutation test off the port held
// NaN (beside R² = 0.954), and with it on the port held 0.001 — the Monte Carlo
// tail, not the zero-amplitude F-test that fitCosinorFixed already computed
// (F = 486.6, p ≈ 0) and that the handbook says the port carries. The Python
// mirror (tools/ancir_runtime.py tp_cosinor) always fed the port from `pF`, so
// the two languages disagreed about what the same column MEANS.
//
// Contract pinned here:
//   pvalue       — the zero-amplitude F-test p of the fixed-period fit
//                  (Cornelissen 2014); NaN for the free-period fit, which has no
//                  analytic test (period estimated → F null does not hold).
//   perm_pvalue  — the permutation p, only when the permutation test ran.
//
// This file deliberately does NOT mock $lib/utils/cosinor.js (unlike
// Cosinor.test.js): the conflation is only visible through the real maths, and a
// mocked fit is exactly how a port can ship wired to the wrong quantity.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockColumns, rawData } = vi.hoisted(() => ({
	mockColumns: {},
	rawData: new Map()
}));
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData },
	appConsts: { processMap: new Map() }
}));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));

import { cosinor } from './Cosinor.svelte';
import { fitCosinorFixed } from '$lib/utils/cosinor.js';

const HOURS = 24 * 4;
const t = Array.from({ length: HOURS }, (_, i) => i);
/** Clean-ish 24 h rhythm with a little deterministic ripple so R² < 1. */
const y = t.map(
	(ti) => 10 + 4 * Math.cos((2 * Math.PI * (ti - 8)) / 24) + Math.sin(ti * 1.7) * 0.8
);

// Out ids ≥ 0 are "wired"; the metric writer no-ops on -1.
const OUT_IDS = {
	cosinorx: 50,
	cosinory_2: 51,
	period: 60,
	mesor: 61,
	amplitude: 62,
	acrophase: 63,
	amplitude_ciLow: 64,
	amplitude_ciHigh: 65,
	acrophase_ciLow: 66,
	acrophase_ciHigh: 67,
	rsquared: 68,
	pvalue: 69,
	perm_pvalue: 70,
	bathyphase: 71,
	phase_angle: 72
};

const args = (over) => ({
	xIN: 1,
	yIN: [2],
	Ncurves: 1,
	outputX: -1,
	out: { ...OUT_IDS },
	useFixedPeriod: true,
	fixedPeriod: 24,
	nHarmonics: 1,
	alpha: 0.05,
	referenceHrs: 0,
	permuteTest: false,
	nPermutations: 99,
	permutationSeed: 12345,
	permutationStatistic: 'rSquared',
	preProcesses: [],
	...over
});

beforeEach(() => {
	rawData.clear();
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
	mockColumns[2] = { getData: () => y };
	for (const id of Object.values(OUT_IDS)) {
		mockColumns[id] = { getData: () => rawData.get(id) ?? [] };
	}
});

describe('Cosinor pvalue port semantics', () => {
	it('permutations OFF: pvalue port carries the analytic F-test p (was NaN before the fix)', async () => {
		const [, valid] = await cosinor(args());
		expect(valid).toBe(true);

		const expected = fitCosinorFixed(t, y, 24, 1, 0.05);
		const port = rawData.get(OUT_IDS.pvalue);
		expect(port).toHaveLength(1);
		expect(port[0]).toBeCloseTo(expected.pF, 12);
		expect(Number.isFinite(port[0])).toBe(true);

		// No permutation ran, so its port must say "not computed", not 0 or 1.
		const perm = rawData.get(OUT_IDS.perm_pvalue);
		expect(perm).toHaveLength(1);
		expect(Number.isNaN(perm[0])).toBe(true);
	});

	it('permutations ON: pvalue port STILL carries the F-test p; perm_pvalue carries the permutation p', async () => {
		const [result, valid] = await cosinor(args({ permuteTest: true }));
		expect(valid).toBe(true);

		const expected = fitCosinorFixed(t, y, 24, 1, 0.05);
		const port = rawData.get(OUT_IDS.pvalue);
		expect(port[0]).toBeCloseTo(expected.pF, 12);

		const yr = result.y_results[2];
		expect(Number.isFinite(yr.pValue)).toBe(true); // the permutation p exists...
		const perm = rawData.get(OUT_IDS.perm_pvalue);
		expect(perm[0]).toBe(yr.pValue); // ...and lands on ITS OWN port,
		expect(port[0]).not.toBe(yr.pValue); // never overwriting the analytic p.
	});

	it('free-period fit: pvalue is NaN (no analytic test), matching the Python mirror', async () => {
		const [, valid] = await cosinor(args({ useFixedPeriod: false, Ncurves: 1 }));
		expect(valid).toBe(true);
		const port = rawData.get(OUT_IDS.pvalue);
		expect(Number.isNaN(port[0])).toBe(true);
	});
});
