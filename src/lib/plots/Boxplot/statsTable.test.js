// The Boxplot stats table (getDownloadData) reports the same numbers DescribeData does.
//
// STAT-2: its quartiles came from the box drawing's sorted[floor(n * q)], so [1,2,3,4] was
// reported 2 / 3 / 4; they are now type 7 (1.75 / 2.5 / 3.25, numpy.percentile's default).
// STAT-23: "std" was the POPULATION SD (1.118 for [1,2,3,4]; DescribeData and pandas give the
// sample SD 1.291), and a blank '' was skipped by the mean but read as 0 in the deviations
// ([1,'',3] gave 1.414). Missing values now follow the house rule throughout.
import { describe, it, expect } from 'vitest';
import { Boxplotclass } from './Boxplot.svelte';

function table(x, y) {
	const b = new Boxplotclass(null, null);
	b.data = [
		{
			label: 's',
			x: { getData: () => x },
			y: { getData: () => y },
			boxPlot: { outlierMethod: 'iqr', iqrMultiplier: 1.5, zThreshold: 3 }
		}
	];
	const { headers, rows } = b.getDownloadData();
	const col = (name) => {
		const j = headers.indexOf(name);
		return Object.fromEntries(rows.map((r) => [r[0], r[j]]));
	};
	return { headers, col };
}

describe('Boxplot stats table', () => {
	it('[1,2,3,4]: type-7 quartiles and the sample SD (pandas describe)', () => {
		const { col } = table(['A', 'A', 'A', 'A'], [1, 2, 3, 4]);
		const a = col('A');
		expect(a.count).toBe(4);
		expect(a.mean).toBe(2.5);
		expect(a['25%']).toBe(1.75);
		expect(a['50%']).toBe(2.5);
		expect(a['75%']).toBe(3.25);
		// pandas.Series([1,2,3,4]).std() = 1.2909944487358056
		expect(a.std).toBeCloseTo(1.2909944487358056, 12);
	});

	it("[1,'',3]: the blank is missing in the SD as well as the mean", () => {
		const { col } = table(['A', 'A', 'A'], [1, '', 3]);
		const a = col('A');
		expect(a.count).toBe(2);
		expect(a.mean).toBe(2);
		// pandas.Series([1,3]).std() = 1.4142135623730951 (the sample SD of the two values)
		expect(a.std).toBeCloseTo(Math.SQRT2, 12);
	});

	it('whitespace and text are missing; numeric strings are numbers', () => {
		const { col } = table(['A', 'A', 'A', 'A', 'A', 'A'], ['1', ' ', 'n/a', 2, 3, '4']);
		const a = col('A');
		expect(a.count).toBe(4);
		expect(a.mean).toBe(2.5);
		expect(a['50%']).toBe(2.5);
	});
});
