// A free-period fit that ends on a bound of its range: rhythm at the edge, or no rhythm?
//
// Reported (v80.0): a free-period cosinor on an x in DAYS (0 to 3) fitted a 1-day rhythm
// beautifully (R² 0.997) but warned that "the data have no clear rhythm inside that range",
// because the period sat on the default lower limit, 1. Two faults: the range and the text
// assumed hours, and the text called every at-limit fit "no rhythm". boundFitIsStrong (see
// its comment in cosinor.js for the rule and the simulation behind it) separates the two
// cases; this file pins it on the author's case, on rhythms just past a limit, and on the
// non-rhythms that must keep the cautionary text, with one test per criterion.
import { describe, it, expect } from 'vitest';
import {
	fitCosineCurves,
	freePeriodFitWarnings,
	boundFitIsStrong,
	EDGE_FIT_MIN_R2,
	EDGE_FIT_MIN_CYCLES,
	FREE_PERIOD_DEFAULTS
} from './cosinor.js';
import { fitRectangularWave, rectWaveFitWarnings } from './rectwave.js';
import { doubleLogisticFitWarnings } from './doublelogistic.js';

function lcg(seed) {
	let s = seed;
	const rnd = () => {
		s = (s * 1103515245 + 12345) % 2147483648;
		return s / 2147483648;
	};
	return () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
}

/** The author's record: x 0 to 3 days every 30 min, a 1-day cosine, mesor 6.8, amp 0.45. */
function authorCase(noise = 0.02, seed = 3) {
	const gauss = lcg(seed);
	const t = Array.from({ length: 145 }, (_, i) => i / 48);
	const y = t.map((ti) => 6.8 + 0.45 * Math.cos(2 * Math.PI * (ti - 0.77)) + noise * gauss());
	return { t, y };
}

const strongArgs = (t, r, i = 0) => ({
	t,
	rSquared: r.rSquared,
	period: (2 * Math.PI) / r.parameters.cosines[i].frequency,
	side: r.diagnostics.atBound[i]
});

describe("the author's case: a strong 1-day rhythm on an x in days", () => {
	const { t, y } = authorCase();
	const r = fitCosineCurves(t, y, 1, FREE_PERIOD_DEFAULTS);

	it('reproduces the report: the fit is excellent and sits on the lower limit, 1', () => {
		expect(r.rSquared).toBeGreaterThan(0.99);
		expect((2 * Math.PI) / r.parameters.cosines[0].frequency).toBeCloseTo(1, 6);
		expect(r.diagnostics.atBound).toEqual(['min']);
		expect(boundFitIsStrong(strongArgs(t, r))).toBe(true);
	});

	it('says the period sits at the edge and to widen the range, never "no clear rhythm"', () => {
		const [msg, ...rest] = freePeriodFitWarnings(
			[{ label: '"result_2"', result: r, t }],
			'The free-period cosinor fit',
			{ unit: 'x units' }
		);
		expect(rest).toEqual([]);
		expect(msg).toMatch(
			/^The free-period cosinor fit for "result_2" found its best period at the lower limit of the period range: 1 x units, range 1 to 48 x units\. The fit is good \(R² 0\.99\d over 3 cycles\): the data have a rhythm/
		);
		expect(msg).toMatch(/the limit may be holding its period/);
		expect(msg).toMatch(/Lower the minimum period to confirm the period\.$/);
		expect(msg).not.toMatch(/no clear rhythm/);
		expect(msg).not.toMatch(/ h[,. ]/);
	});

	it('without x (an old caller) the warning stays the cautious one', () => {
		const [msg] = freePeriodFitWarnings([{ label: '"y"', result: r }]);
		expect(msg).toMatch(/stopped at the lower limit of the period range: 1 h, range 1 to 48 h\./);
		expect(msg).toMatch(/no clear rhythm/);
	});

	it('the same rule reaches the rectangular-wave wrapper', () => {
		const rw = fitRectangularWave(t, y, FREE_PERIOD_DEFAULTS);
		expect(rw.diagnostics.atBound).toEqual(['min']);
		const [msg] = rectWaveFitWarnings([{ label: '"y"', result: rw, t }], undefined, {
			unit: 'x units'
		});
		expect(msg).toMatch(/rectangular-wave fit for "y" found its best period at the lower limit/);
		expect(msg).toMatch(/1 x units, range 1 to 48 x units/);
	});

	it('and the double-logistic wrapper (it forwards R² and x)', () => {
		// A stand-in result shaped like fitDoubleLogistic's, on the bound at T = 1.
		const dl = {
			rSquared: r.rSquared,
			parameters: { T: 1 },
			diagnostics: { converged: true, iterations: 5, atBound: ['min'], periodRange: [1, 48] }
		};
		const [strong] = doubleLogisticFitWarnings([{ label: '"y"', result: dl, t }], undefined, {
			unit: 'x units'
		});
		expect(strong).toMatch(/double-logistic fit for "y" found its best period at the lower limit/);
		const [weak] = doubleLogisticFitWarnings([
			{ label: '"y"', result: { ...dl, rSquared: 0.1 }, t }
		]);
		expect(weak).toMatch(/no clear rhythm/);
	});
});

