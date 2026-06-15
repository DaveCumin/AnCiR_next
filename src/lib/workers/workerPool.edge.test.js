// src/lib/workers/workerPool.edge.test.js
// @ts-nocheck
//
// Edge cases for the worker pool: postMessage-throw fallback, per-slot error
// isolation + respawn, least-busy routing, and id non-reuse across resets.
import { describe, it, expect, beforeEach } from 'vitest';
import {
    runComputeTask,
    setWorkerFactory,
    _resetWorkerPool,
    _poolState
} from './workerPool.js';
import { registerComputeTask, _resetComputeTasks } from './computeTasks.js';

class EchoWorker {
    constructor() {
        this.onmessage = null;
        this.onerror = null;
    }
    postMessage(req) {
        setTimeout(() => {
            this.onmessage?.({
                data: { id: req.id, ok: true, result: { y: req.payload.x.map((v) => v * 2) } }
            });
        }, 0);
    }
    terminate() {}
}

beforeEach(() => {
    _resetWorkerPool();
    _resetComputeTasks();
    registerComputeTask('double', ({ x }) => ({ y: x.map((v) => v * 2) }));
    setWorkerFactory(() => new EchoWorker());
});

describe('worker postMessage throw → sync fallback', () => {
    it('falls back to sync compute when postMessage throws synchronously', async () => {
        class ThrowOnPost {
            postMessage() {
                throw new Error('cannot post');
            }
            terminate() {}
        }
        setWorkerFactory(() => new ThrowOnPost());
        const out = await runComputeTask('double', { x: [1, 2, 3] });
        expect(out.y).toEqual([2, 4, 6]);
    });

    it('a postMessage throw decrements inflight back to zero (no leaked slot pressure)', async () => {
        class ThrowOnPost {
            postMessage() {
                throw new Error('nope');
            }
            terminate() {}
        }
        setWorkerFactory(() => new ThrowOnPost());
        await runComputeTask('double', { x: [1] });
        const state = _poolState();
        expect(state.slots.every((s) => s.inflight === 0)).toBe(true);
    });
});

describe('worker error reporting (ok:false)', () => {
    it('a worker reply with ok:false retries on the main thread (sync fallback)', async () => {
        class ErrReplyWorker {
            postMessage(req) {
                setTimeout(() => {
                    this.onmessage?.({ data: { id: req.id, ok: false, error: 'worker boom' } });
                }, 0);
            }
            terminate() {}
        }
        setWorkerFactory(() => new ErrReplyWorker());
        // sync fallback recomputes successfully
        const out = await runComputeTask('double', { x: [2, 3] });
        expect(out.y).toEqual([4, 6]);
    });

    it('sync fallback surfaces a genuine compute error as a rejection', async () => {
        _resetComputeTasks();
        registerComputeTask('boom', () => {
            throw new Error('bad input');
        });
        class ErrReplyWorker {
            postMessage(req) {
                setTimeout(() => this.onmessage?.({ data: { id: req.id, ok: false, error: 'x' } }), 0);
            }
            terminate() {}
        }
        setWorkerFactory(() => new ErrReplyWorker());
        await expect(runComputeTask('boom', {})).rejects.toThrow(/bad input/);
    });
});

describe('per-slot error isolation', () => {
    it('an onerror only fails entries dispatched to that slot, then the slot respawns', async () => {
        // First worker created will throw via onerror on its first postMessage;
        // the respawned worker is a healthy EchoWorker.
        let created = 0;
        class FlakyThenHealthy {
            constructor() {
                this.mine = created++;
                this.onmessage = null;
                this.onerror = null;
            }
            postMessage(req) {
                if (this.mine === 0) {
                    setTimeout(() => this.onerror?.({ message: 'slot died' }), 0);
                } else {
                    setTimeout(
                        () => this.onmessage?.({ data: { id: req.id, ok: true, result: { y: req.payload.x.map((v) => v * 2) } } }),
                        0
                    );
                }
            }
            terminate() {}
        }
        setWorkerFactory(() => new FlakyThenHealthy());
        // first call hits slot 0 → onerror → sync fallback
        const out1 = await runComputeTask('double', { x: [1] });
        expect(out1.y).toEqual([2]);
        // subsequent call should succeed (slot respawned with a healthy worker
        // or routed to a different slot)
        const out2 = await runComputeTask('double', { x: [5] });
        expect(out2.y).toEqual([10]);
    });
});

describe('least-busy routing and id management', () => {
    it('distributes a burst of tasks and all resolve correctly', async () => {
        const inputs = Array.from({ length: 12 }, (_, i) => [i]);
        const results = await Promise.all(inputs.map((x) => runComputeTask('double', { x })));
        expect(results.map((r) => r.y[0])).toEqual(inputs.map((x) => x[0] * 2));
        // all inflight counters settle back to 0
        const state = _poolState();
        expect(state.slots.every((s) => s.inflight === 0)).toBe(true);
    });

    it('_poolState reports no slots before the first dispatch', () => {
        _resetWorkerPool();
        setWorkerFactory(() => new EchoWorker()); // setWorkerFactory resets; pool is lazy
        // ensurePool is only called on dispatch
        expect(_poolState().slots).toHaveLength(0);
    });

    it('unknown task name short-circuits to sync and rejects symmetrically', async () => {
        await expect(runComputeTask('does-not-exist', {})).rejects.toThrow(/not found/);
    });
});
