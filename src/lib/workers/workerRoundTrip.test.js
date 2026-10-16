// @ts-nocheck
// Every compute task, run the way a worker runs it: the payload goes through the same
// encode (prepareTransferable) -> structured clone -> decode (restoreFromTransferable)
// that workerPool.js and compute.worker.js apply, and so does the result on the way back.
// The answer must equal a direct main-thread call. Which path runs is decided only by
// input size (workerGate.js), so any difference is a bug the user meets only on a
// large enough record.
//
// The bug behind this file: a Cosinor on four imported days (580 rows) failed with
// "Arrays t and x must have the same length" (free period) or "y is not iterable"
// (fixed period; "r is not iterable" in the minified build), while one day (145 rows)
// fitted fine. 500 valid points is the worker threshold. The encoder turned any array
// whose first element was not a string into ONE Float64Array, so `ys: [y]` arrived in
// the worker as [NaN], and an array of result objects came back as [NaN].
// registeredTasks.test.js calls the tasks directly and never saw the transport.
import { describe, it, expect } from 'vitest';
import { getComputeTask } from './computeTasks.js';
import { prepareTransferable, restoreFromTransferable } from './workerTransfer.js';

import '$lib/utils/cosinor.worker-task.js';
import '$lib/utils/smoothing.worker-task.js';
import '$lib/utils/periodogram.worker-task.js';
import '$lib/utils/movinganalysis.worker-task.js';
import '$lib/utils/fitFunction.worker-task.js';
import '$lib/utils/doublelogistic.worker-task.js';
import '$lib/utils/trendfit.worker-task.js';

/** The worker path, minus the thread: what workerPool.js + compute.worker.js do to the data. */
function viaWorkerTransport(name, args) {
	const sent = structuredClone(prepareTransferable(args, []));
	const result = getComputeTask(name)(restoreFromTransferable(sent));
	return restoreFromTransferable(structuredClone(prepareTransferable(result, [])));
}

// The shape of the reported files: four days of 10.7-min samples (580 rows), x in hours
// from the unix-second timestamps, and blank cells (null) in runs and singly. The
// occupancy-like series has 544 valid points, over the 500-point worker threshold.
const N = 580;
const DT_H = 640 / 3600;
const tHours = Array.from({ length: N }, (_, i) => i * DT_H);
const occupancy = tHours.map((h, i) => {
	if (i % 16 === 3) return null; // the scattered blank rows every file has
	return 0.4 + 0.3 * Math.cos((2 * Math.PI * (h - 13)) / 24) + 0.05 * Math.sin(i * 1.7);
});
const valid = tHours.map((_, i) => i).filter((i) => occupancy[i] != null);
const tt = valid.map((i) => tHours[i]);
const yy = valid.map((i) => occupancy[i]);

describe('compute tasks give the same answer through the worker transport', () => {
	it('the reported record is large enough to be sent to a worker', () => {
		expect(tt.length).toBeGreaterThanOrEqual(500);
	});

	it('cosinor.fitMany, fixed period (was "y is not iterable")', () => {
		const args = {
			t: tt,
			ys: [yy],
			Ncurves: 1,
			useFixedPeriod: true,
			fixedPeriod: 24,
			nHarmonics: 1,
			alpha: 0.05
		};
		const direct = getComputeTask('cosinor.fitMany')(args);
		expect(direct.results[0].harmonics[0].amplitude).toBeCloseTo(0.3, 1);
		expect(viaWorkerTransport('cosinor.fitMany', args)).toEqual(direct);
	});

	it('cosinor.fitMany, free period (was "Arrays t and x must have the same length")', () => {
		const args = {
			t: tt,
			ys: [yy],
			Ncurves: 1,
			useFixedPeriod: false,
			minPeriod: 16,
			maxPeriod: 32
		};
		const direct = getComputeTask('cosinor.fitMany')(args);
		expect(direct.results[0].parameters.cosines[0].frequency).toBeCloseTo((2 * Math.PI) / 24, 2);
		expect(viaWorkerTransport('cosinor.fitMany', args)).toEqual(direct);
	});

	it('cosinor.fitMany, a failed fit comes back as null', () => {
		const args = { t: [0, 1], ys: [[0, 1]], useFixedPeriod: true, fixedPeriod: 24, nHarmonics: 1 };
		expect(viaWorkerTransport('cosinor.fitMany', args)).toEqual({ results: [null] });
	});

	it('smoothing.apply', () => {
		const args = {
			xs: [tt],
			ys: [yy],
			smootherType: 'moving',
			options: { movingAvgWindowSize: 5 }
		};
		const direct = getComputeTask('smoothing.apply')(args);
		expect(direct.results[0]).toHaveLength(tt.length);
		expect(viaWorkerTransport('smoothing.apply', args)).toEqual(direct);
	});

	it('movingAnalysis.compute (raw columns with blanks, several windows)', () => {
		const args = {
			tAll: tHours,
			ys: [occupancy, occupancy.map((v) => (v == null ? null : v * 2))],
			starts: [0, 24, 48],
			windowSize: 48,
			statKeys: ['peak_period', 'peak_power'],
			args: {
				analysis: 'periodogram',
				periodMin: 16,
				periodMax: 32,
				periodStep: 0.5,
				yIN: [2, 3],
				preProcesses: [{ processName: 'x', processArgs: {} }]
			},
			phase: { recordStart: 0, ref: { clock: false, offsetHours: 0 } }
		};
		const direct = getComputeTask('movingAnalysis.compute')(args);
		expect(direct).toHaveLength(2);
		expect(viaWorkerTransport('movingAnalysis.compute', args)).toEqual(direct);
	});

	it('periodogram.compute', () => {
		const args = {
			method: 'Lomb-Scargle',
			xData: tt,
			yData: yy,
			periodMin: 16,
			periodMax: 32,
			periodSteps: 0.5
		};
		expect(viaWorkerTransport('periodogram.compute', args)).toEqual(
			getComputeTask('periodogram.compute')(args)
		);
	});

	it('fitfunction.fit (cosinor model)', () => {
		const args = {
			tt,
			yy,
			model: 'cosinor',
			options: { useFixedPeriod: true, fixedPeriod: 24, nHarmonics: 1 }
		};
		expect(viaWorkerTransport('fitfunction.fit', args)).toEqual(
			getComputeTask('fitfunction.fit')(args)
		);
	});

	it('doublelogistic.fit', () => {
		const args = { tt, yy, opts: { periodic: true, fixK1: false, fixK2: false, fixPeriod: false } };
		expect(viaWorkerTransport('doublelogistic.fit', args)).toEqual(
			getComputeTask('doublelogistic.fit')(args)
		);
	});

	it('trendfit.fit', () => {
		const args = { tt, yy, model: 'linear', polyDegree: 2 };
		expect(viaWorkerTransport('trendfit.fit', args)).toEqual(getComputeTask('trendfit.fit')(args));
	});
});