describe('a clean rhythm just PAST the limit is a rhythm at the edge, not "no rhythm"', () => {
	it('24 h rhythm, range 25 to 40 h: the fit stops at 25 and the advice is to lower it', () => {
		const t = Array.from({ length: 24 * 14 }, (_, i) => i * 0.5);
		const y = t.map((ti) => 3 * Math.cos((2 * Math.PI * ti) / 24));
		const r = fitCosineCurves(t, y, 1, { minPeriod: 25, maxPeriod: 40 });
		expect(r.diagnostics.atBound).toEqual(['min']);
		expect(boundFitIsStrong(strongArgs(t, r))).toBe(true);
		const [msg] = freePeriodFitWarnings([{ result: r, t }]);
		expect(msg).toMatch(/found its best period at the lower limit of the period range: 25 h/);
		expect(msg).toMatch(/Lower the minimum period/);
		// Further out (26 h, 8% past the rhythm) seven days of drift ruin the fit (R² 0.32):
		// that is the "no clear rhythm inside the range, widen it" case.
		const far = fitCosineCurves(t, y, 1, { minPeriod: 26, maxPeriod: 40 });
		expect(freePeriodFitWarnings([{ result: far, t }])[0]).toMatch(/no clear rhythm/);
	});

	it('20.5 h rhythm, range 1 to 20 h: the upper limit, and the advice is to raise it', () => {
		const t = Array.from({ length: 24 * 14 }, (_, i) => i * 0.5);
		const y = t.map((ti) => Math.cos((2 * Math.PI * ti) / 20.5));
		const r = fitCosineCurves(t, y, 1, { minPeriod: 1, maxPeriod: 20 });
		expect(r.diagnostics.atBound).toEqual(['max']);
		const [msg] = freePeriodFitWarnings([{ result: r, t }]);
		expect(msg).toMatch(/found its best period at the upper limit of the period range: 20 h/);
		expect(msg).toMatch(/Raise the maximum period to confirm the period\.$/);
	});
});

