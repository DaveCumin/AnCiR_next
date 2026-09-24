import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
const { mockRawDataSet } = vi.hoisted(() => ({ mockRawDataSet: vi.fn() }));
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: { set: mockRawDataSet, get: vi.fn(), has: vi.fn() } },
	appConsts: { processMap: new Map() }
}));
vi.mock('$lib/core/Column.svelte', () => ({
	Column: class {},
	getColumnById: (id) => mockColumns[id],
	removeColumn: vi.fn()
}));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));
vi.mock('$lib/components/plotbits/Table.svelte', () => ({ default: {} }));
vi.mock('$lib/components/LoadingSpinner.svelte', () => ({ default: {} }));
vi.mock('$lib/core/core.svelte.js', () => ({
	pushObj: vi.fn(),
	core: { rawData: { set: mockRawDataSet, get: vi.fn(), has: vi.fn() } },
	appConsts: { processMap: new Map() }
}));
vi.mock('$lib/utils/time/TimeUtils.js', () => ({ formatTimeFromUNIX: (ms) => String(ms) }));

vi.mock('$lib/utils/periodogram.js', () => ({
	runPeriodogramCalculation: vi.fn((params) => {
		// Return a peak at 24h with power proportional to how close
		// periodMin..periodMax includes 24
		const xs = [];
		const ys = [];
		for (let p = params.periodMin; p <= params.periodMax + 1e-9; p += params.periodSteps) {
			xs.push(p);
			ys.push(10 - Math.abs(p - 24));
		}
		return { x: xs, y: ys, threshold: [], pvalue: [] };
	})
}));

// Partial mock: the fitters are stubbed, the pure helpers (FREE_PERIOD_DEFAULTS,
// freePeriodFitWarnings, resolvePeriodRange) stay real.
vi.mock('$lib/utils/cosinor.js', async (importOriginal) => ({
	...(await importOriginal()),
	fitCosineCurves: vi.fn(() => ({
		parameters: {
			cosines: [{ amplitude: 2, frequency: (2 * Math.PI) / 24, phase: 0.3 }],
			O: 1
		},
		rmse: 0.2,
		rSquared: 0.95
	})),
	fitCosinorFixed: vi.fn(() => ({
		M: 1.5,
		harmonics: [
			{ k: 1, amplitude: 3, acrophase_hrs: 6.25, phi_rad: 0, CI_A: [0, 0], CI_acrophase: [0, 0] }
		],
		R2: 0.9,
		RMSE: 0.15,
		pF: 0.001,
		F_stat: 99,
		df: [2, 45]
	}))
}));

import { movinganalysis, getStatKeys } from './MovingAnalysis.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
});

describe('getStatKeys', async () => {
	it('returns periodogram stats', async () => {
		expect(getStatKeys({ analysis: 'periodogram' })).toEqual(['peak_period', 'peak_power']);
	});

	it('returns fixed cosinor stats with expected harmonic keys', async () => {
		const keys = getStatKeys({ analysis: 'cosinor', useFixedPeriod: true, nHarmonics: 2 });
		expect(keys).toContain('mesor');
		expect(keys).toContain('H1_amplitude');
		expect(keys).toContain('H2_acrophase');
		expect(keys).toContain('r2');
		expect(keys).toContain('rmse');
		expect(keys).toContain('pvalue');
	});

	it('returns free cosinor stats scaled by Ncurves', async () => {
		const keys = getStatKeys({
			analysis: 'cosinor',
			useFixedPeriod: false,
			Ncurves: 2
		});
		expect(keys).toContain('C1_period');
		expect(keys).toContain('C2_amplitude');
		expect(keys).toContain('r2');
	});
});

