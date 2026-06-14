// @ts-nocheck
// src/lib/workers/workerPool.js
// Worker pool with least-busy dispatch and synchronous fallback on worker errors.

import { getComputeTask, listComputeTasks } from './computeTasks.js';
import { prepareTransferable, restoreFromTransferable } from './workerTransfer.js';

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

function defaultFactory() {
	return new Worker(new URL('./compute.worker.js', import.meta.url), { type: 'module' });
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
	_pending.clear();
}

export function _poolState() {
	if (!_slots) return { slots: [] };
	return { slots: _slots.map((s) => ({ inflight: s.inflight })) };
}

function ensurePool() {
	if (_slots) return;
	const size = defaultPoolSize();
	const make = _factory ?? defaultFactory;
	_slots = Array.from({ length: size }, (_, idx) => {
		const worker = make();
		const slot = { idx, worker, inflight: 0 };
		const handleMessage = (e) => {
			const { id, ok, result, error } = e.data ?? {};
			const entry = _pending.get(id);
			if (!entry) return;
			_pending.delete(id);
			slot.inflight = Math.max(0, slot.inflight - 1);
			if (ok) entry.resolve(restoreFromTransferable(result));
			else entry.reject(new Error(error ?? 'Worker error'));
		};
		const handleError = (err) => {
			// Fail only entries that were dispatched to THIS slot.
			for (const [id, entry] of _pending) {
				if (entry.slotIdx !== idx) continue;
				_pending.delete(id);
				entry.reject(new Error(err?.message ?? 'Worker failed'));
			}
			slot.inflight = 0;
			// Respawn into the same slot.
			slot.worker = make();
			slot.worker.onmessage = handleMessage;
			slot.worker.onerror = handleError;
		};
		worker.onmessage = handleMessage;
		worker.onerror = handleError;
		return slot;
	});
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
	ensurePool();
	return new Promise((resolve, reject) => {
		// Fast-fail unknown task names: avoid dispatching to a worker that will
		// reply with an error (or, in the test factory, never reply at all).
		// The sync fallback throws "not found" so the promise rejects symmetrically.
		if (!listComputeTasks().includes(name)) {
			try {
				resolve(runSync(name, args));
			} catch (e) {
				reject(e);
			}
			return;
		}
		const idx = leastBusyIdx();
		const slot = _slots[idx];
		const id = _nextId++;
		// `entry.reject` runs sync fallback (not a true reject): a worker-reported
		// error or a slot crash both retry on the main thread, where a genuinely
		// bad input will throw again and the catch rejects with the main-thread error.
		_pending.set(id, {
			slotIdx: idx,
			resolve,
			reject: () => {
				try {
					resolve(runSync(name, args));
				} catch (e) {
					reject(e);
				}
			}
		});
		slot.inflight++;
		try {
			const transfers = [];
			const payload = prepareTransferable(args, transfers);
			slot.worker.postMessage({ id, name, payload }, transfers);
		} catch (postErr) {
			_pending.delete(id);
			slot.inflight = Math.max(0, slot.inflight - 1);
			try {
				resolve(runSync(name, args));
			} catch (e) {
				reject(e);
			}
		}
	});
}
