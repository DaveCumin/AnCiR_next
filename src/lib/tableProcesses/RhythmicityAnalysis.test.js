import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockColumns, rawDataStore } = vi.hoisted(() => ({
	mockColumns: {},
	rawDataStore: new Map()
}));
vi.mock('$lib/core/core.svelte', () => ({
	core: {
		rawData: {
			set: (k, v) => rawDataStore.set(k, v),
			get: (k) => rawDataStore.get(k),
			has: (k) => rawDataStore.has(k),
			delete: (k) => rawDataStore.delete(k)
		}
	},
	appConsts: { processMap: new Map() },
	pushObj: vi.fn()
}));
vi.mock('$lib/core/core.svelte.js', () => ({
	core: {
		rawData: {
			set: (k, v) => rawDataStore.set(k, v),
			get: (k) => rawDataStore.get(k),
			has: (k) => rawDataStore.has(k),
			delete: (k) => rawDataStore.delete(k)
		}
	},
	appConsts: { processMap: new Map() },
	pushObj: vi.fn()
}));
vi.mock('$lib/core/Column.svelte', () => ({
	Column: class {},
	getColumnById: (id) => mockColumns[id],
	removeColumn: vi.fn()
}));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/StoreValueButton.svelte', () => ({ default: {} }));
vi.mock('$lib/components/LoadingSpinner.svelte', () => ({ default: {} }));
vi.mock('$lib/components/plotbits/helpers/save.svelte.js', () => ({
	showStaticDataAsTable: vi.fn(),
	saveStaticDataAsCSV: vi.fn()
}));

vi.mock('$lib/utils/periodogram.js', () => ({
	runPeriodogramCalculation: vi.fn((params) => {
		const xs = [];
		const ys = [];
		for (let p = params.periodMin; p <= params.periodMax + 1e-9; p += params.periodSteps) {
			xs.push(p);
			ys.push(10 - Math.abs(p - 24));
		}
		return { x: xs, y: ys, threshold: [], pvalue: [] };
	})
}));

vi.mock('$lib/utils/fft.js', () => ({
	computeFFT: vi.fn(() => ({
		frequencies: [0, 1 / 24, 1 / 12, 1 / 8],
		magnitudes: [0, 5, 1, 0.5],
		phases: [0, 0.1, 0.2, 0.3],
		samplingRate: 1,
		nyquistFreq: 0.5,
		minPeriod: 2
	}))
}));

vi.mock('$lib/utils/correlogram.js', () => ({
	computeAutocorrelation: vi.fn(() => ({
		lags: [0, 12, 24, 36],
		correlations: [1, -0.2, 0.8, -0.1],
		dt: 1
	}))
}));

vi.mock('$lib/utils/cosinor.js', () => ({
	fitCosineCurves: vi.fn(() => ({
		parameters: {
			cosines: [{ amplitude: 2, frequency: (2 * Math.PI) / 24, phase: 0.3 }],
			O: 1
		},
		fitted: [1, 1.5, 2, 1.5],
		rmse: 0.2,
		rSquared: 0.95
	})),
	fitCosinorFixed: vi.fn(() => ({
		M: 1.5,
		harmonics: [
			{ k: 1, amplitude: 3, acrophase_hrs: 6.25, phi_rad: 0, CI_A: [0, 0], CI_acrophase: [0, 0] }
		],
		fitted: [1, 2, 3, 2],
		R2: 0.9,
		RMSE: 0.15,
		pF: 0.001,
		F_stat: 99,
		df: [2, 45]
	}))
}));

import {
	rhythmicityanalysis,
	getOutputKeys,
	getStatKeys,
	getPrimaryKeys
} from './RhythmicityAnalysis.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	rawDataStore.clear();
});

describe('getOutputKeys', () => {
	it('returns period/power for Lomb-Scargle periodogram', () => {
		expect(getOutputKeys({ analysis: 'periodogram', pgMethod: 'Lomb-Scargle' })).toEqual([
			'period',
			'power'
		]);
	});

	it('adds threshold for Chi-squared periodogram', () => {
		expect(getOutputKeys({ analysis: 'periodogram', pgMethod: 'Chi-squared' })).toEqual([
			'period',
			'power',
			'threshold'
		]);
	});

	it('returns fft outputs', () => {
		expect(getOutputKeys({ analysis: 'fft' })).toEqual([
			'frequency',
			'period',
			'magnitude',
			'phase'
		]);
	});

	it('returns correlogram outputs', () => {
		expect(getOutputKeys({ analysis: 'correlogram' })).toEqual(['lag', 'correlation']);
	});

	it('returns cosinor outputs', () => {
		expect(getOutputKeys({ analysis: 'cosinor', useFixedPeriod: true })).toEqual([
			'time',
			'fitted'
		]);
	});
});

