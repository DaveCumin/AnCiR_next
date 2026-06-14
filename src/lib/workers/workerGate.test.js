// @ts-nocheck
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { shouldUseWorkers, _setGateOverride } from './workerGate.js';

describe('workerGate', () => {
	// happy-dom does not define Worker; provide a stub so the auto-mode
	// branch can evaluate the size heuristic.
	const _hadWorker = typeof globalThis.Worker !== 'undefined';
	beforeAll(() => {
		if (!_hadWorker) globalThis.Worker = class {};
	});
	afterAll(() => {
		if (!_hadWorker) delete globalThis.Worker;
	});


	it('returns true when override forces on', () => {
		_setGateOverride('on');
		expect(shouldUseWorkers({ inputLen: 1000 })).toBe(true);
	});

	it('returns false when override forces off', () => {
		_setGateOverride('off');
		expect(shouldUseWorkers({ inputLen: 1_000_000 })).toBe(false);
	});

	it('auto mode: returns false for trivially small inputs', () => {
		_setGateOverride(null);
		expect(shouldUseWorkers({ inputLen: 50 })).toBe(false);
	});

	it('auto mode: returns true for non-trivial inputs', () => {
		_setGateOverride(null);
		expect(shouldUseWorkers({ inputLen: 5_000 })).toBe(true);
	});
});
