import { describe, it, expect } from 'vitest';
import { pUpperFromF } from './fdist.js';

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
