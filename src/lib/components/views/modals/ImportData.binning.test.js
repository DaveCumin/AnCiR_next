import { describe, it, expect } from 'vitest';
import { binParsedData } from './ImportData.svelte';

// Import-time binning ("Bin data on import", default 15 min) writes every column side by side,
// so every column must come out on ONE grid.
//
// binData now drops a row whose value is missing (it used to read null as 0, averaging blank
// cells in as zeros). Each column's own bins then stop at its last complete row, and the grid
// was taken from the FIRST numeric column, so a first column with a blank tail truncated the
// time column and every other column with it.
describe('binParsedData: missing cells on import', () => {
	// 5-minute samples over one hour, binned to the default 15 minutes: four bins of three rows
	// plus binData's trailing bin at or past the last sample.
	const times = Array.from({ length: 12 }, (_, i) => {
		const m = String(i * 5).padStart(2, '0');
		return `2024-03-04 00:${m}:00`;
	});
	const data = () => ({
		time: times.slice(),
		// First numeric column: blank for the last half hour.
		early: [1, 1, 1, 2, 2, 2, null, null, null, null, null, null],
		full: [3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6]
	});

	it('keeps every column on the full grid when the first column has a blank tail', () => {
		const out = binParsedData(data());
		expect(out.time).toHaveLength(out.full.length);
		expect(out.early).toHaveLength(out.full.length);
		expect(out.full.slice(0, 4)).toEqual([3, 4, 5, 6]);
	});

	it('leaves the blank bins empty instead of averaging the blanks in as 0', () => {
		const out = binParsedData(data());
		expect(out.early.slice(0, 2)).toEqual([1, 2]);
		expect(Number.isNaN(out.early[2])).toBe(true);
		expect(Number.isNaN(out.early[3])).toBe(true);
	});

	it('drops a single blank cell from its bin mean', () => {
		const d = data();
		d.full[1] = null;
		expect(binParsedData(d).full[0]).toBe(3);
	});
});