describe('movinganalysis', async () => {
	const baseArgs = {
		xIN: -1,
		yIN: [],
		windowSize: 48,
		stepSize: 12,
		binLabel: 'center',
		analysis: 'periodogram',
		pgMethod: 'Lomb-Scargle',
		periodMin: 20,
		periodMax: 28,
		periodStep: 0.5,
		pgBinSize: 0.25,
		pgAlpha: 0.05,
		useFixedPeriod: true,
		fixedPeriod: 24,
		nHarmonics: 1,
		Ncurves: 1,
		alpha: 0.05,
		out: { movex: -1 }
	};

	it('returns invalid when inputs are missing', async () => {
		const [, valid] = await movinganalysis({ ...baseArgs });
		expect(valid).toBe(false);
	});

	it('returns invalid when data span is shorter than the window', async () => {
		const t = [0, 1, 2, 3, 4]; // 4 hrs total
		const y = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };
		const [, valid] = await movinganalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			windowSize: 48,
			stepSize: 12
		});
		expect(valid).toBe(false);
	});

	it('produces one bin per window for periodogram and picks peak near 24h', async () => {
		const n = 240; // 240 samples, 1 hr apart → 240 hrs
		const t = Array.from({ length: n }, (_, i) => i);
		const y = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };

		const [result, valid] = await movinganalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			windowSize: 48,
			stepSize: 24,
			analysis: 'periodogram'
		});
		expect(valid).toBe(true);
		// t ranges 0..239 (xMax=239); starts ≤ 239-48=191 with step 24 → 0,24,…,168 = 8 bins
		expect(result.bins.length).toBe(8);
		expect(result.bins[0]).toBeCloseTo(24, 6); // center of first window (0..48)
		// Peak period should be close to 24 for every window
		const peakPeriods = result.y_results[2].peak_period;
		expect(peakPeriods.length).toBe(8);
		for (const p of peakPeriods) expect(p).toBeCloseTo(24, 1);
	});

	it('labels bin at window start when binLabel=start', async () => {
		const n = 120;
		const t = Array.from({ length: n }, (_, i) => i);
		const y = t.map((ti) => Math.sin((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };

		const [result] = await movinganalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			windowSize: 48,
			stepSize: 24,
			binLabel: 'start'
		});
		expect(result.bins[0]).toBeCloseTo(0, 6);
	});

	it('runs fixed-cosinor analysis and fills amplitude/mesor arrays', async () => {
		const n = 240;
		const t = Array.from({ length: n }, (_, i) => i);
		const y = t.map((ti) => 1.5 + 3 * Math.cos((2 * Math.PI * (ti - 6.25)) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };

		const [result, valid] = await movinganalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			analysis: 'cosinor',
			useFixedPeriod: true,
			fixedPeriod: 24,
			nHarmonics: 1,
			windowSize: 48,
			stepSize: 24
		});
		expect(valid).toBe(true);
		const per = result.y_results[2];
		expect(per.H1_amplitude.length).toBe(result.bins.length);
		// With our mocked fit, amplitude should always be 3
		for (const a of per.H1_amplitude) expect(a).toBeCloseTo(3, 6);
		for (const m of per.mesor) expect(m).toBeCloseTo(1.5, 6);
	});

	// --- Added edge cases ---

	it('returns invalid when fewer than 3 valid X points', async () => {
		mockColumns[1] = { type: 'number', getData: () => [0, 100] };
		mockColumns[2] = { getData: () => [1, 2] };
		const [, valid] = await movinganalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			windowSize: 48,
			stepSize: 24
		});
		expect(valid).toBe(false);
	});

	it('fails safe (no throw) when a Y column ref is missing', async () => {
		const n = 240;
		const t = Array.from({ length: n }, (_, i) => i);
		mockColumns[1] = { type: 'number', getData: () => t };
		// yId 999 absent
		await expect(
			movinganalysis({ ...baseArgs, xIN: 1, yIN: [999], windowSize: 48, stepSize: 24 })
		).resolves.toBeDefined();
		const [, valid] = await movinganalysis({
			...baseArgs,
			xIN: 1,
			yIN: [999],
			windowSize: 48,
			stepSize: 24
		});
		expect(valid).toBe(false);
	});

	it('accepts a scalar (non-array) yIN', async () => {
		const n = 120;
		const t = Array.from({ length: n }, (_, i) => i);
		const y = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };
		const [result, valid] = await movinganalysis({
			...baseArgs,
			xIN: 1,
			yIN: 2,
			windowSize: 48,
			stepSize: 24,
			analysis: 'periodogram'
		});
		expect(valid).toBe(true);
		expect(result.y_results[2]).toBeDefined();
	});

	it('labels bin at window end when binLabel=end', async () => {
		const n = 120;
		const t = Array.from({ length: n }, (_, i) => i);
		const y = t.map((ti) => Math.sin((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };
		const [result] = await movinganalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			windowSize: 48,
			stepSize: 24,
			binLabel: 'end'
		});
		expect(result.bins[0]).toBeCloseTo(48, 6); // first window 0..48 labelled at end
	});

	it('handles multiple Y inputs producing parallel stat arrays', async () => {
		const n = 240;
		const t = Array.from({ length: n }, (_, i) => i);
		const y1 = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24));
		const y2 = t.map((ti) => Math.sin((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y1 };
		mockColumns[3] = { getData: () => y2 };
		const [result, valid] = await movinganalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2, 3],
			windowSize: 48,
			stepSize: 24,
			analysis: 'periodogram'
		});
		expect(valid).toBe(true);
		expect(result.y_results[2].peak_period.length).toBe(result.bins.length);
		expect(result.y_results[3].peak_period.length).toBe(result.bins.length);
	});

	it('windows with too few points stay NaN (gappy data)', async () => {
		// Dense at the start, then a big gap, then dense again so a middle window is empty
		const t = [0, 1, 2, ...Array.from({ length: 50 }, (_, i) => 200 + i)];
		const y = t.map(() => 1);
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };
		const [result, valid] = await movinganalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			windowSize: 24,
			stepSize: 24,
			analysis: 'periodogram'
		});
		expect(valid).toBe(true);
		// At least one window (over the gap) should have produced NaN peak_period
		const peaks = result.y_results[2].peak_period;
		expect(peaks.some((v) => Number.isNaN(v))).toBe(true);
	});

	it('writes per-stat output columns and the bin x column when committed', async () => {
		mockRawDataSet.mockClear();
		const n = 240;
		const t = Array.from({ length: n }, (_, i) => i);
		const y = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };
		mockColumns[90] = { data: null, type: null, tableProcessGUId: null }; // movex
		mockColumns[91] = { data: null, type: null, tableProcessGUId: null }; // 2_peak_period
		mockColumns[92] = { data: null, type: null, tableProcessGUId: null }; // 2_peak_power

		const [result, valid] = await movinganalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			windowSize: 48,
			stepSize: 24,
			analysis: 'periodogram',
			out: { movex: 90, '2_peak_period': 91, '2_peak_power': 92 }
		});

		expect(valid).toBe(true);
		const xCall = mockRawDataSet.mock.calls.find(([id]) => id === 90);
		const ppCall = mockRawDataSet.mock.calls.find(([id]) => id === 91);
		expect(xCall[1]).toEqual(result.bins);
		expect(ppCall[1]).toEqual(result.y_results[2].peak_period);
		expect(mockColumns[90].binWidth).toBe(48);
		expect(mockColumns[90].binStep).toBe(24);
		expect(mockColumns[91].type).toBe('number');
		expect(mockColumns[91].tableProcessGUId).toBe(mockColumns[90].tableProcessGUId);
	});

	// --- summary statistics (mean / SD / percentile) ---
	// REAL maths through the node's func (no mocked fit): the trend mode was
	// inert for months because a pure-util test with mocked maths stayed green,
	// so these assert actual pinned numbers, not just array shapes.

	describe('analysis: summary', () => {
		it('getStatKeys returns fixed keys regardless of the percentile value', () => {
			expect(getStatKeys({ analysis: 'summary', summaryPercentile: 30 })).toEqual([
				'mean',
				'sd',
				'percentile'
			]);
			expect(getStatKeys({ analysis: 'summary', summaryPercentile: 90 })).toEqual([
				'mean',
				'sd',
				'percentile'
			]);
		});

		it('emits per-window mean, SAMPLE sd (n-1) and type-7 percentile (numpy pins)', async () => {
			// One window [0,7): the 7 values below. Pinned against numpy:
			//   mean = 3.5714285714285716, std(ddof=1) = 2.819996622760558,
			//   percentile(…, 30) = 1.7999999999999998 (interpolated, n=7)
			const t = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
			const y = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3];
			mockColumns[1] = { type: 'number', getData: () => t };
			mockColumns[2] = { getData: () => y };
			const [result, valid] = await movinganalysis({
				...baseArgs,
				xIN: 1,
				yIN: [2],
				windowSize: 7,
				stepSize: 7,
				analysis: 'summary',
				summaryPercentile: 30
			});
			expect(valid).toBe(true);
			const per = result.y_results[2];
			expect(per.mean.length).toBe(result.bins.length);
			expect(per.mean[0]).toBeCloseTo(3.5714285714285716, 12);
			expect(per.sd[0]).toBeCloseTo(2.819996622760558, 12);
			expect(per.percentile[0]).toBeCloseTo(1.7999999999999998, 12);
			// Real numbers, not NaN — the regression the trend mode shipped with.
			for (const k of ['mean', 'sd', 'percentile']) {
				expect(per[k].every((v) => Number.isFinite(v))).toBe(true);
			}
		});

		it('percentile defaults to 50 and equals the window median exactly', async () => {
			const t = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
			const y = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3];
			mockColumns[1] = { type: 'number', getData: () => t };
			mockColumns[2] = { getData: () => y };
			const args = {
				...baseArgs,
				xIN: 1,
				yIN: [2],
				windowSize: 7,
				stepSize: 7,
				analysis: 'summary'
			};
			delete args.summaryPercentile;
			const [result] = await movinganalysis(args);
			// median of [3,1,4,1,5,9,2] is 3
			expect(result.y_results[2].percentile[0]).toBe(3);
		});

		it('drops blank-string cells as missing data, not zeros (v72.28 rule)', async () => {
			// y[3] is a blank cell; the window's stats must be those of the SIX
			// remaining values [3,1,4,5,9,2] (numpy: mean 4, sd 2.8284271247461903,
			// p30 2.5) — a fabricated 0 would drag the mean to 3.428…
			const t = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
			const y = [3, 1, 4, '', 5, 9, 2, 6, 5, 3];
			mockColumns[1] = { type: 'number', getData: () => t };
			mockColumns[2] = { getData: () => y };
			const [result, valid] = await movinganalysis({
				...baseArgs,
				xIN: 1,
				yIN: [2],
				windowSize: 7,
				stepSize: 7,
				analysis: 'summary',
				summaryPercentile: 30
			});
			expect(valid).toBe(true);
			const per = result.y_results[2];
			expect(per.mean[0]).toBeCloseTo(4, 12);
			expect(per.sd[0]).toBeCloseTo(2.8284271247461903, 12);
			expect(per.percentile[0]).toBeCloseTo(2.5, 12);
		});

		it('a window with too few valid points stays NaN', async () => {
			// Last window [6,9) holds only 2 samples (t=7 is missing) → below the
			// 3-point minimum every analysis shares → NaN, not a 2-point stat.
			const t = [0, 1, 2, 3, 4, 5, 6, 8, 9];
			const y = [3, 1, 4, 1, 5, 9, 2, 6, 5];
			mockColumns[1] = { type: 'number', getData: () => t };
			mockColumns[2] = { getData: () => y };
			const [result] = await movinganalysis({
				...baseArgs,
				xIN: 1,
				yIN: [2],
				windowSize: 3,
				stepSize: 3,
				analysis: 'summary'
			});
			const per = result.y_results[2];
			expect(result.bins.length).toBe(3); // windows [0,3), [3,6), [6,9)
			expect(Number.isFinite(per.mean[0])).toBe(true); // 3 pts
			expect(Number.isFinite(per.mean[1])).toBe(true); // 3 pts
			expect(Number.isNaN(per.mean[2])).toBe(true); // 2 pts (t=6, 8)
		});
	});

	describe('skipped-window warnings', () => {
		it('reports how many windows the logarithmic trend model skipped, and why', async () => {
			// Window [0,10) contains t = 0, which ln() cannot take → skipped.
			// Window [10,20) is clean → fitted. The user must be TOLD about the
			// blank window rather than left to guess.
			const t = Array.from({ length: 30 }, (_, i) => i);
			const y = t.map((ti) => 3 + 2 * Math.log(ti + 1));
			mockColumns[1] = { type: 'number', getData: () => t };
			mockColumns[2] = { getData: () => y };
			const [result, valid] = await movinganalysis({
				...baseArgs,
				xIN: 1,
				yIN: [2],
				windowSize: 10,
				stepSize: 10,
				analysis: 'trend',
				trendModel: 'logarithmic'
			});
			expect(valid).toBe(true);
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]).toContain('1 of 2 windows');
			expect(result.warnings[0]).toContain('logarithmic');
			expect(result.warnings[0]).toContain('greater than 0');
			// The clean window still produced a fit; the skipped one is blank.
			const per = result.y_results[2];
			expect(Number.isNaN(per.a[0])).toBe(true);
			expect(Number.isFinite(per.a[1])).toBe(true);
		});

		it('names the series when several y inputs are wired', async () => {
			const t = Array.from({ length: 30 }, (_, i) => i + 1); // all positive: x is fine
			const yBad = t.map((ti) => ti - 5); // crosses 0 → exponential refusals
			const yGood = t.map((ti) => 2 * Math.exp(0.05 * ti));
			mockColumns[1] = { type: 'number', getData: () => t };
			mockColumns[2] = { getData: () => yBad, name: 'activity' };
			mockColumns[3] = { getData: () => yGood, name: 'temp' };
			const [result] = await movinganalysis({
				...baseArgs,
				xIN: 1,
				yIN: [2, 3],
				windowSize: 10,
				stepSize: 10,
				analysis: 'trend',
				trendModel: 'exponential'
			});
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]).toContain('for activity');
			expect(result.warnings[0]).toContain('exponential');
		});

		it('reports no warnings when every window computes', async () => {
			const t = Array.from({ length: 30 }, (_, i) => i);
			const y = t.map((ti) => 2 * ti + 1);
			mockColumns[1] = { type: 'number', getData: () => t };
			mockColumns[2] = { getData: () => y };
			const [result] = await movinganalysis({
				...baseArgs,
				xIN: 1,
				yIN: [2],
				windowSize: 10,
				stepSize: 10,
				analysis: 'trend',
				trendModel: 'linear'
			});
			expect(result.warnings).toEqual([]);
		});
	});
});
