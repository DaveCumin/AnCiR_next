// @ts-nocheck
// src/lib/workers/compute.worker.js
// Vite worker entry. Imports the same registry; task modules self-register on import.
import { getComputeTask } from './computeTasks.js';
import { restoreFromTransferable, prepareTransferable } from './workerTransfer.js';

// Side-effect imports: each heavy compute module registers itself on the registry.
// Keep this list synced with the modules that call registerComputeTask().
import '$lib/utils/cosinor.worker-task.js';
import '$lib/utils/smoothing.worker-task.js';
import '$lib/utils/periodogram.worker-task.js';
import '$lib/utils/movinganalysis.worker-task.js';
import '$lib/utils/fitFunction.worker-task.js';
import '$lib/utils/doublelogistic.worker-task.js';
import '$lib/utils/trendfit.worker-task.js';

self.onmessage = (e) => {
	const { id, name, payload } = e.data ?? {};
	if (!id) return;
	try {
		const fn = getComputeTask(name);
		const args = restoreFromTransferable(payload);
		const result = fn(args);
		const transfers = [];
		const out = prepareTransferable(result, transfers);
		self.postMessage({ id, ok: true, result: out }, transfers);
	} catch (err) {
		self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
	}
};
