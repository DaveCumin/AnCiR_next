import { describe, it, expect } from 'vitest';
import { placeCircularPoints } from './circularStack.js';

const base = { period: 24, dotRadius: 3, plotRadius: 100, baseRim: 0.9 };

describe('placeCircularPoints', () => {
	it('rim mode pins everything to r01 = 1', () => {
		const out = placeCircularPoints([1, 2, 3], { ...base, placement: 'rim' });
		expect(out).toHaveLength(3);
		expect(out.every((p) => p.r01 === 1)).toBe(true);
		expect(out.map((p) => p.value)).toEqual([1, 2, 3]);
	});
	it('drops non-finite values', () => {
		const out = placeCircularPoints([1, NaN, null, undefined, 2], { ...base, placement: 'rim' });
		expect(out).toHaveLength(2);
	});
	it('stack mode dodges coincident values outward from baseRim', () => {
		const out = placeCircularPoints([7.0, 7.0, 7.0], { ...base, placement: 'stack', quant: 0.5 });
		const step = (base.dotRadius * 2 + 1.4) / base.plotRadius;
		const r = out.map((p) => p.r01).sort((a, b) => a - b);
		expect(r[0]).toBeCloseTo(0.9, 9);
		expect(r[1]).toBeCloseTo(0.9 + step, 9);
		expect(r[2]).toBeCloseTo(0.9 + 2 * step, 9);
	});
	it('bin mode snaps to bin centres and piles', () => {
		// binWidth 2 over period 24 → 12 bins of width 2; centres at 1,3,5,...
		const out = placeCircularPoints([6.2, 6.8, 7.4], { ...base, placement: 'bin', binWidth: 2 });
		// all three fall in the [6,8) bin → same centre (7), stacked
		expect(out.every((p) => p.value === 7)).toBe(true);
		const step = (base.dotRadius * 2 + 1.4) / base.plotRadius;
		const r = out.map((p) => p.r01).sort((a, b) => a - b);
		expect(r[0]).toBeCloseTo(0.9, 9);
		expect(r[2]).toBeCloseTo(0.9 + 2 * step, 9);
	});
});
