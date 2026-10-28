// @ts-nocheck
/**
 * SPEC-U5 (2026-10-03 review, "possible issue, not confirmed"): MovingAnalysis in FFT mode
 * may inherit SPEC-2 (a gap joined up as if the samples were adjacent) and SPEC-3 (magnitude
 * scaled by the padded length) in every window; the per-window fixes were unit-tested in
 * utils/movinganalysis.test.js but never run end to end through the node.
 *
 * Verdict: REFUTED (kept as a guard). Through the node's own `movinganalysis` (real fft.js,
 * real window loop, only the column store mocked):
 *   - SPEC-3: an amplitude-2 24 h cosine reads magnitude 2 and period 24 h in every window, at
 *     window lengths that are and are not a power of two or a whole number of cycles;
 *   - SPEC-2: a window holding a long gap is left blank (NaN) and the node says why; a window
 *     with a short gap (up to 3 missing samples) is interpolated and still reads 24 h; the
 *     windows either side are unaffected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: { set: vi.fn(), get: vi.fn(), has: vi.fn() } },
	appConsts: { processMap: new Map() }
}));
vi.mock('$lib/core/Column.svelte', () => ({
	Column: class {},
	getColumnById: (id) => mockColumns[id],
	removeColumn: vi.fn()
}));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));
vi.mock('$lib/components/plotbits/Table.svelte', () => ({ default: {} }));
vi.mock('$lib/components/LoadingSpinner.svelte', () => ({ default: {} }));
vi.mock('$lib/core/core.svelte.js', () => ({
	pushObj: vi.fn(),
	core: { rawData: { set: vi.fn(), get: vi.fn(), has: vi.fn() } },
	appConsts: { processMap: new Map() }
}));
vi.mock('$lib/utils/time/TimeUtils.js', () => ({ formatTimeFromUNIX: (ms) => String(ms) }));

import { movinganalysis } from './MovingAnalysis.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
});

const ARGS = { xIN: 1, yIN: [2], binLabel: 'start', analysis: 'fft', out: { movex: -1 } };

function wire(t, y) {
	mockColumns[1] = { type: 'number', getData: () => t };
	mockColumns[2] = { getData: () => y };
}

const wave = (ti) => 2 * Math.cos((2 * Math.PI * ti) / 24 + 1) + 10;

describe('SPEC-U5: MovingAnalysis FFT windows end to end', () => {
	it.each([[48], [64], [100], [128], [168]])(
		'SPEC-3: %i h windows read amplitude 2 at 24 h in every window',
		async (windowSize) => {
			const t = Array.from({ length: 480 }, (_, i) => i);
			wire(t, t.map(wave));
			const [res, valid] = await movinganalysis({ ...ARGS, windowSize, stepSize: 48 });
			expect(valid).toBe(true);
			const { peak_period, peak_magnitude } = res.y_results[2];
			expect(peak_period.length).toBeGreaterThan(2);
			for (let w = 0; w < peak_period.length; w++) {
				expect(peak_period[w]).toBeCloseTo(24, 2);
				expect(peak_magnitude[w]).toBeCloseTo(2, 2);
			}
		}
	);

	it('SPEC-3 at half-hour sampling: the magnitude does not depend on the sample count', async () => {
		const t = Array.from({ length: 960 }, (_, i) => i * 0.5);
		wire(t, t.map(wave));
		const [res] = await movinganalysis({ ...ARGS, windowSize: 100, stepSize: 100 });
		for (const m of res.y_results[2].peak_magnitude) expect(m).toBeCloseTo(2, 2);
	});

	it('SPEC-2: a long gap blanks its window (with a reason); a short gap is interpolated', async () => {
		// Windows of 96 h every 96 h over 480 h: [0,96) [96,192) [192,288) [288,384).
		// Window 1 loses 30 h (long gap); window 2 loses 3 samples (short gap).
		const t = [];
		const y = [];
		for (let i = 0; i < 480; i++) {
			if (i >= 130 && i < 160) continue;
			if (i >= 230 && i < 233) continue;
			t.push(i);
			y.push(wave(i));
		}
		wire(t, y);
		const [res, valid] = await movinganalysis({ ...ARGS, windowSize: 96, stepSize: 96 });
		expect(valid).toBe(true);
		const { peak_period, peak_magnitude } = res.y_results[2];
		expect(peak_period[0]).toBeCloseTo(24, 3);
		expect(Number.isNaN(peak_period[1])).toBe(true);
		expect(Number.isNaN(peak_magnitude[1])).toBe(true);
		expect(peak_period[2]).toBeCloseTo(24, 2); // 23.998: linear interpolation of a cosine
		expect(peak_magnitude[2]).toBeCloseTo(2, 2);
		expect(peak_period[3]).toBeCloseTo(24, 3);
		expect(res.warnings.join(' ')).toMatch(
			/1 of \d+ windows? was skipped: the FFT needs evenly spaced samples/
		);
	});
});
