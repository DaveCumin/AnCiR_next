// Review STAT-1 / STAT-6 leftovers on the Boxplot: the significance bars, the category list,
// the violin warnings and the y range all filtered with `v != null && !isNaN(v)`, which lets
// '' and ' ' through (isNaN('') is false) and kept numeric STRINGS as strings. So a blank
// entered the bar tests as a value, and in the "one group per series" mode the mean SUMMED
// strings: ['1','2','3'] reduced to '0123'. The stats table already used the house rule
// (presentValues / isInvalidValue); these pin the rest of the plot to it.
import { describe, it, expect } from 'vitest';
import { Boxplotclass } from './Boxplot.svelte';
import { welchTTest } from '$lib/tableProcesses/GroupComparison.svelte';

function plot(series, over = {}) {
	const b = new Boxplotclass(null, null);
	b.data = series.map(([label, x, y]) => ({
		label,
		x: { getData: () => x },
		y: { getData: () => y },
		boxPlot: { draw: true, outlierMethod: 'iqr', iqrMultiplier: 1.5, zThreshold: 3 }
	}));
	Object.assign(b, over);
	return b;
}

const group = (name, values) => {
	const n = values.length;
	const mean = values.reduce((a, b) => a + b, 0) / n;
	const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1));
	return { name, values, n, mean, sd };
};

describe('Boxplot significance bars: missing values and numeric strings', () => {
	it('one group per series: numeric strings are numbers, blanks are missing', () => {
		const b = plot([
			['A', [], ['1', '2', '3', '', ' ']],
			['B', [], [4, 5, 6, null]]
		]);
		const [pair] = b.sigTableResult.pairs;
		const ref = welchTTest(group('A', [1, 2, 3]), group('B', [4, 5, 6]), 0.05);
		expect(pair.pValue).toBeCloseTo(ref.pValue, 12);
	});

	it('categorical x: a blank y is not a 0 in the test, and a blank category is no group', () => {
		const b = plot([
			['s', ['a', 'a', 'a', 'a', 'b', 'b', 'b', '', ' '], ['1', 2, 3, '', 4, '5', 6, 7, 8]]
		]);
		expect(b.uniqueXValues).toEqual(['a', 'b']);
		const [pair] = b.sigTableResult.pairs;
		const ref = welchTTest(group('a', [1, 2, 3]), group('b', [4, 5, 6]), 0.05);
		expect(pair.pValue).toBeCloseTo(ref.pValue, 12);
	});

	it('a category whose only y values are blank is not listed', () => {
		const b = plot([['s', ['a', 'a', 'b'], [1, 2, ' ']]]);
		expect(b.uniqueXValues).toEqual(['a']);
	});
});

describe('Boxplot violin warnings and y range', () => {
	it('blanks do not count towards the violin minimum', () => {
		const b = plot([['s', [], [1, 2, '', ' ', '']]], { showViolin: true });
		expect(b.violinWarnings.join(' ')).toMatch(/only 2 points/);
	});

	it('the y range ignores blanks and reads numeric strings', () => {
		const b = plot([['s', [], ['', '-3', 5, ' ']]], { renderBox: { w: 400, h: 300 } });
		const [lo, hi] = b.ylims;
		expect(lo).toBeLessThanOrEqual(-3);
		expect(hi).toBeGreaterThanOrEqual(5);
		expect(lo).toBeGreaterThan(-10);
	});
});
