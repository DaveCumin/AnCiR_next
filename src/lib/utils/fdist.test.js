import { describe, it, expect } from 'vitest';
import { pUpperFromF } from './fdist.js';
import { pUpperFromChiSq } from './chisquare.js';

describe('pUpperFromF', () => {
	it('returns ~1 at F=0 and decreases toward 0 for large F', () => {
		expect(pUpperFromF(0, 3, 20)).toBeCloseTo(1, 6);
		expect(pUpperFromF(100, 3, 20)).toBeLessThan(1e-6);
	});
	it('matches a known upper-tail value (F=3.10, df=(2,17) → ~0.0707)', () => {
		expect(pUpperFromF(3.1, 2, 17)).toBeCloseTo(0.0707, 3);
	});
	it('guards degenerate inputs', () => {
		expect(pUpperFromF(NaN, 2, 17)).toBeNaN();
		expect(pUpperFromF(1, 0, 17)).toBeNaN();
		expect(pUpperFromF(-1, 2, 17)).toBeNaN();
	});
});

// Upper tails computed directly, not as 1 - cdf: below ~1e-16 the subtraction returns 0.
// References are scipy.stats.f.sf / chi2.sf.
describe('upper tails keep tiny p-values', () => {
	const rel = (a, b) => Math.abs(a - b) / b;
	it.each([
		[10, 2, 20, 0.0009765625],
		[3.5, 4, 30, 0.018467568289618427],
		[0.5, 3, 12, 0.6892693638616516],
		[50, 10, 3, 0.004097138377348176],
		[1, 1, 1, 0.5000000000000001],
		[200, 2, 94, 1.3546980940072907e-34],
		[1000, 1, 50, 1.0115314192893323e-34],
		[400, 5, 1000, 1.2657005641360866e-235]
	])('F sf(%d; %d, %d) matches scipy', (f, d1, d2, want) => {
		expect(rel(pUpperFromF(f, d1, d2), want)).toBeLessThan(1e-9);
	});
	it('F sf is 1 at F = 0', () => {
		expect(pUpperFromF(0, 2, 5)).toBe(1);
	});
	it('chi-square upper tail from chisquare.js keeps a 1e-86 p', () => {
		expect(rel(pUpperFromChiSq(400, 3), 2.2138865931011112e-86)).toBeLessThan(1e-9);
	});
});
