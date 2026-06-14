// @ts-nocheck
import { describe, it, expect, beforeEach } from 'vitest';
import { runComputeTask, setWorkerFactory, _resetWorkerPool, _poolState } from './workerPool.js';
import {
	registerComputeTask,
	_resetComputeTasks
} from './computeTasks.js';

class FakeWorker {
	constructor() {
		this.onmessage = null;
		this.onerror = null;
	}
	postMessage(req) {
		// Resolve next tick with id echoed
		setTimeout(() => {
			this.onmessage?.({ data: { id: req.id, ok: true, result: { y: req.payload.x.map((v) => v * 2) } } });
		}, 0);
	}
	terminate() {}
}

beforeEach(() => {
	_resetWorkerPool();
	_resetComputeTasks();
	registerComputeTask('double', ({ x }) => ({ y: x.map((v) => v * 2) }));
	setWorkerFactory(() => new FakeWorker());
});

describe('workerPool', () => {
	it('returns the worker result for a registered task', async () => {
		const out = await runComputeTask('double', { x: [1, 2, 3] });
		expect(out.y).toEqual([2, 4, 6]);
	});

	it('falls back to sync compute when worker errors', async () => {
		class ErrWorker {
			postMessage(req) {
				setTimeout(() => this.onerror?.({ message: 'boom' }), 0);
			}
			terminate() {}
		}
		setWorkerFactory(() => new ErrWorker());
		const out = await runComputeTask('double', { x: [1, 2, 3] });
		expect(out.y).toEqual([2, 4, 6]);
	});

	it('routes parallel tasks across multiple slots (least-busy)', async () => {
		const promises = [
			runComputeTask('double', { x: [1] }),
			runComputeTask('double', { x: [2] }),
			runComputeTask('double', { x: [3] })
		];
		const results = await Promise.all(promises);
		expect(results.map((r) => r.y[0])).toEqual([2, 4, 6]);
		const state = _poolState();
		expect(state.slots.length).toBeGreaterThan(0);
	});

	it('rejects with sync fallback when task is unknown to registry (sync path also throws)', async () => {
		await expect(runComputeTask('unknown', {})).rejects.toThrow(/not found/);
	});
});
