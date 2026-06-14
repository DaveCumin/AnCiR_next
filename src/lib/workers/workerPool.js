// @ts-nocheck
// src/lib/workers/workerPool.js
// Worker pool with least-busy dispatch and synchronous fallback on worker errors.

import { getComputeTask, listComputeTasks } from './computeTasks.js';
import { prepareTransferable, restoreFromTransferable } from './workerTransfer.js';

const POOL_SIZE_FALLBACK = 3;
function defaultPoolSize() {
	const n =
		typeof navigator !== 'undefined' && Number(navigator.hardwareConcurrency)
			? Number(navigator.hardwareConcurrency) - 1
			: POOL_SIZE_FALLBACK;
	return Math.min(Math.max(n, 1), 8);
}

let _factory = null;
let _slots = null;
let _nextId = 1;
const _pending = new Map(); // id -> { slotIdx, resolve, reject }

function defaultFactory() {
	return new Worker(new URL('./compute.worker.js', import.meta.url), { type: 'module' });
}

export function setWorkerFactory(factory) {
	_factory = factory;
	_resetWorkerPool();
}

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
		const transfers = [];
		const payload = prepareTransferable(args, transfers);
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
