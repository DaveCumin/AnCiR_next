// @ts-nocheck
/**
 * FIT-U7 (2026-10-03 review, "possible issue, not confirmed"): rayleighTest's p comment cited
 * Zar (1999) eq. 27.4 for its series expansion.
 *
 * Verdict: CONFIRMED (citation fixed; the numbers are unchanged). The expansion the app uses is
 * the one in R circular::rayleigh.test and astropy.stats.rayleightest (astropy 8.0.1 is the
 * reference below, equal to 1e-12 for n < 50). Zar's eq. 27.4, as quoted by CircStat for
 * MATLAB (circ_rtest) and pingouin (circ_rayleigh), is a different expression,
 * exp(sqrt(1 + 4n + 4(n^2 - Rn^2)) - (1 + 2n)); it gives slightly different p (below), so the
 * old citation named the wrong formula.
 *
 * Also pinned: at n >= 50 R circular and astropy drop the series' bracket (p = e^-z); the app
 * keeps it at every n, a difference of 0.0016 on the n = 60 sample below (documents current
 * behaviour).
 */
import { describe, it, expect } from 'vitest';
import { rayleighTest } from './circular.js';

// numpy default_rng(3).vonmises(1.0, kappa, size=n), rounded to 6 dp; p from astropy 8.0.1.
const CASES = [
	{
		a: [1.13134, -0.125503, 1.853843, 1.174929, 1.743784, -2.422941, -0.508663, -1.970309],
		astropy: 0.6460677369056288,
		zar: 0.6454098313980682
	},
	{
		a: [
			-1.619998, 3.093421, 1.810391, -2.474334, 1.629534, 1.452597, -0.738051, -1.033277, -1.426461,
			0.701048, -2.758953, 0.126087
		],
		astropy: 0.9547304145335302,
		zar: 0.9546804600358244
	},
	{
		a: [
			1.431149, -0.498434, -2.755681, 2.684894, -1.276109, 0.083832, 0.486133, 1.723813, -1.99654,
			-0.428655, 2.879226, 2.842702, -0.459431, 1.298124, -1.226476, 2.374938, 1.969304, 0.018896,
			2.23256, -2.468379, -2.3619, -1.377772, -0.236118, 2.513119, -0.548247, 0.027503, 0.596513,
			-0.828023, -1.857866, 0.319663
		],
		astropy: 0.6586637743303986,
		zar: 0.6586186411296399
	}
];

const N60 = [
	-0.401538, 2.043014, -2.142415, -2.633282, 1.415567, -0.407689, -0.044526, -0.841313, -0.965189,
	-3.090212, -0.339701, -2.667533, 1.002715, 2.901499, -2.652664, -0.484015, 2.842358, 2.230956,
	-2.728419, 1.975517, 1.184257, -1.984933, -1.702197, 0.048526, 2.251609, 0.971011, -0.101544,
	-2.610796, 1.401254, -2.627438, -1.69619, -0.998838, -0.735572, 2.781838, -0.325474, -1.819074,
	1.02873, 0.429773, 2.60647, 0.496451, -2.926161, 2.286563, 1.455702, -2.519989, 0.197698,
	-2.976415, 1.955058, -1.122957, -2.688017, -3.043632, -0.430727, -2.168569, -1.647681, 0.001495,
	-0.077649, -2.374838, 0.181219, 2.134521, -1.35117, 2.651311
];

/** Zar (1999) eq. 27.4 as CircStat / pingouin implement it. */
function zarP(a) {
	const n = a.length;
	let C = 0;
	let S = 0;
	for (const v of a) {
		C += Math.cos(v);
		S += Math.sin(v);
	}
	const Rn = Math.hypot(C, S);
	return Math.exp(Math.sqrt(1 + 4 * n + 4 * (n * n - Rn * Rn)) - (1 + 2 * n));
}

describe('FIT-U7: Rayleigh p is the R circular / astropy series, not Zar eq. 27.4', () => {
	it.each(CASES.map((c) => [c.a.length, c]))(
		'n = %i: equals astropy.stats.rayleightest',
		(_n, c) => {
			expect(rayleighTest(c.a).pValue).toBeCloseTo(c.astropy, 12);
		}
	);

	it.each(CASES.map((c) => [c.a.length, c]))(
		'n = %i: Zar eq. 27.4 is a different number',
		(_n, c) => {
			expect(zarP(c.a)).toBeCloseTo(c.zar, 12);
			expect(Math.abs(rayleighTest(c.a).pValue - c.zar)).toBeGreaterThan(1e-5);
			expect(Math.abs(rayleighTest(c.a).pValue - c.zar)).toBeLessThan(1e-3);
		}
	);

	it('n = 60: the app keeps the series bracket where astropy / R circular use e^-z', () => {
		const p = rayleighTest(N60).pValue;
		expect(p).toBeCloseTo(0.7482957357923716, 12);
		expect(p - 0.7467420558636841).toBeCloseTo(0.0016, 4); // astropy 8.0.1 at n = 60
	});
});
