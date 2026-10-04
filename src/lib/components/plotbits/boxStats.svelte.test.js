// STAT-2: the box plot drew its median and quartiles as sorted[floor(n * q)], so every
// even-sized group was wrong: [1,2,3,4] was drawn 2 / 3 / 4 instead of 1.75 / 2.5 / 3.25, and
// the drawn median disagreed with DescribeData. The house quantile is type 7 (R's default,
// numpy.percentile's default), from sampleStats.js. The whiskers follow the stated rule, the
// most extreme data within 1.5 IQR of the CORRECTED quartiles, which is what matplotlib's
// boxplot_stats does; the references below are matplotlib.cbook.boxplot_stats.
import { describe, it, expect } from 'vitest';
import { calculateBoxPlotStats } from './Box.svelte';

describe('calculateBoxPlotStats quartiles (STAT-2)', () => {
	it('[1,2,3,4] is 1.75 / 2.5 / 3.25', () => {
		const s = calculateBoxPlotStats([1, 2, 3, 4]);
		expect([s.q1, s.q2, s.q3]).toEqual([1.75, 2.5, 3.25]);
		expect([s.lowerWhisker, s.upperWhisker]).toEqual([1, 4]);
		expect(s.outliers).toEqual([]);
	});

	it('[1..8] is 2.75 / 4.5 / 6.25', () => {
		const s = calculateBoxPlotStats([1, 2, 3, 4, 5, 6, 7, 8]);
		expect([s.q1, s.q2, s.q3]).toEqual([2.75, 4.5, 6.25]);
	});

	it('the order of the input does not matter', () => {
		const s = calculateBoxPlotStats([4, 1, 3, 2]);
		expect([s.q1, s.q2, s.q3]).toEqual([1.75, 2.5, 3.25]);
	});

	it('whiskers use 1.5 IQR of the corrected quartiles: 15 in [1..9, 15] is an outlier', () => {
		// q1 3.25, q3 7.75, IQR 4.5, upper fence 14.5. The old floor quartiles (3, 8) put the
		// fence at 15.5, so 15 was drawn as a whisker end instead of a point.
		const s = calculateBoxPlotStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 15]);
		expect([s.q1, s.q2, s.q3]).toEqual([3.25, 5.5, 7.75]);
		expect(s.lowerWhisker).toBe(1);
		expect(s.upperWhisker).toBe(9);
		expect(s.outliers).toEqual([15]);
	});

	it('a different multiplier moves the fences', () => {
		const s = calculateBoxPlotStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 15], { iqrMultiplier: 3 });
		expect(s.outliers).toEqual([]);
		expect(s.upperWhisker).toBe(15);
	});

	it('missing values are dropped (house rule) and numeric strings are numbers', () => {
		const s = calculateBoxPlotStats([1, null, '', ' ', 'n/a', NaN, '2', 3, 4]);
		expect([s.q1, s.q2, s.q3]).toEqual([1.75, 2.5, 3.25]);
		expect(s.min).toBe(1);
		expect(s.max).toBe(4);
	});

	it('a real 0 is data', () => {
		const s = calculateBoxPlotStats([0, 0, 4, 4]);
		expect(s.q2).toBe(2);
	});

	it('all missing gives null', () => {
		expect(calculateBoxPlotStats([null, '', ' '])).toBeNull();
	});
});
