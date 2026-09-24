// The plot's worker gate must see the NUMBER of trial periods, not the step.
//
// startCalculation passed `work: params.periodSteps`, but periodSteps is the
// step SIZE in hours (default 0.25), so `work` was always below the gate's
// threshold and a fine sweep over a short record (under 500 samples) always ran
// on the main thread, freezing pan and zoom for its duration.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/workers/workerPool.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, runComputeTask: vi.fn(() => Promise.resolve({ x: [], y: [] })) };
});

import { Periodogramclass } from './Periodogram.svelte';
import { runComputeTask } from '$lib/workers/workerPool.js';

const xData = Array.from({ length: 120 }, (_, i) => i);
const yData = xData.map((t) => 100 + 50 * Math.sin((2 * Math.PI * t) / 24));

function makeDatum() {
	const plot = new Periodogramclass({ width: 500, height: 250, id: 1 }, null);
	plot.addData({ x: { refId: 0 }, y: { refId: 1 } });
	return plot.data[0];
}

const base = {
	xData,
	yData,
	binSize: 0.25,
	method: 'Lomb-Scargle',
	chiSquaredAlpha: 0.05
};

beforeEach(() => {
	// The gate never dispatches where Worker does not exist (as under vitest).
	vi.stubGlobal('Worker', class {});
	vi.useFakeTimers();
	runComputeTask.mockClear();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('Periodogram worker gate', () => {
	it('dispatches a fine sweep over a short record off the main thread', () => {
		// 16..32 h at 0.05 h is 321 trial periods on a 120-sample record.
		makeDatum().startCalculation({ ...base, periodMin: 16, periodMax: 32, periodSteps: 0.05 });
		expect(runComputeTask).toHaveBeenCalledTimes(1);
	});

	it('keeps a small job on the main thread', () => {
		// 20..28 h at 1 h is 9 trial periods.
		makeDatum().startCalculation({ ...base, periodMin: 20, periodMax: 28, periodSteps: 1 });
		expect(runComputeTask).not.toHaveBeenCalled();
		vi.runAllTimers();
	});
});
