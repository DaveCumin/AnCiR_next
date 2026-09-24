// The scalogram is painted one image column per time sample. A long record (the
// reported case was 250,000 samples) asked for a canvas wider than browsers allow,
// so the heatmap came out blank. The power field is binned down to a bounded
// number of columns before painting.
import { describe, it, expect } from 'vitest';
import { downsampleColumns, SCALOGRAM_MAX_COLUMNS } from './CWT.svelte';

describe('downsampleColumns', () => {
	it('leaves a narrow field untouched', () => {
		const power = [
			[1, 2, 3],
			[4, 5, 6]
		];
		expect(downsampleColumns(power, 8)).toBe(power);
	});

	it('averages each bin of samples, row by row', () => {
		const power = [
			[1, 3, 5, 7, 9, 11],
			[0, 0, 6, 6, 1, 2]
		];
		const out = downsampleColumns(power, 3);
		expect(Array.from(out[0])).toEqual([2, 6, 10]);
		expect(Array.from(out[1])).toEqual([0, 6, 1.5]);
	});

	it('ignores non-finite cells, and a bin with none finite is NaN', () => {
		const out = downsampleColumns([[NaN, 4, NaN, NaN]], 2);
		expect(out[0][0]).toBe(4);
		expect(Number.isNaN(out[0][1])).toBe(true);
	});

	it('bounds a 250,000-sample record to the canvas-safe width, covering every sample', () => {
		const n = 250_000;
		const row = Float64Array.from({ length: n }, (_, i) => i);
		const out = downsampleColumns([row], SCALOGRAM_MAX_COLUMNS);
		expect(out[0]).toHaveLength(SCALOGRAM_MAX_COLUMNS);
		// First and last bins average the first and last samples' neighbourhoods.
		expect(out[0][0]).toBeLessThan(n / SCALOGRAM_MAX_COLUMNS);
		expect(out[0][SCALOGRAM_MAX_COLUMNS - 1]).toBeGreaterThan(n - n / SCALOGRAM_MAX_COLUMNS);
		// The mean is preserved (equal-sized bins up to rounding).
		const mean = out[0].reduce((a, b) => a + b, 0) / SCALOGRAM_MAX_COLUMNS;
		expect(mean).toBeCloseTo((n - 1) / 2, 0);
	});
});
