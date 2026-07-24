import { describe, it, expect } from 'vitest';
import { createLazyPointerCapture } from './lazyPointerCapture.js';

/** Minimal stand-in for the canvas root; records capture calls. */
function fakeElement() {
	return {
		captured: [],
		released: [],
		setPointerCapture(id) {
			this.captured.push(id);
		},
		releasePointerCapture(id) {
			this.released.push(id);
		}
	};
}

const evt = (id, x, y) => ({ pointerId: id, clientX: x, clientY: y });

describe('createLazyPointerCapture', () => {
	it('does not capture on arm alone — a tap must leave click semantics intact', () => {
		const el = fakeElement();
		const cap = createLazyPointerCapture(() => el);
		cap.arm(evt(1, 100, 100));
		expect(el.captured).toEqual([]);
		expect(cap.isHolding).toBe(false);
	});

	it('does not capture when the pointer stays within the slop', () => {
		const el = fakeElement();
		const cap = createLazyPointerCapture(() => el);
		cap.arm(evt(1, 100, 100));
		expect(cap.maybeTake(evt(1, 102, 102))).toBe(false);
		expect(el.captured).toEqual([]);
	});

	it('captures once the pointer moves past the slop', () => {
		const el = fakeElement();
		const cap = createLazyPointerCapture(() => el);
		cap.arm(evt(1, 100, 100));
		expect(cap.maybeTake(evt(1, 110, 100))).toBe(true);
		expect(el.captured).toEqual([1]);
		expect(cap.isHolding).toBe(true);
	});

	it('captures at most once per gesture', () => {
		const el = fakeElement();
		const cap = createLazyPointerCapture(() => el);
		cap.arm(evt(1, 100, 100));
		cap.maybeTake(evt(1, 110, 100));
		cap.maybeTake(evt(1, 130, 100));
		expect(el.captured).toEqual([1]);
	});

	it('ignores moves from a different pointer than the armed one', () => {
		const el = fakeElement();
		const cap = createLazyPointerCapture(() => el);
		cap.arm(evt(1, 100, 100));
		expect(cap.maybeTake(evt(2, 400, 400))).toBe(false);
		expect(el.captured).toEqual([]);
	});

	it('releases a held capture and disarms', () => {
		const el = fakeElement();
		const cap = createLazyPointerCapture(() => el);
		cap.arm(evt(1, 100, 100));
		cap.maybeTake(evt(1, 110, 100));
		cap.release();
		expect(el.released).toEqual([1]);
		expect(cap.isHolding).toBe(false);
		expect(cap.pendingId).toBe(null);
	});

	it('release after a tap is a no-op on the element', () => {
		const el = fakeElement();
		const cap = createLazyPointerCapture(() => el);
		cap.arm(evt(1, 100, 100));
		cap.release();
		expect(el.released).toEqual([]);
	});

	it('degrades gracefully when setPointerCapture throws', () => {
		const el = {
			setPointerCapture() {
				throw new Error('pointer gone');
			}
		};
		const cap = createLazyPointerCapture(() => el);
		cap.arm(evt(1, 100, 100));
		expect(cap.maybeTake(evt(1, 200, 100))).toBe(false);
		expect(cap.isHolding).toBe(false);
		expect(() => cap.release()).not.toThrow();
	});

	it('tolerates a missing element', () => {
		const cap = createLazyPointerCapture(() => null);
		cap.arm(evt(1, 100, 100));
		expect(() => cap.maybeTake(evt(1, 200, 100))).not.toThrow();
		expect(() => cap.release()).not.toThrow();
	});

	it('honours a custom slop', () => {
		const el = fakeElement();
		const cap = createLazyPointerCapture(() => el, 20);
		cap.arm(evt(1, 100, 100));
		expect(cap.maybeTake(evt(1, 115, 100))).toBe(false);
		expect(cap.maybeTake(evt(1, 125, 100))).toBe(true);
	});
});