describe('getStatKeys', () => {
	it('returns peak stats for periodogram', () => {
		expect(getStatKeys({ analysis: 'periodogram' })).toEqual(['peak_period', 'peak_power']);
	});

	it('returns fft peak stats', () => {
		expect(getStatKeys({ analysis: 'fft' })).toEqual([
			'peak_period',
			'peak_frequency',
			'peak_magnitude'
		]);
	});

	it('returns correlogram peak stats', () => {
		expect(getStatKeys({ analysis: 'correlogram' })).toEqual(['peak_lag', 'peak_correlation']);
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
		const keys = getStatKeys({ analysis: 'cosinor', useFixedPeriod: false, Ncurves: 2 });
		expect(keys).toContain('C1_period');
		expect(keys).toContain('C2_amplitude');
		expect(keys).toContain('r2');
	});
});

describe('rhythmicityanalysis', () => {
	const baseArgs = {
		xIN: -1,
		yIN: [],
		analysis: 'periodogram',
		pgMethod: 'Lomb-Scargle',
		periodMin: 20,
		periodMax: 28,
		periodStep: 0.5,
		pgBinSize: 0.25,
		pgAlpha: 0.05,
		fftFreqStep: 0,
		corrMaxLag: 0,
		useFixedPeriod: true,
		fixedPeriod: 24,
		nHarmonics: 1,
		Ncurves: 1,
		alpha: 0.05,
		out: {},
		preProcesses: []
	};

	it('returns invalid when inputs are missing', () => {
		const [, valid] = rhythmicityanalysis({ ...baseArgs });
		expect(valid).toBe(false);
	});

	it('returns invalid when data has fewer than 3 points', () => {
		mockColumns[1] = { type: 'number', getData: () => [0, 1] };
		mockColumns[2] = { getData: () => [0.1, 0.2] };
		const [, valid] = rhythmicityanalysis({ ...baseArgs, xIN: 1, yIN: [2] });
		expect(valid).toBe(false);
	});

	it('runs periodogram and picks peak near 24h', () => {
		const n = 100;
		const t = Array.from({ length: n }, (_, i) => i);
		const y = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };

		const [result, valid] = rhythmicityanalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			analysis: 'periodogram'
		});
		expect(valid).toBe(true);
		const r = result.y_results[2];
		expect(r.outputs.period.length).toBeGreaterThan(0);
		expect(r.outputs.power.length).toBe(r.outputs.period.length);
		expect(r.stats.peak_period).toBeCloseTo(24, 1);
		expect(r.stats.peak_power).toBeCloseTo(10, 1);
	});

	it('runs fft and populates frequency/period/magnitude/phase arrays', () => {
		const t = Array.from({ length: 48 }, (_, i) => i);
		const y = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };

		const [result, valid] = rhythmicityanalysis({ ...baseArgs, xIN: 1, yIN: [2], analysis: 'fft' });
		expect(valid).toBe(true);
		const r = result.y_results[2];
		expect(r.outputs.frequency).toEqual([0, 1 / 24, 1 / 12, 1 / 8]);
		expect(r.outputs.magnitude).toEqual([0, 5, 1, 0.5]);
		expect(r.outputs.phase).toEqual([0, 0.1, 0.2, 0.3]);
		// period = 1/freq (NaN for freq=0)
		expect(r.outputs.period[0]).toBeNaN();
		expect(r.outputs.period[1]).toBeCloseTo(24, 6);
		expect(r.stats.peak_frequency).toBeCloseTo(1 / 24, 6);
		expect(r.stats.peak_period).toBeCloseTo(24, 6);
		expect(r.stats.peak_magnitude).toBe(5);
	});

	it('runs correlogram and picks peak correlation away from lag 0', () => {
		const t = Array.from({ length: 48 }, (_, i) => i);
		const y = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };

		const [result, valid] = rhythmicityanalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			analysis: 'correlogram'
		});
		expect(valid).toBe(true);
		const r = result.y_results[2];
		expect(r.outputs.lag).toEqual([0, 12, 24, 36]);
		expect(r.outputs.correlation).toEqual([1, -0.2, 0.8, -0.1]);
		// peak picks the largest correlation starting from index 1 → lag 24, corr 0.8
		expect(r.stats.peak_lag).toBe(24);
		expect(r.stats.peak_correlation).toBe(0.8);
	});

	it('runs fixed cosinor and fills mesor/amplitude stats', () => {
		const t = Array.from({ length: 48 }, (_, i) => i);
		const y = t.map((ti) => 1.5 + 3 * Math.cos((2 * Math.PI * (ti - 6.25)) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };

		const [result, valid] = rhythmicityanalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			analysis: 'cosinor',
			useFixedPeriod: true,
			nHarmonics: 1
		});
		expect(valid).toBe(true);
		const r = result.y_results[2];
		expect(r.outputs.time.length).toBe(48);
		expect(r.outputs.fitted).toEqual([1, 2, 3, 2]);
		expect(r.stats.mesor).toBe(1.5);
		expect(r.stats.H1_amplitude).toBe(3);
		expect(r.stats.H1_acrophase).toBeCloseTo(6.25, 6);
		expect(r.stats.r2).toBe(0.9);
		expect(r.stats.rmse).toBe(0.15);
		expect(r.stats.pvalue).toBe(0.001);
	});

	it('runs free cosinor and fills C1 period/amplitude/phase stats', () => {
		const t = Array.from({ length: 48 }, (_, i) => i);
		const y = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };

		const [result, valid] = rhythmicityanalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			analysis: 'cosinor',
			useFixedPeriod: false,
			Ncurves: 1
		});
		expect(valid).toBe(true);
		const r = result.y_results[2];
		expect(r.outputs.fitted).toEqual([1, 1.5, 2, 1.5]);
		expect(r.stats.C1_period).toBeCloseTo(24, 6);
		expect(r.stats.C1_amplitude).toBe(2);
		expect(r.stats.C1_phase).toBe(0.3);
		expect(r.stats.r2).toBe(0.95);
		expect(r.stats.rmse).toBe(0.2);
	});

	it('handles multiple Y inputs independently', () => {
		const t = Array.from({ length: 48 }, (_, i) => i);
		const y1 = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24));
		const y2 = t.map((ti) => Math.sin((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y1 };
		mockColumns[3] = { getData: () => y2 };

		const [result, valid] = rhythmicityanalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2, 3],
			analysis: 'periodogram'
		});
		expect(valid).toBe(true);
		expect(result.y_results[2]).toBeDefined();
		expect(result.y_results[3]).toBeDefined();
		expect(result.outputKeys).toEqual(['period', 'power']);
		expect(result.statKeys).toEqual(['peak_period', 'peak_power']);
	});

	it('skips rows where x or y is NaN', () => {
		const t = [0, 1, NaN, 3, 4, 5, 6, 7, 8, 9];
		const y = [0.1, 0.2, 0.3, NaN, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };

		const [, valid] = rhythmicityanalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			analysis: 'periodogram'
		});
		// 8 valid pairs is enough for periodogram
		expect(valid).toBe(true);
	});
});

