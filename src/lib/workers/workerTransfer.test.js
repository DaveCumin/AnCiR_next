// @ts-nocheck
// src/lib/workers/workerTransfer.test.js
import { describe, it, expect } from 'vitest';
import { prepareTransferable, restoreFromTransferable } from './workerTransfer.js';

describe('workerTransfer', () => {
	it('converts a numeric array to Float64Array and lists its buffer as transferable', () => {
		const transfers = [];
		const out = prepareTransferable({ x: [1, 2, 3] }, transfers);
		expect(out.x).toBeInstanceOf(Float64Array);
		expect(Array.from(out.x)).toEqual([1, 2, 3]);
		expect(transfers).toContain(out.x.buffer);
	});

	it('leaves string arrays alone', () => {
		const transfers = [];
		const out = prepareTransferable({ labels: ['a', 'b'] }, transfers);
		expect(out.labels).toEqual(['a', 'b']);
		expect(transfers).toHaveLength(0);
	});

	it('treats null/undefined-first arrays as numeric (turn into NaN)', () => {
		const transfers = [];
		const out = prepareTransferable({ x: [null, 1, 2] }, transfers);
		expect(out.x).toBeInstanceOf(Float64Array);
		expect(Number.isNaN(out.x[0])).toBe(true);
	});

	it('restoreFromTransferable converts Float64Array back to plain number[]', () => {
		const f = new Float64Array([1, 2, 3]);
		const out = restoreFromTransferable({ x: f });
		expect(Array.isArray(out.x)).toBe(true);
		expect(out.x).toEqual([1, 2, 3]);
	});

	it('passes empty arrays through unchanged', () => {
		const transfers = [];
		const out = prepareTransferable({ x: [] }, transfers);
		expect(out.x).toEqual([]);
		expect(transfers).toHaveLength(0);
	});

	it('walks nested objects', () => {
		const transfers = [];
		const out = prepareTransferable({ payload: { x: [1, 2], labels: ['a'] } }, transfers);
		expect(out.payload.x).toBeInstanceOf(Float64Array);
		expect(out.payload.labels).toEqual(['a']);
	});
});
