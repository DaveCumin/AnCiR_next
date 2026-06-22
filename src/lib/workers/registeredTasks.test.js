// Guards the worker-side compute path: every heavy task that a table process
// dispatches via runComputeTask must be registered on the registry (the worker
// runs getComputeTask(name)(args)), and the registered fn must produce the same
// result as calling the underlying util directly. If a task module stops
// self-registering, or its payload contract drifts, this fails.
import { describe, it, expect } from 'vitest';
import { getComputeTask, listComputeTasks } from './computeTasks.js';

// Importing the task modules registers them (same side-effect as compute.worker.js).
import '$lib/utils/cosinor.worker-task.js';
import '$lib/utils/smoothing.worker-task.js';
import '$lib/utils/periodogram.worker-task.js';
import '$lib/utils/movinganalysis.worker-task.js';
import '$lib/utils/fitFunction.worker-task.js';
import '$lib/utils/doublelogistic.worker-task.js';
import '$lib/utils/trendfit.worker-task.js';

import { computeMovingWindows } from '$lib/utils/movinganalysis.js';
import { fitCurveModel } from '$lib/utils/fitFunction.js';
import { fitDoubleLogistic } from '$lib/utils/doublelogistic.js';
import { fitTrendSync } from '$lib/utils/trendfit.js';

describe('worker compute-task registry', () => {
	it('registers every dispatched task', () => {
		const names = listComputeTasks();
		for (const n of [
			'cosinor.fitMany',
			'smoothing.apply',
			'periodogram.compute',
			'movingAnalysis.compute',
			'fitfunction.fit',
			'doublelogistic.fit',
			'trendfit.fit'
		]) {
			expect(names, `task ${n} registered`).toContain(n);
			expect(typeof getComputeTask(n)).toBe('function');
		}
	});

	// The worker executes getComputeTask(name)(payload); confirm that path equals a
	// direct util call for each newly-offloaded analysis.
	const t = Array.from({ length: 24 }, (_, i) => i);
	const y = t.map((h) => 50 + 10 * Math.cos((2 * Math.PI * h) / 24));

	it('movingAnalysis.compute matches the direct util', () => {
		const params = {
			tAll: t,
			ys: [y],
			starts: [0],
			windowSize: 24,
			statKeys: ['peak_period', 'peak_power'],
			args: { analysis: 'periodogram', periodMin: 20, periodMax: 28, periodStep: 0.5 }
		};
		expect(getComputeTask('movingAnalysis.compute')(params)).toEqual(computeMovingWindows(params));
	});

	it('fitfunction.fit matches the direct util', () => {
		const opts = { useFixedPeriod: true, fixedPeriod: 24, nHarmonics: 1 };
		expect(getComputeTask('fitfunction.fit')({ tt: t, yy: y, model: 'cosinor', options: opts }))
			.toEqual(fitCurveModel(t, y, 'cosinor', opts));
	});

	it('doublelogistic.fit matches the direct util', () => {
		const opts = { periodic: true, fixK1: false, fixK2: false, fixPeriod: false };
		expect(getComputeTask('doublelogistic.fit')({ tt: t, yy: y, opts }))
			.toEqual(fitDoubleLogistic(t, y, opts));
	});

	it('trendfit.fit matches the direct util', () => {
		expect(getComputeTask('trendfit.fit')({ tt: t, yy: y, model: 'linear', polyDegree: 2 }))
			.toEqual(fitTrendSync(t, y, 'linear', 2));
	});
});
