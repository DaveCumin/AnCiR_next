import { describe, it, expect } from 'vitest';
import { paddedDomain, finiteExtent } from './axisDomain.js';
import { Periodogramclass } from './Periodogram/Periodogram.svelte';

describe('paddedDomain', () => {
	it('leaves room above the maximum so a peak is not on the clip edge', () => {
		const [lo, hi] = paddedDomain(0, 448, { lowerBound: 0 });
		expect(lo).toBe(0);
		expect(hi).toBeGreaterThan(448);
	});

	it('rounds outward to a nice tick when asked (the drosophila periodogram case)', () => {
		expect(paddedDomain(5, 448, { lowerBound: 0, nice: 5 })).toEqual([0, 500]);
	});

	it('respects a lower bound the data respect, and ignores one they cross', () => {
		expect(paddedDomain(2, 100, { lowerBound: 0 })[0]).toBe(0);
		expect(paddedDomain(-3, 100, { lowerBound: 0 })[0]).toBeLessThan(-3);
	});

	it('gives a flat series a visible band', () => {
		const [lo, hi] = paddedDomain(50, 50);
		expect(lo).toBeLessThan(50);
		expect(hi).toBeGreaterThan(50);
	});

	it('falls back to [0, 1] for non-finite input', () => {
		expect(paddedDomain(NaN, 3)).toEqual([0, 1]);
	});
});

describe('finiteExtent', () => {
	it('skips nulls, NaN and missing arrays', () => {
		expect(finiteExtent([[1, null, NaN, 5], null, [-2, Infinity]])).toEqual({ min: -2, max: 5 });
		expect(finiteExtent([[null], []])).toEqual({ min: null, max: null });
	});
});

describe('Periodogram y domain', () => {
	function withData(y, threshold, method = 'Chi-squared') {
		const p = Periodogramclass.fromJSON(null, { data: [] });
		// Stand-in series: only the fields ylims reads.
		p.data = [
			{ method, periodData: { x: y.map((_, i) => i), y, threshold }, thresholdline: { draw: true } }
		];
		return p;
	}

	it('the top of the axis is above the highest peak', () => {
		const p = withData([10, 448, 20], [100, 100, 100]);
		expect(p.ylims[1]).toBeGreaterThan(448);
		expect(p.ylims[0]).toBe(0);
	});

	it('a significance threshold above the data stays on the plot', () => {
		const p = withData([10, 40, 20], [300, 310, 320]);
		expect(p.ylims[1]).toBeGreaterThan(320);
	});

	it('loads the old one-element-array Min/Max values as plain numbers', () => {
		const p = Periodogramclass.fromJSON(null, { data: [], ylimsIN: [[0], [500]] });
		expect(p.ylimsIN).toEqual([0, 500]);
	});
});
