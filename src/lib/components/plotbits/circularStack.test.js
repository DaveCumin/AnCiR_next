import { describe, it, expect } from 'vitest';
import { placeCircularPoints, maxStackHeight } from './circularStack.js';

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

describe('maxStackHeight', () => {
	it('bin mode counts the fullest bin across series', () => {
		const a = [1.1, 1.2, 1.3]; // all in bin [1,2)
		const b = [1.4, 5.0];
		expect(maxStackHeight([a, b], { placement: 'bin', period: 24, binWidth: 1 })).toBe(3);
	});
	it('rim mode is 1', () => {
		expect(maxStackHeight([[1, 2, 3]], { placement: 'rim', period: 24 })).toBe(1);
	});
});

describe('placeCircularPoints fit-scaling', () => {
	it('keeps the tallest bin inside the rim via maxStack', () => {
		const vals = Array.from({ length: 50 }, () => 7); // one huge column
		const out = placeCircularPoints(vals, {
			placement: 'bin', period: 24, binWidth: 1, dotRadius: 3, plotRadius: 100,
			maxStack: 50, innerRim: 0.12, outerRim: 0.98
		});
		expect(out.length).toBe(50);
		expect(Math.max(...out.map((p) => p.r01))).toBeLessThanOrEqual(0.98 + 1e-9);
		expect(Math.min(...out.map((p) => p.r01))).toBeGreaterThanOrEqual(0.12 - 1e-9);
	});
});
