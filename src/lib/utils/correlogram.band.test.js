// @ts-nocheck
/**
 * SPEC-U2 (2026-10-03 review, "possible issue, not confirmed"): the Correlogram plot draws a
 * significance band of +/-1.96/sqrt(n) (Correlogram.svelte confidenceBounds), but
 * computeAutocorrelation normalises each lag by its own pair count (N - k), and the band
 * ignores Bartlett's formula.
 *
 * Verdict: CONFIRMED. Decision (David, 2026-11-01): the plot draws Bartlett's band by default
 * (utils/correlogram.js correlogramBand), with +/-z/sqrt(N) and +/-z/sqrt(N - k) as options; a
 * plot saved before the choice keeps +/-z/sqrt(N) (correlogramBandMethodOf). The tests at the
 * end pin the app's band to statsmodels.
 *
 *  1. The estimator IS the "adjusted" (N - k) ACF: it matches statsmodels 0.14.6
 *     `acf(y, adjusted=True)` to 1e-10 below. For i.i.d. noise its lag-k value is a mean of
 *     N - k products over the variance, so its standard error is about 1 / sqrt(N - k), not
 *     1 / sqrt(N). At lag N/2 (the default window end) that is sqrt(2) times the band, so pure
 *     white noise crosses the fixed band well over 5% of the time at long lags: measured below.
 *  2. Bartlett's large-lag formula (Bartlett 1946, J. R. Statist. Soc. Suppl. 8:27-41), Var r_k ~ (1 + 2 sum_{j<k} r_j^2) / N, is what statsmodels
 *     uses for its confidence band (`bartlett_confint=True`, the default); for a rhythmic or
 *     autocorrelated series it is much wider than 1/sqrt(N), so the fixed band overstates
 *     significance at the lags a user reads (the 24 h peak).
 */
import { describe, it, expect } from 'vitest';
import {
	computeAutocorrelation,
	correlogramBand,
	correlogramBandMethodOf,
	CORRELOGRAM_BAND_METHODS
} from './correlogram.js';

// AR(1) phi 0.6 series, n = 60, rounded to 4 dp (numpy default_rng(20261028)).
const Y = [
	-0.203, -0.7489, -0.6957, -0.2224, -1.1543, 0.4186, 0.9126, 0.6657, 1.0486, -0.1881, -0.6205,
	0.1556, -0.7476, 0.2562, 0.9801, 1.2169, 1.0958, 2.7993, 1.7758, 0.9958, 0.6739, 0.4569, 0.7828,
	-0.1658, -1.5633, -1.6019, -0.21, -0.7788, 0.1868, 1.5185, -0.4651, 0.9492, 0.9915, 0.9646,
	0.5464, 1.7662, 0.1154, 0.6045, -0.1982, -1.4343, -1.2084, -0.3175, 1.0623, 2.3772, 1.5374,
	0.0193, -0.68, -2.0954, 0.8814, 0.268, -0.9083, -0.8967, -0.9305, -2.104, -2.2335, -2.6442,
	-1.2289, 1.5044, 0.9072, -0.6847
];
// statsmodels.tsa.stattools.acf(Y, nlags=29, adjusted=True): lags 0..5 and 29.
const SM_ADJUSTED = [
	1.0, 0.57531156285, 0.248908200503, 0.067673153108, -0.120548582851, -0.113026259362
];
const SM_ADJUSTED_LAG29 = 0.25935853317952096;
// acf(Y, nlags=29, alpha=0.05, bartlett_confint=True) half-widths at lags 1..5 and 29.
const SM_BARTLETT = [0.253030262376, 0.324045249095, 0.335288744745, 0.33607705241, 0.338480053554];
const SM_BARTLETT_LAG29 = 0.40313438399188495;

const Z = 1.959963984540054;

function lcg(seed) {
	let s = seed;
	const rnd = () => {
		s = (1103515245 * s + 12345) % 2147483648;
		return s / 2147483648;
	};
	return () => {
		const u = rnd() || 1e-12;
		const v = rnd();
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
	};
}

/** Bartlett half-width (1.96 x SE) at each lag from the correlations (N-normalised). */
function bartlettHalfWidth(rUnadj, n) {
	const out = [0];
	let acc = 0;
	for (let k = 1; k < rUnadj.length; k++) {
		out.push(Z * Math.sqrt((1 + 2 * acc) / n));
		acc += rUnadj[k] ** 2;
	}
	return out;
}

