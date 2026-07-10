import { describe, it, expect } from 'vitest';
import { createPolar } from './polar.js';

const P = createPolar({ cx: 100, cy: 100, radius: 50, period: 24 });

describe('createPolar', () => {
	it('places 0 at the top and 6h (quarter of 24) at the right (clockwise)', () => {
		const [x0, y0] = P.toXY(0, 1);
		expect(x0).toBeCloseTo(100, 6); // straight up
		expect(y0).toBeCloseTo(50, 6);
		const [x6, y6] = P.toXY(6, 1);
		expect(x6).toBeCloseTo(150, 6); // to the right
		expect(y6).toBeCloseTo(100, 6);
	});
	it('r01 scales the radius', () => {
		const [, y] = P.toXY(0, 0.5);
		expect(y).toBeCloseTo(75, 6); // halfway up
	});
	it('fromXY inverts toXY', () => {
		for (const v of [0, 3, 7.5, 12, 23.9]) {
			const [x, y] = P.toXY(v, 0.8);
			const inv = P.fromXY(x, y);
			expect(inv.value).toBeCloseTo(v, 6);
			expect(inv.r01).toBeCloseTo(0.8, 6);
		}
	});
	it('respects a non-24 period', () => {
		const P12 = createPolar({ cx: 0, cy: 0, radius: 10, period: 12 });
		const [x, y] = P12.toXY(3, 1); // quarter of 12 → right
		expect(x).toBeCloseTo(10, 6);
		expect(y).toBeCloseTo(0, 6);
	});
});
