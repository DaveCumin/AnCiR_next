import { describe, it, expect } from 'vitest';
import { jitterOffset } from './jitter.js';

describe('jitterOffset', () => {
	it('is deterministic: same indices always give the same offset', () => {
		for (let s = 0; s < 3; s++) {
			for (let c = 0; c < 4; c++) {
				for (let p = 0; p < 20; p++) {
					expect(jitterOffset(s, c, p)).toBe(jitterOffset(s, c, p));
				}
			}
		}
	});

	it('always lands in [-1, 1)', () => {
		for (let s = 0; s < 5; s++) {
			for (let c = 0; c < 5; c++) {
				for (let p = 0; p < 200; p++) {
					const v = jitterOffset(s, c, p);
					expect(v).toBeGreaterThanOrEqual(-1);
					expect(v).toBeLessThan(1);
				}
			}
		}
	});

	it('spreads points rather than stacking them (index 0 included)', () => {
		// The +1 seeding exists so that a zero index still contributes; a broken
		// fold would collapse many points onto few offsets.
		const offsets = new Set();
		for (let p = 0; p < 100; p++) {
			offsets.add(jitterOffset(0, 0, p));
		}
		expect(offsets.size).toBeGreaterThan(90);
	});

	it('differs across series and categories for the same point index', () => {
		expect(jitterOffset(0, 0, 5)).not.toBe(jitterOffset(1, 0, 5));
		expect(jitterOffset(0, 0, 5)).not.toBe(jitterOffset(0, 1, 5));
	});

	it('is roughly centred (a hash bias would shove every point to one side)', () => {
		let sum = 0;
		const n = 1000;
		for (let p = 0; p < n; p++) sum += jitterOffset(0, 0, p);
		expect(Math.abs(sum / n)).toBeLessThan(0.1);
	});
});
