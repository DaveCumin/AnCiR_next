// The shared time origin and phase reference (review FIT-9, STAT-19).
import { describe, it, expect } from 'vitest';
import {
	timeOriginMs,
	fitTimeFrame,
	clockHourOfDay,
	resolvePhaseReference,
	applyPhaseReference,
	relabelFoldedProfile,
	nearestPhaseInstant
} from './phaseReference.js';

const H = 3600000;
const T0 = Date.UTC(2026, 0, 5, 7, 0, 0); // 07:00 UTC

function timeCol(data) {
	const valid = data.filter((v) => v != null && v !== '');
	const m = Math.min(...valid);
	return {
		type: 'time',
		getData: () => data,
		hoursSinceStart: data.map((v) => (v == null || v === '' ? null : (v - m) / H))
	};
}
const numCol = (data) => ({ type: 'number', getData: () => data });

describe('timeOriginMs', () => {
	it('is the minimum valid timestamp, not the first row', () => {
		// Unsorted, with a missing first row: getData()[0] would be null (and the
		// old code then fell back to... nothing), and t[0] is not the earliest.
		const col = timeCol([null, T0 + 5 * H, T0, T0 + 2 * H]);
		expect(timeOriginMs(col)).toBe(T0);
	});
	it('treats blank strings as missing', () => {
		expect(timeOriginMs(timeCol(['', T0 + H, T0 + 3 * H]))).toBe(T0 + H);
	});
	it('is null for a numeric column or no valid value', () => {
		expect(timeOriginMs(numCol([1, 2, 3]))).toBeNull();
		expect(timeOriginMs(timeCol([null, null]))).toBeNull();
		expect(timeOriginMs(null)).toBeNull();
	});
});

describe('fitTimeFrame', () => {
	it('expresses a time output grid in the INPUT column frame', () => {
		// Input starts at 07:00; the output grid starts two hours later. The model is
		// in input hours, so grid hour 0 must be 2 h, not 0 h.
		const tCol = timeCol([T0, T0 + H, T0 + 2 * H, T0 + 3 * H]);
		const outCol = timeCol([T0 + 2 * H, T0 + 2.5 * H, null]);
		const f = fitTimeFrame(tCol, outCol);
		expect(f.originTime_ms).toBe(T0);
		expect(f.outputXData).toEqual([2, 2.5]);
	});
	it('uses the minimum of an unsorted input whose first row is missing', () => {
		const tCol = timeCol([null, T0 + 3 * H, T0, T0 + H]);
		expect(fitTimeFrame(tCol).originTime_ms).toBe(T0);
		expect(fitTimeFrame(tCol).outputXData).toBeNull();
	});
	it('keeps a numeric output grid as hours in the input frame', () => {
		const f = fitTimeFrame(timeCol([T0, T0 + H]), numCol([0, 0.5, null, 1]));
		expect(f.originTime_ms).toBe(T0);
		expect(f.outputXData).toEqual([0, 0.5, 1]);
	});
	it('numeric input with a time grid: the grid keeps its own frame', () => {
		const outCol = timeCol([T0 + H, T0]);
		const f = fitTimeFrame(numCol([0, 1, 2]), outCol);
		expect(f.originTime_ms).toBe(T0);
		expect(f.outputXData).toEqual([1, 0]);
	});
	it('numeric input and no grid: no origin', () => {
		expect(fitTimeFrame(numCol([5, 6])).originTime_ms).toBeNull();
	});
});

describe('clockHourOfDay', () => {
	it('reads the wall clock in UTC by default', () => {
		expect(clockHourOfDay(T0)).toBe(7);
		expect(clockHourOfDay(Date.UTC(2026, 0, 5, 14, 30, 36))).toBeCloseTo(14.51, 10);
	});
	it('honours an IANA display zone', () => {
		// Auckland is UTC+13 in January (daylight time): 07:00 UTC is 20:00 there.
		expect(clockHourOfDay(T0, 'Pacific/Auckland')).toBe(20);
	});
	it('is NaN for a missing instant', () => {
		expect(clockHourOfDay(null)).toBeNaN();
		expect(clockHourOfDay(NaN)).toBeNaN();
	});
});

describe('resolvePhaseReference + applyPhaseReference', () => {
	it('since first sample (the default) leaves a phase untouched, even out of range', () => {
		const ref = resolvePhaseReference(undefined, T0);
		expect(ref).toEqual({ clock: false, offsetHours: 0, warning: null });
		expect(applyPhaseReference(7, ref, 24)).toBe(7);
		// Not re-wrapped: byte-identical to sessions saved before the option existed.
		expect(applyPhaseReference(30.5, ref, 24)).toBe(30.5);
		expect(applyPhaseReference(-1, ref, 24)).toBe(-1);
	});
	it('clock time: a record starting 07:00 with a peak 7 h in reads 14 h', () => {
		const ref = resolvePhaseReference('clock', T0, 'utc');
		expect(ref.clock).toBe(true);
		expect(ref.offsetHours).toBe(7);
		expect(applyPhaseReference(7, ref, 24)).toBe(14);
		// Wrapped to [0, period).
		expect(applyPhaseReference(20, ref, 24)).toBe(3);
		expect(applyPhaseReference(NaN, ref, 24)).toBeNaN();
	});
	it('clock time without a time origin falls back, with a warning', () => {
		const ref = resolvePhaseReference('clock', null, 'utc');
		expect(ref.clock).toBe(false);
		expect(ref.warning).toMatch(/needs a time column/);
		expect(applyPhaseReference(30, ref, 24)).toBe(30);
	});
});

describe('relabelFoldedProfile', () => {
	it('is the identity since first sample', () => {
		const bins = [0.5, 1.5];
		const prof = [1, 2];
		const out = relabelFoldedProfile(bins, [prof], resolvePhaseReference('start'), 2);
		expect(out.binTimes).toBe(bins);
		expect(out.series[0]).toBe(prof);
	});
	it('shifts, wraps and reorders bins (and every parallel array) in clock time', () => {
		const ref = { clock: true, offsetHours: 22 };
		const bins = [0.5, 1.5, 2.5, 3.5];
		const out = relabelFoldedProfile(
			bins,
			[
				[10, 11, 12, 13],
				['a', 'b', 'c', 'd']
			],
			ref,
			24
		);
		// 22.5, 23.5, 0.5, 1.5 → ascending 0.5, 1.5, 22.5, 23.5
		expect(out.binTimes).toEqual([0.5, 1.5, 22.5, 23.5]);
		expect(out.series[0]).toEqual([12, 13, 10, 11]);
		expect(out.series[1]).toEqual(['c', 'd', 'a', 'b']);
	});
});

describe('nearestPhaseInstant', () => {
	it('moves a phase by whole periods to within half a period of the centre', () => {
		expect(nearestPhaseInstant(6, 24, 490)).toBe(486);
		expect(nearestPhaseInstant(6, 24, 0)).toBe(6);
		expect(nearestPhaseInstant(20, 24, 0)).toBe(-4);
		expect(nearestPhaseInstant(NaN, 24, 0)).toBeNaN();
	});
});