describe('getPrimaryKeys', () => {
	it('returns period/power for periodogram', () => {
		expect(getPrimaryKeys({ analysis: 'periodogram' })).toEqual({ x: 'period', y: 'power' });
	});
	it('returns period/magnitude for fft', () => {
		expect(getPrimaryKeys({ analysis: 'fft' })).toEqual({ x: 'period', y: 'magnitude' });
	});
	it('returns lag/correlation for correlogram', () => {
		expect(getPrimaryKeys({ analysis: 'correlogram' })).toEqual({ x: 'lag', y: 'correlation' });
	});
	it('returns time/fitted for cosinor', () => {
		expect(getPrimaryKeys({ analysis: 'cosinor' })).toEqual({ x: 'time', y: 'fitted' });
	});
});

describe('rhythmicityanalysis — collected mode (shared X + per-Y primary Y)', () => {
	const baseArgs = {
		xIN: -1,
		yIN: [],
		analysis: 'periodogram',
		pgMethod: 'Lomb-Scargle',
		periodMin: 20,
		periodMax: 28,
		periodStep: 0.5,
		pgBinSize: 0.25,
		pgAlpha: 0.05,
		fftFreqStep: 0,
		corrMaxLag: 0,
		useFixedPeriod: true,
		fixedPeriod: 24,
		nHarmonics: 1,
		Ncurves: 1,
		alpha: 0.05,
		out: {},
		preProcesses: []
	};

	it('writes one shared X and one Y per input (periodogram)', () => {
		const t = Array.from({ length: 48 }, (_, i) => i);
		const y1 = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24));
		const y2 = t.map((ti) => Math.sin((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y1 };
		mockColumns[3] = { getData: () => y2 };
		// Pre-create collected-mode output columns
		mockColumns[100] = { data: 100, type: 'number' };
		mockColumns[101] = { data: 101, type: 'number' };
		mockColumns[102] = { data: 102, type: 'number' };

		const [, valid] = rhythmicityanalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2, 3],
			out: { rhythmicityx: 100, rhythmicityy_2: 101, rhythmicityy_3: 102 },
			analysis: 'periodogram'
		});
		expect(valid).toBe(true);
		// shared X is the periodogram period array
		const xData = rawDataStore.get(100);
		expect(Array.isArray(xData)).toBe(true);
		expect(xData[0]).toBeCloseTo(20, 6);
		// per-Y Y is the power array
		expect(rawDataStore.has(101)).toBe(true);
		expect(rawDataStore.has(102)).toBe(true);
		expect(rawDataStore.get(101).length).toBe(xData.length);
		// collected-mode writes DO NOT write any per-Y per-key columns
		expect(rawDataStore.size).toBe(3);
	});

	it('writes period (not frequency) as shared X for fft', () => {
		const t = Array.from({ length: 48 }, (_, i) => i);
		const y = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };
		mockColumns[100] = { data: 100, type: 'number' };
		mockColumns[101] = { data: 101, type: 'number' };

		const [, valid] = rhythmicityanalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			out: { rhythmicityx: 100, rhythmicityy_2: 101 },
			analysis: 'fft'
		});
		expect(valid).toBe(true);
		const xData = rawDataStore.get(100);
		// frequencies [0, 1/24, 1/12, 1/8] → periods [NaN, 24, 12, 8]
		expect(xData[0]).toBeNaN();
		expect(xData[1]).toBeCloseTo(24, 6);
		// Y is the magnitude array [0, 5, 1, 0.5]
		expect(rawDataStore.get(101)).toEqual([0, 5, 1, 0.5]);
	});

	it('writes lag/correlation as shared X + per-Y for correlogram', () => {
		const t = Array.from({ length: 48 }, (_, i) => i);
		const y = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };
		mockColumns[100] = { data: 100, type: 'number' };
		mockColumns[101] = { data: 101, type: 'number' };

		const [, valid] = rhythmicityanalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			out: { rhythmicityx: 100, rhythmicityy_2: 101 },
			analysis: 'correlogram'
		});
		expect(valid).toBe(true);
		expect(rawDataStore.get(100)).toEqual([0, 12, 24, 36]);
		expect(rawDataStore.get(101)).toEqual([1, -0.2, 0.8, -0.1]);
	});

	it('writes time/fitted for cosinor, keeping number type when input X is numeric', () => {
		const t = Array.from({ length: 48 }, (_, i) => i);
		const y = t.map((ti) => 1.5 + 3 * Math.cos((2 * Math.PI * (ti - 6.25)) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };
		mockColumns[100] = { data: 100, type: 'number' };
		mockColumns[101] = { data: 101, type: 'number' };

		const [, valid] = rhythmicityanalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			out: { rhythmicityx: 100, rhythmicityy_2: 101 },
			analysis: 'cosinor',
			useFixedPeriod: true
		});
		expect(valid).toBe(true);
		// fitted comes from the mock
		expect(rawDataStore.get(101)).toEqual([1, 2, 3, 2]);
		// X is the input times (since xIN is number-type, no ms conversion)
		expect(mockColumns[100].type).toBe('number');
	});

	it('converts shared X to ms + marks time-typed for cosinor when input X is time', () => {
		const originMs = 1_700_000_000_000;
		const t = Array.from({ length: 48 }, (_, i) => i); // hoursSinceStart
		const tMs = Array.from({ length: 48 }, (_, i) => originMs + i * 3600000);
		const y = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'time', hoursSinceStart: t, getData: () => tMs };
		mockColumns[2] = { getData: () => y };
		mockColumns[100] = { data: 100, type: 'number' };
		mockColumns[101] = { data: 101, type: 'number' };

		const [, valid] = rhythmicityanalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			out: { rhythmicityx: 100, rhythmicityy_2: 101 },
			analysis: 'cosinor',
			useFixedPeriod: true
		});
		expect(valid).toBe(true);
		const xOut = rawDataStore.get(100);
		// First two entries should be originMs and originMs + 3_600_000
		expect(xOut[0]).toBe(originMs);
		expect(xOut[1]).toBe(originMs + 3600000);
		expect(mockColumns[100].type).toBe('time');
	});

	it('writes both standalone and collected keys when both are present', () => {
		const t = Array.from({ length: 48 }, (_, i) => i);
		const y = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };
		mockColumns[50] = { data: 50, type: 'number' };
		mockColumns[51] = { data: 51, type: 'number' };
		mockColumns[100] = { data: 100, type: 'number' };
		mockColumns[101] = { data: 101, type: 'number' };

		const [, valid] = rhythmicityanalysis({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			out: {
				'2_period': 50,
				'2_power': 51,
				rhythmicityx: 100,
				rhythmicityy_2: 101
			},
			analysis: 'periodogram'
		});
		expect(valid).toBe(true);
		// All four columns got written
		expect(rawDataStore.has(50)).toBe(true);
		expect(rawDataStore.has(51)).toBe(true);
		expect(rawDataStore.has(100)).toBe(true);
		expect(rawDataStore.has(101)).toBe(true);
	});
});
