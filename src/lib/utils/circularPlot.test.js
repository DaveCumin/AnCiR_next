import { describe, it, expect } from 'vitest';
import { displayPeriodFor, seriesStats, groupsWatsonWilliams } from './circularPlot.js';
import { pUpperFromF } from './fdist.js';

describe('displayPeriodFor', () => {
	it('picks the full-turn length per unit', () => {
		expect(displayPeriodFor('hours', 24)).toBe(24);
		expect(displayPeriodFor('hours', 23.8)).toBeCloseTo(23.8, 9);
		expect(displayPeriodFor('degrees', 24)).toBe(360);
		expect(displayPeriodFor('radians', 24)).toBeCloseTo(Math.PI * 2, 9);
	});
});

describe('seriesStats', () => {
	it('tightly clustered hours give R→1 and meanValue near the cluster', () => {
		const s = seriesStats([6.9, 7.1, 7.0, 7.2, 6.8], 'hours', 24);
		expect(s.n).toBe(5);
		expect(s.R).toBeGreaterThan(0.99);
		expect(s.meanValue).toBeGreaterThan(6.5);
		expect(s.meanValue).toBeLessThan(7.5);
		expect(s.pValue).toBeLessThan(0.05);
	});
	it('meanValue is expressed in the data unit and wraps within [0, period)', () => {
		const s = seriesStats([23.5, 0.5, 0.0, 23.0], 'hours', 24); // clusters near midnight
		expect(s.meanValue).toBeGreaterThanOrEqual(0);
		expect(s.meanValue).toBeLessThan(24);
		// near 0/24, not near 12
		expect(Math.min(s.meanValue, 24 - s.meanValue)).toBeLessThan(2);
	});
});

describe('groupsWatsonWilliams', () => {
	it('two tight clusters at different means → significant', () => {
		const a = [6.8, 7.0, 7.1, 6.9, 7.2];
		const b = [10.0, 10.2, 9.8, 10.1, 9.9];
		const ww = groupsWatsonWilliams([a, b], 'hours', 24, pUpperFromF);
		expect(ww.valid).toBe(true);
		expect(ww.k).toBe(2);
		expect(ww.pValue).toBeLessThan(0.05);
	});
});
