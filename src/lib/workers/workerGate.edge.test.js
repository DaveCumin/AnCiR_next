// src/lib/workers/workerGate.edge.test.js
// @ts-nocheck
//
// Boundary + environment branches for the worker gate: the 500-input threshold
// edge, the "no Worker constructor" auto-mode branch, and override precedence.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { shouldUseWorkers, _setGateOverride } from './workerGate.js';

beforeEach(() => _setGateOverride(null));
afterEach(() => _setGateOverride(null));

describe('workerGate input-length threshold (auto mode)', () => {
    const hadWorker = typeof globalThis.Worker !== 'undefined';
    beforeEach(() => {
        if (!hadWorker) globalThis.Worker = class {};
    });
    afterEach(() => {
        if (!hadWorker) delete globalThis.Worker;
    });

    it('returns false just below the 500 threshold (499)', () => {
        expect(shouldUseWorkers({ inputLen: 499 })).toBe(false);
    });

    it('returns true exactly at the 500 threshold (inclusive)', () => {
        expect(shouldUseWorkers({ inputLen: 500 })).toBe(true);
    });

    it('defaults inputLen to 0 when no arg is given → false', () => {
        expect(shouldUseWorkers()).toBe(false);
        expect(shouldUseWorkers({})).toBe(false);
    });
});

describe('workerGate without a Worker constructor', () => {
    let restore;
    beforeEach(() => {
        if (typeof globalThis.Worker !== 'undefined') {
            const saved = globalThis.Worker;
            delete globalThis.Worker;
            restore = () => {
                globalThis.Worker = saved;
            };
        } else {
            restore = () => {};
        }
    });
    afterEach(() => restore());

    it('auto mode returns false when Worker is undefined regardless of size', () => {
        expect(shouldUseWorkers({ inputLen: 1_000_000 })).toBe(false);
    });

    it('override "on" still forces true even without a Worker constructor', () => {
        _setGateOverride('on');
        expect(shouldUseWorkers({ inputLen: 0 })).toBe(true);
    });
});

describe('override precedence', () => {
    it('"on" beats a tiny input', () => {
        _setGateOverride('on');
        expect(shouldUseWorkers({ inputLen: 1 })).toBe(true);
    });
    it('"off" beats a huge input', () => {
        _setGateOverride('off');
        expect(shouldUseWorkers({ inputLen: 10_000_000 })).toBe(false);
    });
});