describe('fits that must keep "no clear rhythm"', () => {
	it('a linear trend pinned at the upper limit, despite its high R²', () => {
		const gauss = lcg(11);
		const t = Array.from({ length: 145 }, (_, i) => i / 48);
		const y = t.map((ti) => 6.8 + 0.3 * ti + 0.05 * gauss());
		const r = fitCosineCurves(t, y, 1, FREE_PERIOD_DEFAULTS);
		expect(r.diagnostics.atBound).toEqual(['max']);
		expect(r.rSquared).toBeGreaterThan(0.9); // R² alone would call this a rhythm
		expect(boundFitIsStrong(strongArgs(t, r))).toBe(false);
		const [msg] = freePeriodFitWarnings([{ label: '"y"', result: r, t }], undefined, {
			unit: 'x units'
		});
		expect(msg).toMatch(/stopped at the upper limit of the period range: 48 x units/);
		expect(msg).toMatch(/no clear rhythm/);
	});

	it('a 24 h rhythm far outside a 48 to 96 h range (a poor fit on the bound)', () => {
		const t = Array.from({ length: 24 * 14 }, (_, i) => i * 0.5);
		const y = t.map((ti) => 3 * Math.cos((2 * Math.PI * ti) / 24));
		const r = fitCosineCurves(t, y, 1, { minPeriod: 48, maxPeriod: 96 });
		expect(r.diagnostics.atBound).toEqual(['min']);
		expect(r.rSquared).toBeLessThan(0.3);
		expect(boundFitIsStrong(strongArgs(t, r))).toBe(false);
		expect(freePeriodFitWarnings([{ result: r, t }])[0]).toMatch(/no clear rhythm/);
	});

	it('a rhythm swamped by noise (R² under the threshold)', () => {
		const { t, y } = authorCase(0.9, 5);
		const r = fitCosineCurves(t, y, 1, FREE_PERIOD_DEFAULTS);
		if (r.diagnostics.atBound[0]) {
			expect(r.rSquared).toBeLessThan(EDGE_FIT_MIN_R2);
			expect(boundFitIsStrong(strongArgs(t, r))).toBe(false);
		}
		// On the author's x (3 cycles of 1), only R² decides: just under 0.4 is not enough.
		const at = (rSquared) => boundFitIsStrong({ t, rSquared, period: 1, side: 'min' });
		expect(at(0.4)).toBe(true);
		expect(at(0.39)).toBe(false);
	});

	it('a random walk: red noise whose slow wander a 2-cycle cosine fits with R² 0.31', () => {
		// The case that set 2.5 cycles: with 2, about one random walk in ten passed.
		const gauss = lcg(27);
		const t = Array.from({ length: 200 }, (_, i) => i);
		let w = 0;
		const y = t.map(() => (w += gauss()));
		const r = fitCosineCurves(t, y, 1, { minPeriod: 2, maxPeriod: 90 });
		expect(r.diagnostics.atBound).toEqual(['max']);
		expect(r.rSquared).toBeGreaterThan(0.3);
		expect(boundFitIsStrong(strongArgs(t, r))).toBe(false);
		expect(freePeriodFitWarnings([{ result: r, t }])[0]).toMatch(/no clear rhythm/);
	});

	it('fewer than 2.5 cycles of the fitted period in the record', () => {
		const { t } = authorCase();
		// A perfect fit, but at a period of 1.25 the 3-unit record holds only 2.4 cycles.
		const at = (period) => boundFitIsStrong({ t, rSquared: 0.99, period, side: 'min' });
		expect(at(1.2)).toBe(true); // 2.5 cycles
		expect(at(1.25)).toBe(false);
		expect(EDGE_FIT_MIN_CYCLES).toBe(2.5);
	});

	it('a lower bound already at the Nyquist period: there is no shorter period to widen to', () => {
		const { t } = authorCase();
		const nyq = 2 / 48;
		expect(boundFitIsStrong({ t, rSquared: 0.99, period: nyq, side: 'min' })).toBe(false);
		expect(boundFitIsStrong({ t, rSquared: 0.99, period: nyq * 1.01, side: 'min' })).toBe(true);
		// The upper bound has no such floor.
		expect(boundFitIsStrong({ t, rSquared: 0.99, period: 1, side: 'max' })).toBe(true);
	});

	it('missing x, a bad period or no side never counts as strong', () => {
		const { t } = authorCase();
		const base = { t, rSquared: 0.99, period: 1, side: 'min' };
		expect(boundFitIsStrong(base)).toBe(true);
		expect(boundFitIsStrong({ ...base, t: undefined })).toBe(false);
		expect(boundFitIsStrong({ ...base, t: [1] })).toBe(false);
		expect(boundFitIsStrong({ ...base, period: 0 })).toBe(false);
		expect(boundFitIsStrong({ ...base, side: null })).toBe(false);
		expect(boundFitIsStrong({ ...base, rSquared: NaN })).toBe(false);
	});
});
