// The period axis: whole numbers read as numbers ("2", not "2.0" beside "12"), and the short
// end of the range gets its own tick when "1" falls just outside it (30 min sampling starts
// the axis at about 1.03 h, which left the bottom of the axis unlabelled below "2").
import { describe, it, expect } from 'vitest';
import { periodTicks, fmtPeriod } from './CWT.svelte';

const periods = Array.from({ length: 45 }, (_, j) => 1.033 * 2 ** (j / 8));

describe('CWT period ticks', () => {
	it('labels the short end when the first readable period is far from it', () => {
		const ticks = periodTicks(periods, true);
		expect(ticks[0]).toBe(periods[0]);
		expect(ticks.slice(1, 4)).toEqual([2, 3, 4]);
	});
	it('adds no end tick when a readable period is close to it', () => {
		const p = Array.from({ length: 41 }, (_, j) => 2 ** (j / 8)); // 1 .. 32
		expect(periodTicks(p, true)[0]).toBe(1);
		expect(periodTicks(p, true).at(-1)).toBe(32);
	});
	it('formats whole numbers without decimals, others to 3 significant figures', () => {
		expect([0.5, 2, 12, 24, 1.0331, 47.6].map(fmtPeriod)).toEqual([
			'0.5',
			'2',
			'12',
			'24',
			'1.03',
			'47.6'
		]);
	});
});
