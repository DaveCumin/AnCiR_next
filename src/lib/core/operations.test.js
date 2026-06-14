// src/lib/core/operations.test.js
// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { addOpListener, withSuppressedListeners } from './operations.js';

describe('applyOp listener plumbing', () => {
    it('addOpListener returns an unsubscribe function', () => {
        const seen = [];
        const off = addOpListener((f, r) => seen.push({ f, r }));
        expect(typeof off).toBe('function');
        off();
    });

    it('withSuppressedListeners runs the callback', () => {
        let ran = false;
        withSuppressedListeners(() => {
            ran = true;
        });
        expect(ran).toBe(true);
    });
});
