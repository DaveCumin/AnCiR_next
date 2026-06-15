// src/lib/workers/workerTransfer.edge.test.js
// @ts-nocheck
//
// Edge cases for the transferable encoder/decoder: nested arrays, Float64Array
// passthrough, boolean-first arrays, primitives, round-trip fidelity, and the
// guarantee that the input payload is not mutated.
import { describe, it, expect } from 'vitest';
import { prepareTransferable, restoreFromTransferable } from './workerTransfer.js';

describe('prepareTransferable edge cases', () => {
    it('does not mutate the input payload object', () => {
        const input = { x: [1, 2, 3] };
        const ref = input.x;
        prepareTransferable(input, []);
        expect(input.x).toBe(ref);
        expect(Array.isArray(input.x)).toBe(true);
    });

    it('an existing Float64Array passes through unchanged (not double-wrapped)', () => {
        const f = new Float64Array([1, 2, 3]);
        const transfers = [];
        const out = prepareTransferable({ x: f }, transfers);
        expect(out.x).toBe(f);
        // not added to transfers (only freshly-built Float64Arrays are)
        expect(transfers).toHaveLength(0);
    });

    it('boolean-first array: typeof is not string → converted numerically (true→1, false→0)', () => {
        const transfers = [];
        const out = prepareTransferable({ flags: [true, false, true] }, transfers);
        expect(out.flags).toBeInstanceOf(Float64Array);
        expect(Array.from(out.flags)).toEqual([1, 0, 1]);
    });

    it('primitives pass through untouched', () => {
        const transfers = [];
        const out = prepareTransferable({ n: 5, s: 'hello', b: true, z: null }, transfers);
        expect(out).toEqual({ n: 5, s: 'hello', b: true, z: null });
        expect(transfers).toHaveLength(0);
    });

    it('an array of numeric arrays: the OUTER array is converted (first elem is an Array, not a string)', () => {
        // The encoder only special-cases string-first arrays; an array whose
        // first element is itself an array goes through the numeric branch,
        // where Number([...]) of a multi-element array yields NaN.
        const transfers = [];
        const out = prepareTransferable({ grid: [[1, 2], [3, 4]] }, transfers);
        expect(out.grid).toBeInstanceOf(Float64Array);
        expect(transfers).toHaveLength(1);
    });

    it('mixed object: converts numeric arrays, leaves string arrays + nested objects', () => {
        const transfers = [];
        const out = prepareTransferable(
            { x: [1, 2], labels: ['a', 'b'], meta: { y: [3, 4], tag: 'k' } },
            transfers
        );
        expect(out.x).toBeInstanceOf(Float64Array);
        expect(out.labels).toEqual(['a', 'b']);
        expect(out.meta.y).toBeInstanceOf(Float64Array);
        expect(out.meta.tag).toBe('k');
        expect(transfers).toHaveLength(2); // x and meta.y
    });
});

describe('restoreFromTransferable edge cases', () => {
    it('restores nested Float64Arrays inside objects and arrays', () => {
        const value = {
            a: new Float64Array([1, 2]),
            list: [new Float64Array([3]), { b: new Float64Array([4, 5]) }]
        };
        const out = restoreFromTransferable(value);
        expect(out.a).toEqual([1, 2]);
        expect(out.list[0]).toEqual([3]);
        expect(out.list[1].b).toEqual([4, 5]);
    });

    it('leaves primitives, strings and null untouched', () => {
        expect(restoreFromTransferable(5)).toBe(5);
        expect(restoreFromTransferable('s')).toBe('s');
        expect(restoreFromTransferable(null)).toBe(null);
        expect(restoreFromTransferable(true)).toBe(true);
    });
});

describe('round-trip fidelity', () => {
    it('prepare → restore returns equivalent plain data for numeric arrays', () => {
        const original = { x: [1, 2, 3], meta: { y: [4, 5] }, labels: ['p', 'q'] };
        const transfers = [];
        const prepared = prepareTransferable(original, transfers);
        const restored = restoreFromTransferable(prepared);
        expect(restored.x).toEqual([1, 2, 3]);
        expect(restored.meta.y).toEqual([4, 5]);
        expect(restored.labels).toEqual(['p', 'q']);
    });
});
