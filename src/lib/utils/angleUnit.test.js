// The unit a column of angles is in, and the notice when the chosen unit cannot be right.
import { describe, it, expect } from 'vitest';
import { angleRange, inferAngleUnit, angleUnitMismatch } from './angleUnit.js';

const PI = Math.PI;

describe('angleRange', () => {
	it('spans every column and skips blanks, text and non-finite cells', () => {
		expect(
			angleRange([
				[1, null, '', '  ', 'x', NaN, Infinity],
				['7.5', -2]
			])
		).toEqual({
			min: -2,
			max: 7.5,
			n: 3
		});
	});
	it('is null with nothing finite', () => {
		expect(angleRange([])).toBeNull();
		expect(angleRange(undefined)).toBeNull();
		expect(angleRange([[], [null, '']])).toBeNull();
	});
});

describe('inferAngleUnit', () => {
	const cases = [
		// [label, values, period, expected]
		['0 to 2pi', [0, 1, 3, 2 * PI], 24, 'radians'],
		['-pi to pi', [-PI, 0, PI], 24, 'radians'],
		['2pi written to 4 decimals', [0.1, 6.2832], 24, 'radians'],
		['small clock hours cannot be told from radians', [1, 2.5, 6], 24, 'radians'],
		['clock hours of the day', [10.87, 13.2, 16.98], 24, 'hours'],
		['clock hours up to the period', [0, 12, 24], 24, 'hours'],
		['signed clock hours', [-11.5, -4, 3, 11.9], 24, 'hours'],
		['hours on a 28 h cycle', [3, 27.5], 28, 'hours'],
		['27.5 is past a 24 h cycle', [3, 27.5], 24, 'degrees'],
		['signed hours past half the period', [-13, 5], 24, 'degrees'],
		['degrees 0 to 360', [10, 180, 359], 24, 'degrees'],
		['degrees -180 to 180', [-170, 20, 175], 24, 'degrees'],
		['signed and past 180', [-90, 300], 24, 'degrees'],
		['past every range', [0, 400], 24, 'radians'],
		['below every range', [-200, 10], 24, 'radians'],
		['a bad period falls back to 24', [10, 20], NaN, 'hours'],
		['text numbers', ['10.5', '20'], 24, 'hours']
	];
	for (const [label, values, period, expected] of cases) {
		it(`${label}: ${expected}`, () => {
			expect(inferAngleUnit([values], period)).toBe(expected);
		});
	}

	it('one unit for all the columns together', () => {
		// Each column alone would pass for radians or hours; together they are degrees.
		expect(
			inferAngleUnit([
				[1, 2, 3],
				[10, 20],
				[200, 300]
			])
		).toBe('degrees');
	});

	it('is null when there is nothing to judge, so the caller keeps its unit', () => {
		expect(inferAngleUnit([])).toBeNull();
		expect(inferAngleUnit([[null, '']])).toBeNull();
	});
});

describe('angleUnitMismatch', () => {
	it('is null when the values fit the chosen unit, whatever else they fit', () => {
		expect(angleUnitMismatch([[1, 2, 6]], 'radians')).toBeNull();
		expect(angleUnitMismatch([[1, 2, 6]], 'hours')).toBeNull();
		expect(angleUnitMismatch([[1, 2, 6]], 'degrees')).toBeNull();
		expect(angleUnitMismatch([[10, 20]], 'degrees')).toBeNull();
		expect(angleUnitMismatch([[-170, 350]], 'degrees')).toBeNull();
	});

	it('clock hours read as radians: names clock hours', () => {
		const m = angleUnitMismatch([[10.87, 13.2, 16.98]], 'radians');
		expect(m.likely).toBe('hours');
		expect(m.message).toBe(
			'The values run from 10.87 to 16.98, more than one turn in radians, so they look like clock hours read as radians. If they are clock hours, set the unit to clock hours; the results are wrong until then.'
		);
	});

	it('degrees read as radians or as hours: names degrees', () => {
		expect(angleUnitMismatch([[10, 350]], 'radians').likely).toBe('degrees');
		expect(angleUnitMismatch([[10, 350]], 'hours').likely).toBe('degrees');
		// On a 400 h cycle the same values are legitimate hours.
		expect(angleUnitMismatch([[10, 350]], 'hours', 400)).toBeNull();
	});

	it('values that fit no unit are unwrapped angles, not a contradiction', () => {
		expect(angleUnitMismatch([[0, 1000]], 'radians')).toBeNull();
		expect(angleUnitMismatch([[0, 1000]], 'hours')).toBeNull();
		expect(angleUnitMismatch([[0, 1000]], 'degrees')).toBeNull();
	});

	it('nothing to judge, or a unit it does not know: null', () => {
		expect(angleUnitMismatch([[]], 'radians')).toBeNull();
		expect(angleUnitMismatch([[10, 20]], 'turns')).toBeNull();
	});

	it('agrees with inferAngleUnit: the inferred unit is never a mismatch', () => {
		for (const values of [
			[0, 6],
			[10, 17],
			[-11, 11],
			[0, 359],
			[-180, 180],
			[0, 5000]
		]) {
			expect(angleUnitMismatch([values], inferAngleUnit([values]))).toBeNull();
		}
	});
});
