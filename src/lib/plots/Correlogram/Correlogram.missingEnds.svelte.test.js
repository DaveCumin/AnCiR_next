/**
 * The correlogram's lag step when the x column has a missing FIRST or LAST value.
 *
 * With no binWidth on the x column the step is its mean spacing. That used to be
 * (times[n - 1] - times[0]) / (n - 1) over the raw rows, and JS reads a missing end as 0:
 * a missing last time gave a step of about -t0 / (n - 1), i.e. zero or negative, so the
 * plot was BLANK; a missing first time stretched or shrank the step, so every lag was
 * mislabelled and the reported period was wrong. The step then came from the first and last
 * VALID times, (t_j - t_i) / (j - i). Since SPEC-10 it is the median interval of the valid
 * times (computeAutocorrelation with binSize null), which skips missing rows by construction
 * and is not stretched by a recording gap either.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/svelte';
import { core } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Correlogramclass } from './Correlogram.svelte';

function mkCol(name, values, type = 'number') {
	const c = new Column({ type, data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

// A 24 h rhythm sampled hourly for seven days, starting at 5 h.
const HOURS = Array.from({ length: 24 * 7 }, (_, i) => 5 + i);
const ACTIVITY = HOURS.map((h) => 50 + 40 * Math.cos((2 * Math.PI * h) / 24));

function series(hours, activity = ACTIVITY, type = 'number') {
	const wrapper = { id: 1, type: 'correlogram', name: 'c', width: 400, height: 300, plot: null };
	const c = new Correlogramclass(wrapper, null);
	c.padding = { top: 20, right: 30, bottom: 30, left: 50 };
	c.addData({
		x: { refId: mkCol('hour', hours, type) },
		y: { refId: mkCol('activity', activity) }
	});
	wrapper.plot = c;
	return c.data[0];
}

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
});
afterEach(cleanup);

describe('Correlogram lag step with a missing end', () => {
	it('complete x: step 1 h, period 24 h (the reference)', () => {
		const s = series(HOURS);
		expect(s.acfData.dt).toBe(1);
		expect(s.peak.lag).toBe(24);
	});

	it('a missing LAST time does not blank the plot', () => {
		const s = series([...HOURS.slice(0, -1), null]);
		expect(s.acfData.lags.length).toBeGreaterThan(24);
		expect(s.acfData.dt).toBe(1);
		expect(s.peak.lag).toBe(24);
	});

	it('a missing FIRST time does not change the step or the period', () => {
		const s = series([null, ...HOURS.slice(1)]);
		expect(s.acfData.dt).toBe(1);
		expect(s.peak.lag).toBe(24);
	});

	it('a blank-string end is missing too', () => {
		const s = series(['', ...HOURS.slice(1, -1), '']);
		expect(s.acfData.dt).toBe(1);
		expect(s.peak.lag).toBe(24);
	});

	it('a time column with a missing end', () => {
		const t0 = Date.parse('2024-03-04T00:00:00Z');
		const ms = HOURS.map((h) => t0 + h * 3600000);
		const s = series([null, ...ms.slice(1, -1), null], ACTIVITY, 'time');
		expect(s.acfData.dt).toBe(1);
		expect(s.peak.lag).toBe(24);
	});
});

// SPEC-10: with no binWidth the plot's lag step is the MEDIAN sampling interval, as the
// Rhythmicity node's correlogram uses (computeAutocorrelation with binSize null). The mean
// spacing, (last - first) / (n - 1), is stretched by a recording gap: dropping 12 hourly rows
// gave a step of 167 / 155 = 1.077 h, so every lag slot sat off the hour and the period read
// about 24.8 h instead of 24 h.
describe('Correlogram lag step with a recording gap (SPEC-10)', () => {
	const kept = HOURS.map((h, i) => i).filter((i) => HOURS[i] < 50 || HOURS[i] >= 62);
	const gapHours = kept.map((i) => HOURS[i]);
	const gapActivity = kept.map((i) => ACTIVITY[i]);

	it('the step is the median interval (1 h), not the gap-stretched mean', () => {
		const s = series(gapHours, gapActivity);
		expect(s.acfData.dt).toBe(1);
		expect(s.peak.lag).toBe(24);
	});

	it('a time column with a gap', () => {
		const t0 = Date.parse('2024-03-04T00:00:00Z');
		const s = series(
			gapHours.map((h) => t0 + h * 3600000),
			gapActivity,
			'time'
		);
		expect(s.acfData.dt).toBe(1);
		expect(s.peak.lag).toBe(24);
	});
});
