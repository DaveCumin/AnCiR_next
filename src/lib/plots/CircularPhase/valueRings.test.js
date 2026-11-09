// A timed circular phase plot's value axis runs from an inner rim to the clock ring, and its
// rings sit at the labelled values, the axis minimum ("0") on a ring AT the inner rim. The
// grid's rings used to stay at quarters of the radius, so no label sat on a ring and "0"
// floated inside the first one. The hole stays: a zero value (an inactive bin) must keep its
// angle, which it would lose at the centre.
import { describe, it, expect } from 'vitest';
import { timedValueScale, timedValueTicks } from './CircularPhase.svelte';

const INNER = 0.12;

describe('timed value rings', () => {
	it('puts the axis minimum on the inner rim, not the centre, and the maximum on the ring', () => {
		const s = timedValueScale([0, 20]);
		expect(s(0)).toBeCloseTo(INNER, 12);
		expect(s(0)).toBeGreaterThan(0);
		expect(s(20)).toBe(1);
	});

	it('labels each ring at its own value, 0 on the inner rim', () => {
		const ticks = timedValueTicks([0, 20]);
		expect(ticks.map((k) => k.t)).toEqual([0, 5, 10, 15, 20]);
		const step = (1 - INNER) / 4;
		ticks.forEach((k, i) => expect(k.r01).toBeCloseTo(INNER + i * step, 12));
	});
});
