// @ts-nocheck
// src/lib/workers/workerPool.js
// Worker pool with least-busy dispatch and synchronous fallback on worker errors.

import { getComputeTask, listComputeTasks } from './computeTasks.js';
import { prepareTransferable, restoreFromTransferable } from './workerTransfer.js';
// `?worker&inline` makes Vite bundle the worker and embed its source in this module,
// then start it from a Blob URL (data: URL if Blob URLs are refused). A URL-based
// `new Worker(new URL('./compute.worker.js', import.meta.url))` cannot work in the
// shipped build: kit.output.bundleStrategy 'inline' puts all JS inside index.html,
// so the worker URL resolved against the page (/workers/...) instead of
// /_app/immutable/workers/..., 404'd, and every task silently ran on the main thread.
// Embedding also lets the downloadable offline index.html (opened from file://) use
// the worker with no extra file to fetch.
import ComputeWorker from './compute.worker.js?worker&inline';

const POOL_SIZE_FALLBACK = 3;
const POOL_SIZE_MAX = 8;
function defaultPoolSize() {
	const n =
		typeof navigator !== 'undefined' && Number(navigator.hardwareConcurrency)
			? Number(navigator.hardwareConcurrency) - 1
			: POOL_SIZE_FALLBACK;
	return Math.min(Math.max(n, 1), POOL_SIZE_MAX);
}

let _factory = null;
let _slots = null;
// _nextId is intentionally NOT reset by _resetWorkerPool to avoid id collisions
// with stragglers from terminated workers.
let _nextId = 1;
const _pending = new Map(); // id -> { slotIdx, resolve, reject }
// Set once a worker fails to START (constructor throws, or it errors before sending
// any message, i.e. the script never loaded). From then on every task runs on the
// main thread without re-spawning workers that cannot load.
let _unavailable = null; // null | string (reason)
// Bumped whenever the slots are thrown away, so events from workers of an earlier
// pool (terminated, but with events already queued) cannot touch the current one.
let _generation = 0;

function defaultFactory() {
	return new ComputeWorker({ name: 'ancir-compute' });
}

function warnFallback(name, reason) {
	console.warn(
		`[AnCiR] compute task "${name}" is running on the main thread (${reason}); ` +
			'the page may be unresponsive until it finishes.'
	);
}

/**
 * Mark the pool unusable (workers cannot start here), warn once, terminate the
 * slots and retry everything in flight on the main thread.
 */
function markUnavailable(reason) {
	if (_unavailable) return;
	_unavailable = reason;
	console.warn(
		`[AnCiR] Web Workers are unavailable (${reason}); ` +
			'heavy computations will run on the main thread and may freeze the page.'
	);
	const slots = _slots ?? [];
	_slots = null;
	_generation++;
	for (const s of slots) {
		try {
			s.worker?.terminate?.();
		} catch {
			// already dead
		}
	}
	const entries = [..._pending.values()];
	_pending.clear();
	for (const entry of entries) entry.reject(new Error(reason));
}

/**
 * Replace the Worker factory (used by tests to inject a FakeWorker).
 * Also resets the pool so subsequent dispatches build fresh slots with the new factory.
 * Not intended to be called mid-flight in production — pending tasks will not settle.
 */
export function setWorkerFactory(factory) {
	_factory = factory;
	_resetWorkerPool();
}

/**
 * Terminate all worker slots and clear pending state. Test-only / startup-only:
 * callers awaiting in-flight tasks will not be settled.
 */
export function _resetWorkerPool() {
	if (_slots) {
		for (const s of _slots) s.worker?.terminate?.();
	}
	_slots = null;
	_generation++;
	_pending.clear();
	_unavailable = null;
}

/** Why workers are unavailable (null while the pool is usable). Test/diagnostic seam. */
export function _workersUnavailableReason() {
	return _unavailable;
}

export function _poolState() {
	if (!_slots) return { slots: [] };
	return { slots: _slots.map((s) => ({ inflight: s.inflight })) };
}

