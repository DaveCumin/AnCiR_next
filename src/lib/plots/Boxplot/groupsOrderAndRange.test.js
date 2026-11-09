// The box plot's automatic groups and y range.
//   - Groups stand in the order they first appear (control, early, late were drawn
//     alphabetically); groups that are all numbers stay in numeric order (days 1 .. 10).
//   - The y range is rounded out from the data's SPAN: 22.5 .. 23.3 used to become 20 .. 30
//     (each end rounded to its own decade), squashing every box into a twelfth of the plot.
//   - A numeric x with many distinct values (a time or measurement column wired as the groups)
//     gets a warning instead of silently drawing one box per value.
import { describe, it, expect } from 'vitest';
import { Boxplotclass } from './Boxplot.svelte';

function plot(series) {
	const b = new Boxplotclass(null, null);
	b.data = series.map(([label, x, y, xName]) => ({
		label,
		x: { getData: () => x, displayName: xName ?? 'group' },
		y: { getData: () => y },
		boxPlot: { draw: true, outlierMethod: 'iqr', iqrMultiplier: 1.5, zThreshold: 3 }
	}));
	return b;
}

describe('Boxplot groups', () => {
	it('keeps text groups in the order they first appear', () => {
		const b = plot([['s', ['late', 'early', 'late', 'control', 'early'], [1, 2, 3, 4, 5]]]);
		expect(b.uniqueXValues).toEqual(['late', 'early', 'control']);
	});

	it('first appearance across series: a later series adds its new groups after', () => {
		const b = plot([
			['a', ['wt', 'ko'], [1, 2]],
			['b', ['het', 'wt'], [3, 4]]
		]);
		expect(b.uniqueXValues).toEqual(['wt', 'ko', 'het']);
	});

	it('orders all-number groups numerically, not as text', () => {
		const b = plot([['s', [10, 2, 1, '3'], [1, 2, 3, 4]]]);
		expect(b.uniqueXValues).toEqual([1, 2, '3', 10]);
	});

	it('warns when a numeric x makes more groups than a box plot can mean', () => {
		const hours = Array.from({ length: 40 }, (_, i) => i * 0.5);
		const b = plot([['s', hours, hours.map(() => 1), 'hours']]);
		expect(b.categoryWarnings).toHaveLength(1);
		expect(b.categoryWarnings[0]).toMatch(/"hours" is numeric with 40 distinct values/);
	});

	it('does not warn for a few numeric groups (days) or for text groups', () => {
		expect(plot([['s', [1, 2, 3, 1, 2, 3], [1, 2, 3, 4, 5, 6]]]).categoryWarnings).toEqual([]);
		const names = Array.from({ length: 40 }, (_, i) => `g${i}`);
		expect(plot([['s', names, names.map(() => 1)]]).categoryWarnings).toEqual([]);
	});
});

describe('Boxplot y range', () => {
	it('rounds out from the span, not to each end’s decade', () => {
		const b = plot([['s', ['a', 'a', 'b', 'b'], [22.5, 22.9, 23.0, 23.3]]]);
		b.renderBox = { w: 400, h: 300 };
		const [lo, hi] = b.ylims;
		expect(lo).toBeGreaterThanOrEqual(22.3);
		expect(lo).toBeLessThanOrEqual(22.5);
		expect(hi).toBeGreaterThanOrEqual(23.3);
		expect(hi).toBeLessThanOrEqual(23.5);
	});
});
