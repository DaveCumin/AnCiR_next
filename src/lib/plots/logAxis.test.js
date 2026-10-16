// The log value axis shared by the Periodogram and the FFT. The same cases are pinned for the
// Python export (tools/test_plot_overlays.py test_log_axis_domain_mirrors_the_app).
import { describe, it, expect } from 'vitest';
import { scaleLog } from 'd3-scale';
import {
	logAxisDomain,
	minPositiveOf,
	drawableOnLog,
	logTickFormat,
	LOG_AXIS_FLOOR
} from './logAxis.js';

describe('logAxisDomain', () => {
	it('a user minimum wins; else the smallest positive value, lowered; never below the floor', () => {
		expect(logAxisDomain(2, 0.01, 100)).toEqual([2, 100]);
		const [lo, hi] = logAxisDomain(null, 0.01, 100);
		expect(hi).toBe(100);
		expect(lo).toBeCloseTo(0.01 / Math.pow(100 / 0.01, 0.05), 15);
		expect(logAxisDomain(null, 1e-12, 100)[0]).toBe(LOG_AXIS_FLOOR);
		expect(logAxisDomain(null, Infinity, 100)).toEqual([10, 100]);
		expect(logAxisDomain(0, Infinity, 0)).toEqual([0.1, 1]);
	});
});

describe('helpers', () => {
	it('minPositiveOf skips non-positive and non-finite values, across arrays and extras', () => {
		expect(minPositiveOf([[0, -1, 3, NaN], null, [2]], [0.5, -2])).toBe(0.5);
		expect(minPositiveOf([[0, -1]])).toBe(Infinity);
	});
	it('drawableOnLog turns values at or below zero into gaps', () => {
		expect(drawableOnLog([0, -1, 2])).toEqual([NaN, NaN, 2]);
		expect(drawableOnLog(null)).toEqual([]);
	});
	it('logTickFormat labels plain numbers, not SI prefixes', () => {
		const s = scaleLog().domain([0.001, 1000]);
		const f = logTickFormat(s, 10);
		expect([0.001, 0.01, 1, 1000].map(f)).toEqual(['0.001', '0.01', '1', '1000']);
	});
});