/** Build the slots. Returns false (pool unavailable) if a worker cannot be constructed. */
function ensurePool() {
	if (_slots) return true;
	if (_unavailable) return false;
	const size = defaultPoolSize();
	const make = _factory ?? defaultFactory;
	const slots = [];
	const generation = _generation;
	const attach = (slot) => {
		// A worker is "proven" once it has sent any message (the real worker posts
		// { ready: true } as soon as its script has loaded). An error from an
		// unproven worker means the script never ran, so respawning cannot help.
		const worker = slot.worker;
		let proven = false;
		const isStale = () => generation !== _generation || slot.worker !== worker;
		const handleMessage = (e) => {
			proven = true;
			const { id, ok, result, error } = e.data ?? {};
			const entry = _pending.get(id);
			if (!entry) return;
			_pending.delete(id);
			slot.inflight = Math.max(0, slot.inflight - 1);
			if (ok) entry.resolve(restoreFromTransferable(result));
			else entry.reject(new Error(error ?? 'Worker error'));
		};
		const handleError = (err) => {
			if (isStale()) return;
			if (!proven) {
				markUnavailable(`worker failed to start${err?.message ? `: ${err.message}` : ''}`);
				return;
			}
			// Fail only entries that were dispatched to THIS slot.
			for (const [id, entry] of _pending) {
				if (entry.slotIdx !== slot.idx) continue;
				_pending.delete(id);
				entry.reject(new Error(err?.message ?? 'Worker failed'));
			}
			slot.inflight = 0;
			// Respawn into the same slot.
			try {
				slot.worker = make();
			} catch (e) {
				markUnavailable(`worker could not be created: ${e?.message ?? e}`);
				return;
			}
			attach(slot);
		};
		worker.onmessage = handleMessage;
		worker.onerror = handleError;
	};
	try {
		for (let idx = 0; idx < size; idx++) {
			const slot = { idx, worker: make(), inflight: 0 };
			attach(slot);
			slots.push(slot);
		}
	} catch (e) {
		for (const s of slots) s.worker?.terminate?.();
		markUnavailable(`worker could not be created: ${e?.message ?? e}`);
		return false;
	}
	_slots = slots;
	return true;
}

function leastBusyIdx() {
	let bestIdx = 0;
	let bestN = Infinity;
	for (let i = 0; i < _slots.length; i++) {
		if (_slots[i].inflight < bestN) {
			bestN = _slots[i].inflight;
			bestIdx = i;
		}
	}
	return bestIdx;
}

function runSync(name, args) {
	const fn = getComputeTask(name); // throws if unknown
	return fn(args);
}

/**
 * Dispatch a registered compute task to the worker pool. Falls back to
 * synchronous execution on the main thread when the worker errors, when
 * postMessage throws, or when the task is not registered on the worker side.
 *
 * @param {string} name - name of a registered compute task
 * @param {object} args - plain-data payload for the task
 * @returns {Promise<any>} task result (Float64Arrays restored to number[])
 */
export function runComputeTask(name, args) {
	const pooled = ensurePool();
	return new Promise((resolve, reject) => {
		const fallback = (reason) => {
			if (reason) warnFallback(name, reason);
			try {
				resolve(runSync(name, args));
			} catch (e) {
				reject(e);
			}
		};
		// Fast-fail unknown task names: avoid dispatching to a worker that will
		// reply with an error (or, in the test factory, never reply at all).
		// The sync fallback throws "not found" so the promise rejects symmetrically.
		if (!listComputeTasks().includes(name)) {
			fallback(null);
			return;
		}
		if (!pooled) {
			// markUnavailable already warned once; stay quiet per task.
			fallback(null);
			return;
		}
		const idx = leastBusyIdx();
		const slot = _slots[idx];
		const id = _nextId++;
		// `entry.reject` runs sync fallback (not a true reject): a worker-reported
		// error or a slot crash both retry on the main thread, where a genuinely
		// bad input will throw again and the catch rejects with the main-thread error.
		// If the pool turned out to be unusable, markUnavailable already warned.
		_pending.set(id, {
			slotIdx: idx,
			resolve,
			reject: (err) => fallback(_unavailable ? null : `worker error: ${err?.message ?? err}`)
		});
		slot.inflight++;
		try {
			const transfers = [];
			const payload = prepareTransferable(args, transfers);
			slot.worker.postMessage({ id, name, payload }, transfers);
		} catch (postErr) {
			_pending.delete(id);
			slot.inflight = Math.max(0, slot.inflight - 1);
			fallback(`postMessage failed: ${postErr?.message ?? postErr}`);
		}
	});
}
