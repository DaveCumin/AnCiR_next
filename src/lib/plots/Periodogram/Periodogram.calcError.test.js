// ROB-11 on the Periodogram plot: a calculation that throws used to be logged and nothing
// else. The previous spectrum (and its peak, and the plot's metric output ports) stayed up
// for inputs it was not computed from, and nothing on the plot said anything had failed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as periodogram from '$lib/utils/periodogram.js';
import { Periodogramclass } from './Periodogram.svelte';

const N = 120;
const xData = Array.from({ length: N }, (_, i) => i);
const yData = xData.map((t) => 100 + 50 * Math.sin((2 * Math.PI * t) / 24));

function makeDatum() {
	const plot = new Periodogramclass({ width: 500, height: 250, id: 1 }, null);
	plot.addData({ x: { refId: 0 }, y: { refId: 1 } });
	return plot.data[0];
}
const trigger = (d, binSize = 0.25) =>
	d.triggerCalculation(
		xData,
		yData,
		binSize,
		'Lomb-Scargle',
		0.05,
		0.25,
		1,
		30,
		'hx',
		`hy${binSize}`
	);

describe('Periodogram calc failure', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('empties the spectrum, reports the error, and a retry recovers', () => {
		const d = makeDatum();
		trigger(d);
		vi.runAllTimers();
		expect(d.periodData.y.length).toBeGreaterThan(0);
		expect(d.peak).not.toBeNull();

		const spy = vi.spyOn(periodogram, 'runPeriodogramCalculation').mockImplementation(() => {
			throw new RangeError('Invalid array length');
		});
		trigger(d, 0.5);
		vi.runAllTimers();
		expect(d.calculating).toBe(false);
		expect(d.calcError).toBe('Invalid array length');
		expect(d.periodData.y.length).toBe(0);
		expect(d.peak).toBeNull();

		spy.mockRestore();
		d.retryCalculation();
		vi.runAllTimers();
		expect(d.calcError).toBeNull();
		expect(d.periodData.y.length).toBeGreaterThan(0);
	});
});
