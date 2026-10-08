// @ts-nocheck
// Parsing the Manual ticks text box, and dropping ticks that fall outside the axis domain.
import { describe, it, expect } from 'vitest';
import { scaleLinear, scaleLog, scaleBand, scaleUtc } from 'd3-scale';
import { parseTickList, formatTickList, ticksInDomain, manualTicksToDraw } from './manualTicks.js';

describe('parseTickList', () => {
	it('reads comma- or space-separated numbers', () => {
		expect(parseTickList('0, 6, 12, 18, 24')).toEqual({ values: [0, 6, 12, 18, 24], invalid: [] });
		expect(parseTickList('0 6 12  18\t24')).toEqual({ values: [0, 6, 12, 18, 24], invalid: [] });
		expect(parseTickList('-1.5,2e1; 3')).toEqual({ values: [-1.5, 3, 20], invalid: [] });
	});

	it('sorts and drops repeats', () => {
		expect(parseTickList('12, 0, 12, 6').values).toEqual([0, 6, 12]);
	});

	it('reports entries that are not numbers, and keeps the rest', () => {
		expect(parseTickList('0, six, 12, 1x, Infinity')).toEqual({
			values: [0, 12],
			invalid: ['six', '1x', 'Infinity']
		});
	});

	it('an empty or blank box is an empty list', () => {
		expect(parseTickList('')).toEqual({ values: [], invalid: [] });
		expect(parseTickList('  , ,')).toEqual({ values: [], invalid: [] });
		expect(parseTickList(null)).toEqual({ values: [], invalid: [] });
	});
});

describe('formatTickList', () => {
	it('writes the list back as the box shows it', () => {
		expect(formatTickList([0, 6, 12])).toBe('0, 6, 12');
		expect(formatTickList(null)).toBe('');
	});
});

describe('ticksInDomain', () => {
	it('drops ticks outside a linear domain, either orientation', () => {
		expect(ticksInDomain([-5, 0, 6, 24, 30], scaleLinear().domain([0, 24]))).toEqual([0, 6, 24]);
		expect(ticksInDomain([-5, 0, 6, 24, 30], scaleLinear().domain([24, 0]))).toEqual([0, 6, 24]);
	});

	it('drops non-positive ticks on a log axis (they are outside its domain)', () => {
		expect(ticksInDomain([0, 1, 10, 100, 1000], scaleLog().domain([1, 100]))).toEqual([1, 10, 100]);
	});

	it('leaves a band scale alone (its ticks are categories)', () => {
		expect(ticksInDomain(['a', 'z'], scaleBand().domain(['a', 'b']))).toEqual(['a', 'z']);
	});
});

describe('manualTicksToDraw', () => {
	const lin = scaleLinear().domain([0, 24]);

	it('a numeric axis draws the stored list, clipped to the domain', () => {
		expect(manualTicksToDraw([-6, 0, 12, 36], lin, 'numeric')).toEqual([0, 12]);
		expect(manualTicksToDraw([0, 12], lin)).toEqual([0, 12]);
	});

	it('no list, or an empty one, means automatic ticks', () => {
		expect(manualTicksToDraw(null, lin, 'numeric')).toBeNull();
		expect(manualTicksToDraw([], lin, 'numeric')).toBeNull();
	});

	it('a categorical or time axis never draws a stored list', () => {
		expect(manualTicksToDraw([0, 12], lin, 'categorical')).toBeNull();
		expect(manualTicksToDraw([0, 12], lin, 'time')).toBeNull();
	});

	it('a time scale or a band scale never draws one either, whatever the mode says', () => {
		const t = scaleUtc().domain([new Date(0), new Date(8.64e7)]);
		expect(manualTicksToDraw([0, 6], t, 'numeric')).toBeNull();
		expect(manualTicksToDraw([0, 6], scaleBand().domain(['a', 'b']), 'numeric')).toBeNull();
	});
});
