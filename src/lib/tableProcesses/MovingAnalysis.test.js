import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: { set: vi.fn(), get: vi.fn(), has: vi.fn() } },
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
vi.mock('$lib/core/core.svelte.js', () => ({ pushObj: vi.fn() }));
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

vi.mock('$lib/utils/cosinor.js', () => ({
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
		harmonics: [{ k: 1, amplitude: 3, acrophase_hrs: 6.25, phi_rad: 0, CI_A: [0, 0], CI_acrophase: [0, 0] }],
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

describe('getStatKeys', () => {
	it('returns periodogram stats', () => {
		expect(getStatKeys({ analysis: 'periodogram' })).toEqual(['peak_period', 'peak_power']);
	});

	it('returns fixed cosinor stats with expected harmonic keys', () => {
		const keys = getStatKeys({ analysis: 'cosinor', useFixedPeriod: true, nHarmonics: 2 });
		expect(keys).toContain('mesor');
		expect(keys).toContain('H1_amplitude');
		expect(keys).toContain('H2_acrophase');
		expect(keys).toContain('r2');
		expect(keys).toContain('rmse');
		expect(keys).toContain('pvalue');
	});

	it('returns free cosinor stats scaled by Ncurves', () => {
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

describe('movinganalysis', () => {
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

	it('returns invalid when inputs are missing', () => {
		const [, valid] = movinganalysis({ ...baseArgs });
		expect(valid).toBe(false);
	});

	it('returns invalid when data span is shorter than the window', () => {
		const t = [0, 1, 2, 3, 4]; // 4 hrs total
		const y = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };
		const [, valid] = movinganalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			windowSize: 48,
			stepSize: 12
		});
		expect(valid).toBe(false);
	});

	it('produces one bin per window for periodogram and picks peak near 24h', () => {
		const n = 240; // 240 samples, 1 hr apart → 240 hrs
		const t = Array.from({ length: n }, (_, i) => i);
		const y = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };

		const [result, valid] = movinganalysis({
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

	it('labels bin at window start when binLabel=start', () => {
		const n = 120;
		const t = Array.from({ length: n }, (_, i) => i);
		const y = t.map((ti) => Math.sin((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };

		const [result] = movinganalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			windowSize: 48,
			stepSize: 24,
			binLabel: 'start'
		});
		expect(result.bins[0]).toBeCloseTo(0, 6);
	});

	it('runs fixed-cosinor analysis and fills amplitude/mesor arrays', () => {
		const n = 240;
		const t = Array.from({ length: n }, (_, i) => i);
		const y = t.map((ti) => 1.5 + 3 * Math.cos((2 * Math.PI * (ti - 6.25)) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };

		const [result, valid] = movinganalysis({
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
});