describe('SPEC-U2: the correlogram band', () => {
	it('the estimator is the (N - k)-normalised ACF of statsmodels acf(adjusted=True)', () => {
		const t = Y.map((_, i) => i);
		const r = computeAutocorrelation(t, Y, null, 29);
		for (let k = 0; k < SM_ADJUSTED.length; k++)
			expect(r.correlations[k]).toBeCloseTo(SM_ADJUSTED[k], 10);
		expect(r.correlations[29]).toBeCloseTo(SM_ADJUSTED_LAG29, 10);
	});

	it('Bartlett half-width (statsmodels) is wider than the fixed 1.96/sqrt(n) at lag >= 2', () => {
		const t = Y.map((_, i) => i);
		const r = computeAutocorrelation(t, Y, null, 29);
		const n = Y.length;
		// N-normalised correlations from the adjusted ones.
		const rU = r.correlations.map((c, k) => (c * (n - k)) / n);
		const hw = bartlettHalfWidth(rU, n);
		for (let k = 1; k <= 5; k++) expect(hw[k]).toBeCloseTo(SM_BARTLETT[k - 1], 9);
		expect(hw[29]).toBeCloseTo(SM_BARTLETT_LAG29, 9);
		const fixed = Z / Math.sqrt(n); // what the plot draws
		expect(fixed).toBeCloseTo(SM_BARTLETT[0], 9);
		expect(hw[29] / fixed).toBeGreaterThan(1.5);
	});

	it('white noise crosses the fixed band about 5% at short lags but far more at long lags', () => {
		// 300 records of 240 hourly white-noise samples; the default window ends at lag 119.
		const gauss = lcg(97);
		const n = 240;
		const t = Array.from({ length: n }, (_, i) => i);
		const band = Z / Math.sqrt(n);
		let shortHits = 0;
		let shortTot = 0;
		let longHits = 0;
		let longTot = 0;
		for (let rec = 0; rec < 300; rec++) {
			const y = t.map(() => gauss());
			const { correlations } = computeAutocorrelation(t, y);
			for (let k = 1; k <= 24; k++) {
				shortTot++;
				if (Math.abs(correlations[k]) > band) shortHits++;
			}
			for (let k = 96; k < correlations.length; k++) {
				longTot++;
				if (Math.abs(correlations[k]) > band) longHits++;
			}
		}
		const short = shortHits / shortTot;
		const long = longHits / longTot;
		process.stderr.write(
			`SPEC-U2 white-noise exceedance: lags 1-24 ${short.toFixed(3)}, lags 96-119 ${long.toFixed(3)}\n`
		);
		// Expected from SE ~ 1 / sqrt(N - k): about 0.05 to 0.07 at k <= 24 and 0.13 to 0.16 at
		// k = 96..119.
		expect(short).toBeGreaterThan(0.03);
		expect(short).toBeLessThan(0.08);
		expect(long).toBeGreaterThan(0.1);
	});
});

describe('the app band (correlogramBand), pinned to statsmodels 0.14.6', () => {
	const t = Y.map((_, i) => i);
	const n = Y.length;
	// statsmodels' z is norm.ppf(0.975); the app's is the 1.96 the plot has always used, so the
	// STANDARD ERRORS are compared (half-width / z), which pins the formula itself.
	const smSE = (hw) => hw / Z;

	it('Bartlett: the SE at lags 1..5 and 29 equals statsmodels acf(bartlett_confint=True)', () => {
		const acf = computeAutocorrelation(t, Y, null, 29);
		const { upper, lower } = correlogramBand(acf, { method: 'bartlett', level: 0.95 });
		for (let k = 1; k <= 5; k++) expect(upper[k] / 1.96).toBeCloseTo(smSE(SM_BARTLETT[k - 1]), 12);
		expect(upper[29] / 1.96).toBeCloseTo(smSE(SM_BARTLETT_LAG29), 12);
		expect(lower[29]).toBe(-upper[29]);
		// Lag 0 has no band (statsmodels gives it zero width: r_0 = 1 is not estimated).
		expect(upper[0]).toBeNaN();
	});

	it('Bartlett with a min lag sums r_j from lag 1 (the full correlogram), not from the window', () => {
		const full = computeAutocorrelation(t, Y, null, 29);
		const win = computeAutocorrelation(t, Y, null, 29, 10);
		const band = correlogramBand(win, { method: 'bartlett', full });
		expect(win.lags[0]).toBe(10);
		expect(band.upper[win.lags.length - 1] / 1.96).toBeCloseTo(smSE(SM_BARTLETT_LAG29), 12);
		// Without the full correlogram the sum would start at the window: narrower.
		const short = correlogramBand(win, { method: 'bartlett' });
		expect(short.upper.at(-1)).toBeLessThan(band.upper.at(-1));
	});

	it('+/-z/sqrt(N - k) uses the pairs at each lag; +/-z/sqrt(N) is flat at every lag', () => {
		const acf = computeAutocorrelation(t, Y, null, 29);
		const nk = correlogramBand(acf, { method: 'nk' });
		expect(nk.upper[0]).toBeCloseTo(1.96 / Math.sqrt(n), 15);
		expect(nk.upper[29]).toBeCloseTo(1.96 / Math.sqrt(n - 29), 15);
		const white = correlogramBand(acf, { method: 'white', level: 0.99 });
		expect(new Set(white.upper).size).toBe(1);
		expect(white.upper[7]).toBeCloseTo(2.576 / Math.sqrt(n), 15);
		// The plot's N for this band has always been the y values present.
		expect(correlogramBand(acf, { method: 'white', nWhite: 50 }).upper[3]).toBeCloseTo(
			1.96 / Math.sqrt(50),
			15
		);
		// Under two values the old band was 0 at every lag.
		expect(correlogramBand(acf, { method: 'white', nWhite: 1 }).upper[3]).toBe(0);
	});

	it('the band a series draws: its own choice, else +/-z/sqrt(N) when saved before the choice, else Bartlett', () => {
		expect(CORRELOGRAM_BAND_METHODS).toEqual(['bartlett', 'white', 'nk']);
		for (const m of CORRELOGRAM_BAND_METHODS)
			expect(correlogramBandMethodOf({ bandMethod: m, showConfidenceBounds: true })).toBe(m);
		// A saved series (every one has carried showConfidenceBounds since the plot was added).
		expect(correlogramBandMethodOf({ showConfidenceBounds: true, confidenceLevel: 0.95 })).toBe(
			'white'
		);
		expect(correlogramBandMethodOf({ showConfidenceBounds: false })).toBe('white');
		// A new series from a quick plot, the MCP or an AI edit names only its columns.
		expect(correlogramBandMethodOf({ x: { refId: 1 }, y: { refId: 2 } })).toBe('bartlett');
		expect(correlogramBandMethodOf(undefined)).toBe('bartlett');
		expect(correlogramBandMethodOf({ bandMethod: 'bogus', showConfidenceBounds: true })).toBe(
			'white'
		);
	});
});
