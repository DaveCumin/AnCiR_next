// @ts-nocheck
// src/lib/workers/workerPool.fallback.test.js
//
// When workers cannot run (the script fails to load, or the constructor throws),
// the pool must say so once on the console, stop spawning workers, and still
// compute every task on the main thread. This is the failure that went unnoticed
// when the single-file build resolved the worker URL against index.html.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	runComputeTask,
	setWorkerFactory,
	_resetWorkerPool,
	_poolState,
	_workersUnavailableReason
} from './workerPool.js';
import { registerComputeTask, _resetComputeTasks } from './computeTasks.js';

let warn;
beforeEach(() => {
	_resetWorkerPool();
	_resetComputeTasks();
	registerComputeTask('double', ({ x }) => ({ y: x.map((v) => v * 2) }));
	warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	warn.mockRestore();
	_resetWorkerPool();
});

/** A worker whose script never loads: it errors without ever posting a message. */
function makeNeverLoads(counter) {
	return class NeverLoads {
		constructor() {
			counter.created++;
			this.onmessage = null;
			this.onerror = null;
			// Like a 404'd worker script: a bare error event, no message.
			setTimeout(() => this.onerror?.({ type: 'error' }), 0);
		}
		postMessage() {}
		terminate() {
			counter.terminated++;
		}
	};
}

describe('workers that fail to start', () => {
	it('computes on the main thread, warns once and never respawns', async () => {
		const counter = { created: 0, terminated: 0 };
		const NeverLoads = makeNeverLoads(counter);
		setWorkerFactory(() => new NeverLoads());

		const results = await Promise.all([
			runComputeTask('double', { x: [1, 2] }),
			runComputeTask('double', { x: [3] })
		]);
		expect(results.map((r) => r.y)).toEqual([[2, 4], [6]]);
		const poolSize = counter.created;
		expect(poolSize).toBeGreaterThan(0);

		// Later tasks go straight to the main thread: no new workers, no new warnings.
		const later = await runComputeTask('double', { x: [5] });
		expect(later.y).toEqual([10]);
		expect(counter.created).toBe(poolSize);
		expect(counter.terminated).toBe(poolSize);
		expect(_poolState().slots).toEqual([]);

		expect(_workersUnavailableReason()).toMatch(/failed to start/);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toMatch(/Web Workers are unavailable.*main thread/);
	});

	it('handles a Worker constructor that throws (e.g. blocked by policy)', async () => {
		setWorkerFactory(() => {
			throw new Error('SecurityError: blocked');
		});
		const out = await runComputeTask('double', { x: [4] });
		expect(out.y).toEqual([8]);
		expect(_workersUnavailableReason()).toMatch(/could not be created: SecurityError/);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('a genuine compute error still rejects after the fallback', async () => {
		_resetComputeTasks();
		registerComputeTask('boom', () => {
			throw new Error('bad input');
		});
		const NeverLoads = makeNeverLoads({ created: 0, terminated: 0 });
		setWorkerFactory(() => new NeverLoads());
		await expect(runComputeTask('boom', {})).rejects.toThrow(/bad input/);
	});
});

describe('per-task fallback warnings', () => {
	it('warns when a started worker reports an error and the task reruns on the main thread', async () => {
		class ErrReply {
			constructor() {
				setTimeout(() => this.onmessage?.({ data: { ready: true } }), 0);
			}
			postMessage(req) {
				setTimeout(() => this.onmessage?.({ data: { id: req.id, ok: false, error: 'oom' } }), 0);
			}
			terminate() {}
		}
		setWorkerFactory(() => new ErrReply());
		const out = await runComputeTask('double', { x: [1] });
		expect(out.y).toEqual([2]);
		expect(_workersUnavailableReason()).toBeNull();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toMatch(
			/"double" is running on the main thread \(worker error: oom\)/
		);
	});

	it('warns when postMessage throws', async () => {
		class ThrowOnPost {
			postMessage() {
				throw new Error('DataCloneError');
			}
			terminate() {}
		}
		setWorkerFactory(() => new ThrowOnPost());
		const out = await runComputeTask('double', { x: [1] });
		expect(out.y).toEqual([2]);
		expect(warn.mock.calls[0][0]).toMatch(/postMessage failed: DataCloneError/);
	});

	it('stays quiet when the worker succeeds', async () => {
		class Echo {
			postMessage(req) {
				setTimeout(
					() =>
						this.onmessage?.({
							data: { id: req.id, ok: true, result: { y: req.payload.x.map((v) => v * 2) } }
						}),
					0
				);
			}
			terminate() {}
		}
		setWorkerFactory(() => new Echo());
		await runComputeTask('double', { x: [1] });
		expect(warn).not.toHaveBeenCalled();
	});
});
