// "Download data" / "View data" for the CWT used to emit one row per cell: 250,000
// samples x 45 periods is over 11 million rows. scalogramExport keeps small scalograms
// exact and bins time on long ones, with a note the download shows to the user.
import { describe, it, expect } from 'vitest';
import { scalogramExport, CWT_EXPORT_MAX_ROWS } from './CWT.svelte';

/** A fake transform: power[j][i] = j * 1000 + i, so bin means are easy to check. */
function transform(nT, nP) {
	const times = Array.from({ length: nT }, (_, i) => i * 0.25);
	const periods = Array.from({ length: nP }, (_, j) => 2 + j);
	const power = periods.map((_, j) => Float64Array.from({ length: nT }, (_, i) => j * 1000 + i));
	return { valid: true, times, periods, power };
}

describe('scalogramExport', () => {
	it('exports every cell of a small scalogram, time fastest, with no note', () => {
		const out = scalogramExport(transform(3, 2));
		expect(out.headers).toEqual(['time', 'period', 'power']);
		expect(out.rows).toEqual([
			[0, 2, 0],
			[0.25, 2, 1],
			[0.5, 2, 2],
			[0, 3, 1000],
			[0.25, 3, 1001],
			[0.5, 3, 1002]
		]);
		expect(out.note).toBeUndefined();
	});

	it('bins time to stay under the row cap, keeping every period, and says so', () => {
		const out = scalogramExport(transform(12, 2), 6); // 3 time bins of 4 samples
		expect(out.rows).toEqual([
			[0.375, 2, 1.5],
			[1.375, 2, 5.5],
			[2.375, 2, 9.5],
			[0.375, 3, 1001.5],
			[1.375, 3, 1005.5],
			[2.375, 3, 1009.5]
		]);
		expect(out.note).toMatch(/12 time points x 2 periods \(24 cells\)/);
		expect(out.note).toMatch(/averaged over about 4\.0 consecutive samples/);
	});

	it('caps a 250,000-sample, 45-period scalogram at the export limit', () => {
		const tr = transform(250_000, 45);
		const out = scalogramExport(tr);
		expect(out.rows.length).toBeLessThanOrEqual(CWT_EXPORT_MAX_ROWS);
		expect(out.rows.length).toBeGreaterThan(CWT_EXPORT_MAX_ROWS * 0.99);
		expect(new Set(out.rows.map((r) => r[1])).size).toBe(45);
		expect(out.note).toMatch(/11,250,000 cells/);
	});

	it('exports nothing for an invalid transform', () => {
		expect(scalogramExport({ valid: false }).rows).toEqual([]);
	});
});
