// The fitting nodes' output x sequence ("Specify output x values" > Sequence). See
// outputXSequence.js for the rules these pin.
import { describe, it, expect } from 'vitest';
import {
	niceStep,
	defaultOutputXStep,
	outputXSequence,
	outputXIsSequence,
	outputXSpecified,
	outputXMode,
	resolveOutputX,
	OUTPUT_X_LIMIT_LEAD
} from './outputXSequence.js';
import { MAX_GRID_POINTS } from './interpolate.js';

const H = 3600000;
const T0 = Date.UTC(2026, 0, 5, 6, 0, 0);

/** A time column: epoch ms, with hoursSinceStart from the earliest valid time (as Column). */
function timeCol(ms) {
	const valid = ms.filter((v) => v != null && Number.isFinite(Number(v)));
	const lo = Math.min(...valid);
	return {
		type: 'time',
		getData: () => ms,
		hoursSinceStart: ms.map((v) => (v == null ? null : (v - lo) / H))
	};
}
const numberCol = (data) => ({ type: 'number', getData: () => data });

describe('niceStep: the nearest 1-2-5 number on a log scale', () => {
	it('snaps to 1, 2 or 5 times a power of ten', () => {
		expect(niceStep(0.094)).toBe(0.1);
		expect(niceStep(0.096)).toBe(0.1);
		expect(niceStep(0.13)).toBe(0.1);
		expect(niceStep(0.15)).toBe(0.2);
		expect(niceStep(0.3)).toBe(0.2);
		expect(niceStep(0.32)).toBe(0.5);
		expect(niceStep(0.7)).toBe(0.5);
		expect(niceStep(0.71)).toBe(1);
		expect(niceStep(1)).toBe(1);
		expect(niceStep(5)).toBe(5);
		expect(niceStep(240)).toBe(200);
		expect(niceStep(0.0004)).toBe(0.0005);
	});
	it('is null for a value that is not positive and finite', () => {
		expect(niceStep(0)).toBeNull();
		expect(niceStep(-1)).toBeNull();
		expect(niceStep(NaN)).toBeNull();
		expect(niceStep(Infinity)).toBeNull();
	});
});

describe('defaultOutputXStep: span / 500, snapped', () => {
	it('2 days of hourly data gives 0.1 h', () => {
		const hours = Array.from({ length: 48 }, (_, i) => i); // span 47 h
		expect(defaultOutputXStep(hours)).toBe(0.1);
		const hours49 = Array.from({ length: 49 }, (_, i) => i); // span 48 h
		expect(defaultOutputXStep(hours49)).toBe(0.1);
	});
	it('ignores blanks and text, and is null without a span', () => {
		expect(defaultOutputXStep([null, '', 'a', 0, 100])).toBe(0.2);
		expect(defaultOutputXStep([3, 3, null])).toBeNull();
		expect(defaultOutputXStep([])).toBeNull();
	});
});

describe('outputXSequence', () => {
	it('runs from the minimum and includes the maximum when it lands on the grid', () => {
		expect(outputXSequence([2, 0, 1, null], 0.5).values).toEqual([0, 0.5, 1, 1.5, 2]);
	});
	it('stops at the last step at or below the maximum when the maximum is off the grid', () => {
		const r = outputXSequence([0, 1.9], 0.5);
		expect(r.values).toEqual([0, 0.5, 1, 1.5]);
		expect(r.step).toBe(0.5);
	});
	it('starts at the minimum of a number x, wherever it is in the column', () => {
		expect(outputXSequence([10, 12, 11], 1).values).toEqual([10, 11, 12]);
	});
	it('each value is min + i * step (no running-sum drift)', () => {
		const v = outputXSequence([0, 47], 0.1).values;
		expect(v).toHaveLength(471);
		expect(v[470]).toBe(470 * 0.1);
		expect(v[3]).toBe(3 * 0.1);
	});
	it('uses the default step when none (or no positive step) is given', () => {
		const hours = Array.from({ length: 48 }, (_, i) => i);
		for (const step of [null, undefined, '', 0, -1, NaN]) {
			const r = outputXSequence(hours, step);
			expect(r.step, String(step)).toBe(0.1);
			expect(r.values).toHaveLength(471);
		}
	});
	it('makes nothing for an x without a span', () => {
		expect(outputXSequence([5, 5], 1)).toEqual({ values: null, step: null, warning: null });
		expect(outputXSequence([], 1).values).toBeNull();
	});
	it('refuses a step past the 2,000,000-point limit with the shared message', () => {
		const ok = outputXSequence([0, MAX_GRID_POINTS - 1], 1);
		expect(ok.values).toHaveLength(MAX_GRID_POINTS);
		expect(ok.warning).toBeNull();
		const r = outputXSequence([0, 672], 1 / 3600, ' h');
		expect(r.values).toBeNull();
		expect(r.warning).toBe(
			`${OUTPUT_X_LIMIT_LEAD}: a step of 0.000277778 h over 672 h gives 2,419,201 grid ` +
				'points, more than the limit of 2,000,000. Use a step of at least 0.00034 h.'
		);
	});
});

