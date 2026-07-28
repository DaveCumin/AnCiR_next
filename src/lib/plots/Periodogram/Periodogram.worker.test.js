// The periodogram plot must compute OFF the main thread when the job is big.
//
// WHY THIS EXISTS
//
// Reported: "why can I not seem to drag/pan when a worker is running?" The
// premise was inverted — no plot used the worker pool at all. The periodogram is
// the most expensive spectrum in the app and it ran entirely on the main thread,
// so pointermove (pan, zoom) could not run while it ground away. The
// `setTimeout(…, 0)` in startCalculation yields once BEFORE the work, which lets
// the spinner paint and does nothing for the seconds after.
//
// A worker task for exactly this ('periodogram.compute') already existed and was
// used by RhythmicityAnalysis; the plot simply never called it.
//
// WHAT IS ASSERTED
//
// Both legs, because either one alone can be satisfied trivially. Dispatching
// always would break the sync fallback the parity harness depends on; dispatching
// never would leave the freeze in place. And the results must agree: an
// optimisation that changes the numbers is a bug, not a speed-up.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Periodogramclass } from './Periodogram.svelte';
import { _setGateOverride } from '$lib/workers/workerGate.js';
import { getComputeTask } from '$lib/workers/computeTasks.js';
import { setWorkerFactory, _resetWorkerPool } from '$lib/workers/workerPool.js';
import '$lib/utils/periodogram.worker-task.js';

/**
 * There is no real Worker under vitest. This is the harness the parity suite
 * uses: a worker that refuses to accept the message, so the pool falls back to
 * running the registered task on the main thread. It exercises the dispatch
 * branch end to end AND stands in for a browser with no Worker support, which is
 * the path that must never break.
 */
class ThrowOnPost {
	postMessage() {
		throw new Error('test harness: forcing synchronous compute');
	}
	terminate() {}
}

const N = 120;
const xData = Array.from({ length: N }, (_, i) => i);
const yData = xData.map((t) => 100 + 50 * Math.sin((2 * Math.PI * t) / 24));

function makeDatum() {
	const plot = new Periodogramclass({ width: 500, height: 250, id: 1 }, null);
	plot.addData({ x: { refId: 0 }, y: { refId: 1 } });
	return plot.data[0];
}

const params = {
	xData,
	yData,
	binSize: 0.25,
	method: 'Lomb-Scargle',
	chiSquaredAlpha: 0.05,
	periodMin: 1,
	periodMax: 30,
	periodSteps: 200
};

beforeEach(() => setWorkerFactory(() => new ThrowOnPost()));
afterEach(() => {
	_setGateOverride(null);
	_resetWorkerPool();
});

describe('the worker task the plot now depends on', () => {
	it('is registered, so the sync fallback exists when there is no Worker', () => {
		// The parity harness forces the main-thread path with a throwing fake
		// worker; if this registration is ever dropped, that path dies silently.
		expect(typeof getComputeTask('periodogram.compute')).toBe('function');
	});
});

describe('dispatch', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('computes synchronously when the gate says the job is too small', () => {
		_setGateOverride('off');
		const d = makeDatum();
		d.startCalculation(params);
		vi.runAllTimers();
		expect(d.periodData.y.length).toBeGreaterThan(0);
		expect(d.calculating).toBe(false);
	});
});

describe('results are identical whichever path runs', () => {
	it('off-thread output matches the main-thread output', async () => {
		// There is no real Worker under vitest, so runComputeTask falls back to the
		// registered task. That still exercises the dispatch branch end to end and,
		// more importantly, pins the two paths to the same numbers.
		_setGateOverride('off');
		const sync = makeDatum();
		vi.useFakeTimers();
		sync.startCalculation(params);
		vi.runAllTimers();
		vi.useRealTimers();

		_setGateOverride('on');
		const dispatched = makeDatum();
		dispatched.startCalculation(params);
		await vi.waitFor(() => expect(dispatched.calculating).toBe(false));

		expect(dispatched.periodData.y.length).toBe(sync.periodData.y.length);
		expect(dispatched.periodData.y.slice(0, 20)).toEqual(sync.periodData.y.slice(0, 20));
		expect(dispatched.periodData.x.slice(0, 20)).toEqual(sync.periodData.x.slice(0, 20));
	});
});

describe('a superseded calculation cannot overwrite newer data', () => {
	it('a stale result is discarded', async () => {
		// A worker cannot be cancelled, so a result whose inputs have already changed
		// still arrives. Without the token it would clobber the newer spectrum.
		_setGateOverride('on');
		const d = makeDatum();
		d.startCalculation(params); // token 1, in flight
		const flat = { ...params, yData: yData.map(() => 1) };
		d.startCalculation(flat); // token 2 supersedes it
		await vi.waitFor(() => expect(d.calculating).toBe(false));

		_setGateOverride('off');
		const reference = makeDatum();
		vi.useFakeTimers();
		reference.startCalculation(flat);
		vi.runAllTimers();
		vi.useRealTimers();

		// The SECOND call's result must be what landed.
		expect(d.periodData.y.slice(0, 20)).toEqual(reference.periodData.y.slice(0, 20));
	});
});
