// @ts-nocheck
// A worker pool whose "workers" run the REAL compute.worker.js message handler on the
// main thread, with every message structured-cloned both ways exactly as postMessage
// would. Tests use it to run the app's above-the-gate path (workers/workerGate.js) end
// to end: the node or plot encodes its payload (workerPool.js), the worker script
// decodes, runs the task and encodes the reply, the pool decodes it.
//
// compute.worker.js talks to a global `self` (onmessage / postMessage). Under the test
// DOM `self` is the window, so the handler is captured once with `self` pointed at a
// private scope, and each call points `self` there again while the handler runs (it
// posts its reply synchronously).
import { setWorkerFactory, _resetWorkerPool } from '$lib/workers/workerPool.js';

const scope = { onmessage: null, postMessage: null };
let handler = null;

async function loadHandler() {
	if (handler) return handler;
	const prev = globalThis.self;
	globalThis.self = scope;
	scope.postMessage = () => {}; // the script's { ready: true } on load
	try {
		await import('$lib/workers/compute.worker.js');
	} finally {
		globalThis.self = prev;
	}
	handler = scope.onmessage;
	if (typeof handler !== 'function') throw new Error('compute.worker.js set no onmessage');
	return handler;
}

class LoopbackWorker {
	constructor() {
		this.onmessage = null;
		this.onerror = null;
		this.sent = 0;
		// The real script announces itself; the pool treats a worker as started once it
		// has sent any message.
		setTimeout(() => this.onmessage?.({ data: { ready: true } }), 0);
	}
	postMessage(msg) {
		this.sent++;
		const request = structuredClone(msg);
		const prev = globalThis.self;
		const replies = [];
		globalThis.self = scope;
		scope.postMessage = (reply) => replies.push(structuredClone(reply));
		try {
			handler({ data: request });
		} finally {
			globalThis.self = prev;
		}
		for (const reply of replies) setTimeout(() => this.onmessage?.({ data: reply }), 0);
	}
	terminate() {}
}

/** Every LoopbackWorker made since the last install, so a test can see the worker was used. */
export const loopbackWorkers = [];

/** Route runComputeTask through the real worker script (call in beforeAll/beforeEach). */
export async function installLoopbackWorkers() {
	await loadHandler();
	loopbackWorkers.length = 0;
	setWorkerFactory(() => {
		const w = new LoopbackWorker();
		loopbackWorkers.push(w);
		return w;
	});
}

/** Number of task messages the loopback workers received since install. */
export function loopbackTaskCount() {
	return loopbackWorkers.reduce((n, w) => n + w.sent, 0);
}

/** Back to the default pool (call in afterAll). */
export function uninstallLoopbackWorkers() {
	setWorkerFactory(null);
	_resetWorkerPool();
}
