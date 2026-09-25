/**
 * The correlogram's reported peak: the dominant PERIOD of the series, which is
 * what the Data panel prints ("Peak Lag: … hrs") and what the plot's peak_lag /
 * peak_correlation metric ports emit.
 *
 * Neither the trivial lag 0 (always exactly 1) nor a plain maximum over the rest
 * of the lags: this estimator normalises each lag by its own overlap count, so a
 * repeat at 2P or 3P is computed from fewer pairs and comes out ABOVE the
 * fundamental. The shipped 24 h demo used to report a 48 h period for that
 * reason. See findAutocorrelationPeak in utils/correlogram.js.
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

// The shipped demo-correlogram-rhythm shape: a 24 h rhythm, hourly, seven days.
const HOURS = Array.from({ length: 24 * 7 }, (_, i) => i);
const ACTIVITY = HOURS.map((h) => 50 + 40 * Math.cos((2 * Math.PI * h) / 24));

function mkPlot() {
	const wrapper = { id: 1, type: 'correlogram', name: 'c', width: 400, height: 300, plot: null };
	const c = new Correlogramclass(wrapper, null);
	c.padding = { top: 20, right: 30, bottom: 30, left: 50 };
	c.addData({ x: { refId: mkCol('hour', HOURS) }, y: { refId: mkCol('activity', ACTIVITY) } });
	wrapper.plot = c;
	return c;
}

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
});
afterEach(cleanup);

describe('Correlogram peak', () => {
	it('reports the period of a 24 h rhythm, not a repeat of it', () => {
		const series = mkPlot().data[0];
		expect(series.peak.lag).toBe(24);
		expect(series.peak.correlation).toBeGreaterThan(0.9);
		// A plain maximum over the non-zero lags lands on a repeat, not on 24.
		const { lags, correlations } = series.acfData;
		let naive = 1;
		for (let i = 2; i < correlations.length; i++) {
			if (correlations[i] > correlations[naive]) naive = i;
		}
		expect(lags[naive]).not.toBe(24);
		expect(correlations[naive]).toBeGreaterThanOrEqual(series.peak.correlation);
	});

	it('reads the visible window, so zooming past the first lobe moves the peak', () => {
		const c = mkPlot();
		c.laglimsIN = [30, 60];
		expect(c.data[0].visiblePeak.lag).toBe(48);
	});

	it('does not drop the first lag when minLag pushes the correlogram off zero', () => {
		// The old peak search skipped index 0 unconditionally on the assumption that
		// it was lag 0. With minLag set there is no lag 0, so that threw away a real
		// candidate: here the whole window is the single rising flank 20-24 h.
		const series = mkPlot().data[0];
		series.minLag = 24;
		series.maxLag = 26;
		expect(series.acfData.lags[0]).toBe(24);
		expect(series.peak).toMatchObject({ lag: 24 });
	});
});
