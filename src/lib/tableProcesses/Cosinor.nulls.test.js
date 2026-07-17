// Cosinor must IGNORE null rows, not fit them as zero.
//
// Split (and Filter) emit full-length segment columns with `null` outside the window — the
// time column is shared, which is what puts two segments on a common clock. But the pair
// filter used `isNaN(v)` alone, and `isNaN(null)` is FALSE, so every out-of-window row
// survived the filter and reached the fit, where arithmetic coerces null to 0.
//
// Measured on a clean 24 h cosine (mesor 10, amplitude 5) split at day 4:
//   truncated post window → mesor 10.000, amplitude 5.000, free period  24.0 h
//   null-padded (Split)   → mesor  5.000, amplitude 2.500, free period 221.5 h
// Amplitude and mesor exactly halved (half the rows were zeros), and the FREE fit latched
// onto the block of zeros as one huge slow cycle. Acrophase happened to survive — zeros are
// phase-neutral — which is why this stayed hidden: the fit looked plausible.
//
// This file deliberately does NOT mock $lib/utils/cosinor.js (unlike Cosinor.test.js): the
// bug is only visible through the real maths. Asserting on `y_results[].t` pins the filter
// itself, so the test still means something if the fit internals change.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: { set: vi.fn() } } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));

import { cosinor } from './Cosinor.svelte';

const OUT = {
	cosinorx: -1,
	period: -1,
	mesor: -1,
	amplitude: -1,
	acrophase: -1,
	rsquared: -1,
	pvalue: -1,
	bathyphase: -1,
	phase_angle: -1
};

const HOURS = 24 * 8;
const SPLIT = 24 * 4; // "pulse" at day 4
const t = Array.from({ length: HOURS }, (_, i) => i);
/** A clean 24 h rhythm: mesor 10, amplitude 5. */
const y = t.map((ti) => 10 + 5 * Math.cos((2 * Math.PI * ti) / 24));
/** Exactly what Split emits for the POST segment: full length, null before the split. */
const ySplit = y.map((v, i) => (i >= SPLIT ? v : null));

const args = (yIN, over) => ({
	xIN: 1,
	yIN: [yIN],
	Ncurves: 1,
	outputX: -1,
	out: { ...OUT },
	useFixedPeriod: true,
	fixedPeriod: 24,
	nHarmonics: 1,
	alpha: 0.05,
	referenceHrs: 0,
	...over
});

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
	mockColumns[2] = { getData: () => ySplit }; // Split-style post segment
	mockColumns[3] = { getData: () => y }; // the same rhythm, no nulls
});

describe('cosinor with null rows (a Split segment)', () => {
	it('fits ONLY the non-null rows, so mesor and amplitude are not halved', async () => {
		const [r, valid] = await cosinor(args(2));
		expect(valid).toBe(true);

		const yr = r.y_results[2];
		// The filter is the fix site: only the post window may reach the fit.
		expect(yr.t).toHaveLength(HOURS - SPLIT);
		expect(yr.fixedStats.M).toBeCloseTo(10, 6); // was 5 — half the rows were zeros
		expect(yr.fixedStats.harmonics[0].amplitude).toBeCloseTo(5, 6); // was 2.5
	});

	it('free-period fit is not dragged to a spurious long period by the null block', async () => {
		// The one that silently ruins a per-signal τ: 221.5 h instead of 24 h.
		const [r, valid] = await cosinor(args(2, { useFixedPeriod: false }));
		expect(valid).toBe(true);
		const c = r.y_results[2].fittedData.parameters.cosines[0];
		expect((2 * Math.PI) / c.frequency).toBeCloseTo(24, 1);
	});

	it('a null-padded segment fits the same as the equivalent data with no nulls', async () => {
		const [rSplit] = await cosinor(args(2));
		const [rClean] = await cosinor(args(3));
		// Same rhythm ⇒ same mesor/amplitude, whether or not the column carries null padding.
		expect(rSplit.y_results[2].fixedStats.M).toBeCloseTo(rClean.y_results[3].fixedStats.M, 6);
		expect(rSplit.y_results[2].fixedStats.harmonics[0].amplitude).toBeCloseTo(
			rClean.y_results[3].fixedStats.harmonics[0].amplitude,
			6
		);
	});

	it('still drops NaN, and drops null in the TIME column too', async () => {
		const tGappy = t.map((v, i) => (i % 10 === 0 ? null : i % 7 === 0 ? NaN : v));
		mockColumns[4] = { type: 'number', getData: () => tGappy, hoursSinceStart: tGappy };
		mockColumns[5] = { getData: () => y };
		const [r, valid] = await cosinor(args(5, { xIN: 4 }));
		expect(valid).toBe(true);
		// Every surviving t must be a real number: null in x is as invalid as NaN in x.
		for (const v of r.y_results[5].t) {
			expect(v).not.toBeNull();
			expect(Number.isFinite(v)).toBe(true);
		}
	});

	it('an all-null column yields no fit rather than a fit through zeros', async () => {
		mockColumns[6] = { getData: () => t.map(() => null) };
		const [, valid] = await cosinor(args(6));
		expect(valid).toBe(false);
	});

	it('the permutation p-value is computed on the real rows only', async () => {
		// Third instance of the same trap, on the permuteTest path: the p-value was measured
		// against a series padded with zeros, i.e. for a fit nobody made. A cosine this clean
		// must come out significant; a fit dominated by a block of zeros need not.
		const [r, valid] = await cosinor(
			args(2, { permuteTest: true, permutations: 50, permSeed: 1 })
		);
		expect(valid).toBe(true);
		const p = r.y_results[2].pValue ?? r.y_results[2].fixedStats?.stats?.pValue;
		// Not asserting an exact p (it's a permutation test) — only that the path ran and the
		// filter above it now excludes nulls, which `t` proves directly.
		expect(r.y_results[2].t).toHaveLength(HOURS - SPLIT);
		if (p != null && !Number.isNaN(p)) expect(p).toBeLessThan(0.5);
	});

	it('the output X grid drops nulls too, so no point is drawn back at the origin', async () => {
		// The same trap in the OTHER filter: an output grid wired to a Split segment carries
		// nulls, `!isNaN(null)` kept them, and the curve was evaluated at Number(null) === 0.
		const gridWithNulls = t.map((v, i) => (i >= SPLIT ? v : null));
		mockColumns[7] = { type: 'number', getData: () => gridWithNulls };
		const [r, valid] = await cosinor(args(3, { outputX: 7 }));
		expect(valid).toBe(true);

		const { xOutData } = r.y_results[3];
		expect(xOutData).toHaveLength(HOURS - SPLIT);
		expect(xOutData.every((v) => Number.isFinite(v))).toBe(true);
		expect(Math.min(...xOutData)).toBe(SPLIT); // starts at the split, not back at 0
	});
});
