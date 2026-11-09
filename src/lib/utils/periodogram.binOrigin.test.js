// Bin origin when the bin is wider than the sampling interval and the record does not start
// on the bin grid: 15-min samples (dt 0.25 h) from t = 0.5 h, binned at 1 h. binOrigin is
// min - g / 2 with g = gcd(dt, binSize) = 0.25, so the origin is 0.5 - 0.125 = 0.375 h and
// the bins are [0.375 + k, 1.375 + k). Each holds exactly 4 samples (0.5, 0.75, 1, 1.25 in
// the first), with every sample at least g / 2 from an edge. The old binSize-grid origin,
// floor(0.5 / 1) * 1 = 0, put only 2 samples in the first bin. Pinned across JS, Python and R
// by the pure-periodogram-bins-offset-start parity fixture.
import { describe, it, expect } from 'vitest';
import { binData } from '$lib/components/plotbits/helpers/wrangleData.js';
import { binOrigin } from './periodogram.js';

const DT = 0.25;
const BIN = 1;
const N = 96; // one day of 15-min samples

const t = Array.from({ length: N }, (_, k) => 0.5 + k * DT);
const y = t.map((x) => 10 + 5 * Math.cos((2 * Math.PI * x) / 24));

describe('binOrigin with bin > dt and an offset start', () => {
	it('is min - gcd(dt, binSize) / 2 = 0.375', () => {
		expect(binOrigin(t, BIN)).toBeCloseTo(0.375, 12);
	});

	it('gives every bin 4 samples', () => {
		const counts = binData(t, y, BIN, binOrigin(t, BIN), null, 'count').y_out;
		const filled = counts.filter((c) => c > 0);
		expect(filled.length).toBe(N / 4);
		expect(new Set(filled)).toEqual(new Set([4]));
		// The loop pushes at most one trailing bin at or past the last sample; it is empty.
		expect(counts.slice(filled.length).every((c) => c === 0)).toBe(true);
	});

	it('starts the bins at 0.375 + k (centres 0.875 + k)', () => {
		const { bins, binEnds } = binData(t, y, BIN, binOrigin(t, BIN), null, 'count');
		for (let k = 0; k < N / 4; k++) {
			expect(bins[k]).toBeCloseTo(0.375 + k, 12);
			expect(binEnds[k]).toBeCloseTo(1.375 + k, 12);
			expect((bins[k] + binEnds[k]) / 2).toBeCloseTo(0.875 + k, 12);
		}
	});

	it('groups samples 0.5, 0.75, 1, 1.25 into the first bin', () => {
		const o = binOrigin(t, BIN);
		const first = t.filter((x) => x >= o && x < o + BIN);
		expect(first).toEqual([0.5, 0.75, 1, 1.25]);
	});

	it('keeps every sample at least g / 2 = 0.125 from a bin edge', () => {
		const o = binOrigin(t, BIN);
		for (const x of t) {
			const pos = (x - o) / BIN - Math.floor((x - o) / BIN); // fraction into its bin
			expect(pos * BIN).toBeGreaterThanOrEqual(0.125 - 1e-12);
			expect((1 - pos) * BIN).toBeGreaterThanOrEqual(0.125 - 1e-12);
		}
	});
});
