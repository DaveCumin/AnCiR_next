import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Periodogramclass } from './Periodogram.svelte';

// Regression: the debounced periodogram calc used to commit its result-cache
// fingerprint at SCHEDULE time. If the scheduled calc was then cancelled (the
// component unmounting mid session-load calls cleanup(), clearing the timer),
// periodData stayed empty while the cache claimed it was computed — so every
// later effect run hit the "nothing changed" early-return and the plot rendered
// blank forever. The fix commits the cache only after the calc actually lands.

function makeDatum() {
	const plot = new Periodogramclass({ width: 500, height: 250, id: 1 }, null);
	plot.addData({ x: { refId: 0 }, y: { refId: 1 } });
	return plot.data[0];
}

// A clean 24 h sinusoid sampled hourly for 5 days — enough for a real peak.
const N = 120;
const xData = Array.from({ length: N }, (_, i) => i);
const yData = xData.map((t) => 100 + 50 * Math.sin((2 * Math.PI * t) / 24));

function trigger(d) {
	d.triggerCalculation(xData, yData, 0.25, 'Lomb-Scargle', 0.05, 0.25, 1, 30, 'hx', 'hy');
}

describe('Periodogram calc: cache is committed only after the calc runs', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('a cancelled (unmounted mid-debounce) calc does not poison the cache', () => {
		const d = makeDatum();
		trigger(d); // schedules the 250 ms debounced calc
		d.cleanup(); // component unmounts before it fires — timer cleared
		vi.runAllTimers();

		// Calc never ran → periodData empty AND the cache must NOT claim it computed.
		expect(d.periodData.y.length).toBe(0);
		expect(d._cache.dataFingerprint).toBeNull();

		// A fresh effect run (remounted component) must now recompute, not skip.
		trigger(d);
		vi.runAllTimers();
		expect(d.periodData.y.length).toBeGreaterThan(0);
		expect(d._cache.dataFingerprint).not.toBeNull();
	});

	it('a completed calc commits the cache and skips redundant recompute', () => {
		const d = makeDatum();
		trigger(d);
		vi.runAllTimers();
		expect(d.periodData.y.length).toBeGreaterThan(0);
		const fp = d._cache.dataFingerprint;
		expect(fp).not.toBeNull();

		// Same data again → cache hit, no new schedule needed, data preserved.
		trigger(d);
		vi.runAllTimers();
		expect(d._cache.dataFingerprint).toBe(fp);
		expect(d.periodData.y.length).toBeGreaterThan(0);
	});
});