describe('the mode', () => {
	it('is on when outputX is set, and a sequence only when the mode says so', () => {
		expect(outputXSpecified({ outputX: -1 })).toBe(false);
		expect(outputXSpecified({ outputX: 4 })).toBe(true);
		expect(outputXMode({})).toBe('column'); // saved sessions
		expect(outputXMode({ outputXMode: 'sequence' })).toBe('sequence');
		expect(outputXMode({ outputXMode: 'nonsense' })).toBe('column');
		expect(outputXIsSequence({ outputX: 4, outputXMode: 'sequence' })).toBe(true);
		expect(outputXIsSequence({ outputX: -1, outputXMode: 'sequence' })).toBe(false);
		expect(outputXIsSequence({ outputX: 4 })).toBe(false);
	});
});

describe('resolveOutputX', () => {
	const ms = [T0 + 2 * H, T0, null, T0 + 1 * H, T0 + 3 * H];
	const x = timeCol(ms);
	const grid = numberCol([0.25, null, 0.75]);
	const cols = { 1: x, 2: grid };
	const get = (id) => cols[id] ?? null;

	it('column mode is fitTimeFrame on the named column (saved sessions unchanged)', () => {
		const r = resolveOutputX(x, { outputX: 2 }, get);
		expect(r.outputXData).toEqual([0.25, 0.75]);
		expect(r.originTime_ms).toBe(T0);
		expect(r.warning).toBeNull();
		expect(resolveOutputX(x, { outputX: -1, outputXMode: 'sequence' }, get).outputXData).toBe(null);
	});
	it('sequence mode on a time x: hours from the earliest time, origin that time', () => {
		const r = resolveOutputX(x, { outputX: 1, outputXMode: 'sequence', outputXStep: 0.5 }, get);
		expect(r.outputXData).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
		expect(r.originTime_ms).toBe(T0);
		expect(r.warning).toBeNull();
	});
	it('sequence mode ignores which column outputX names', () => {
		const a = resolveOutputX(x, { outputX: 2, outputXMode: 'sequence', outputXStep: 1 }, get);
		expect(a.outputXData).toEqual([0, 1, 2, 3]);
	});
	it('sequence mode on a number x: x units, no time origin', () => {
		const n = numberCol([4, null, 'x', 6, 5]);
		const r = resolveOutputX(n, { outputX: 7, outputXMode: 'sequence', outputXStep: 0.5 }, get);
		expect(r.outputXData).toEqual([4, 4.5, 5, 5.5, 6]);
		expect(r.originTime_ms).toBeNull();
	});
	it('over the limit: no values (the fit falls back to the input x) and the warning', () => {
		const r = resolveOutputX(x, { outputX: 1, outputXMode: 'sequence', outputXStep: 1e-9 }, get);
		expect(r.outputXData).toBeNull();
		expect(r.originTime_ms).toBe(T0);
		expect(r.warning).toMatch(/^No output x sequence was made/);
	});
});
