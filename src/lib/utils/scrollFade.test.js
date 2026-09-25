// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { scrollEdges, scrollFade } from './scrollFade.js';

/** A stand-in scroll box with the given geometry. */
function box({ sh = 100, ch = 100, st = 0, sw = 100, cw = 100, sl = 0 } = {}) {
	const el = document.createElement('div');
	Object.defineProperty(el, 'scrollHeight', { value: sh, configurable: true });
	Object.defineProperty(el, 'clientHeight', { value: ch, configurable: true });
	Object.defineProperty(el, 'scrollWidth', { value: sw, configurable: true });
	Object.defineProperty(el, 'clientWidth', { value: cw, configurable: true });
	el.scrollTop = st;
	el.scrollLeft = sl;
	return el;
}

describe('scrollEdges', () => {
	it('reports nothing hidden when the content fits', () => {
		expect(scrollEdges(box())).toEqual({ above: false, below: false, left: false, right: false });
	});

	it('reports content below at the top of a tall box', () => {
		expect(scrollEdges(box({ sh: 700, ch: 320 }))).toMatchObject({ above: false, below: true });
	});

	it('reports both edges part-way down', () => {
		expect(scrollEdges(box({ sh: 700, ch: 320, st: 200 }))).toMatchObject({
			above: true,
			below: true
		});
	});

	// Fractional layouts can leave scrollTop a hair short of the maximum.
	it('treats the bottom within 1px as the end', () => {
		expect(scrollEdges(box({ sh: 700, ch: 320, st: 379.5 }))).toMatchObject({ below: false });
	});

	it('reports content to the right of a wide table', () => {
		expect(scrollEdges(box({ sw: 400, cw: 200 }))).toMatchObject({ left: false, right: true });
	});
});

describe('scrollFade attachment', () => {
	it('flags the edges on attach, updates on scroll, and cleans up', () => {
		const el = box({ sh: 700, ch: 320 });
		const cleanup = scrollFade()(el);
		expect(el.hasAttribute('data-more-below')).toBe(true);
		expect(el.hasAttribute('data-more-above')).toBe(false);

		el.scrollTop = 380;
		el.dispatchEvent(new Event('scroll'));
		expect(el.hasAttribute('data-more-below')).toBe(false);
		expect(el.hasAttribute('data-more-above')).toBe(true);

		cleanup();
		el.scrollTop = 0;
		el.dispatchEvent(new Event('scroll'));
		// No longer listening: the flags stay as they were.
		expect(el.hasAttribute('data-more-above')).toBe(true);
	});
});
