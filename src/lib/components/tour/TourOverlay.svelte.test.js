/**
 * The tour card must never end up behind an open modal <dialog>. A dialog opened with
 * showModal() lives in the top layer, so no z-index can lift the card over it: the card
 * has to be PLACED clear of it.
 *
 * Reproduced in the getting-started tour at 1024x768: step 3 places the card below the
 * import modal's short "From file" tab; clicking "Examples" grows the dialog to 75vh, and
 * step 4's card sat mostly hidden behind it. Two causes, one test each:
 *   1. a dialog that changes size fired nothing that re-placed the card;
 *   2. with a tall 36rem dialog no full-width spot is clear, and the fallback was the
 *      step's preferred side, right over the dialog.
 *
 * happy-dom has no layout, so rects are stubbed per element and ResizeObserver is a fake
 * whose callback the test fires by hand.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import TourOverlay from './TourOverlay.svelte';
import { tourState } from '$lib/core/tourRunner.svelte.js';

const VW = 1024;
const VH = 768;

/** Fake ResizeObserver: records observed elements; `fireResize(el)` runs the callback of
 * every observer that is watching `el`, as a real one would. */
const observers = new Set();
class FakeResizeObserver {
	constructor(cb) {
		this.cb = cb;
		this.targets = new Set();
		observers.add(this);
	}
	observe(el) {
		this.targets.add(el);
	}
	unobserve(el) {
		this.targets.delete(el);
	}
	disconnect() {
		this.targets.clear();
		observers.delete(this);
	}
}
const fireResize = (el) => {
	for (const o of [...observers]) if (o.targets.has(el)) o.cb([{ target: el }], o);
};

function stubRect(el, box) {
	el.getBoundingClientRect = () => ({
		...box,
		x: box.left,
		y: box.top,
		right: box.left + box.width,
		bottom: box.top + box.height
	});
}

let dialog;
let target;

beforeEach(() => {
	// The overlay also re-places the card on a rAF and on timers up to 1.5s into a step.
	// Faking them lets the test drain those first, so only a ResizeObserver callback
	// can move the card afterwards.
	vi.useFakeTimers();
	vi.stubGlobal('ResizeObserver', FakeResizeObserver);
	vi.stubGlobal('innerWidth', VW);
	vi.stubGlobal('innerHeight', VH);
	dialog = document.createElement('dialog');
	dialog.setAttribute('open', '');
	target = document.createElement('button');
	target.id = 'tour-target';
	dialog.appendChild(target);
	document.body.appendChild(dialog);
});

afterEach(() => {
	tourState.activeTour = null;
	tourState.index = -1;
	cleanup();
	dialog.remove();
	observers.clear();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

async function startStep() {
	render(TourOverlay);
	tourState.activeTour = {
		id: 't',
		name: 'Test tour',
		steps: [{ target: '#tour-target', placement: 'bottom', title: 'T', body: 'B', advance: {} }]
	};
	tourState.index = 0;
	await tick();
	vi.advanceTimersByTime(2000); // drain the step's rAF and scheduled repositions
	await tick();
}

/** The card's box as placed, read back from its inline style. */
function cardBox() {
	const card = document.querySelector('.tour-tooltip');
	const style = card.getAttribute('style');
	const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(style);
	const w = /width:\s*([\d.]+)px/.exec(style);
	const left = Number(m[1]);
	const top = Number(m[2]);
	const width = w ? Number(w[1]) : 320;
	// happy-dom reports offsetHeight 0, so the overlay assumes its 160px default.
	return { left, top, right: left + width, bottom: top + 160, width };
}

const overlaps = (a, b) =>
	a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const boxOf = (r) => ({
	left: r.left,
	top: r.top,
	right: r.left + r.width,
	bottom: r.top + r.height
});

// The import modal: 36rem (576px) wide, centred at 1024 wide.
const SHORT_DIALOG = { left: 224, top: 250, width: 576, height: 200 };
const TALL_DIALOG = { left: 224, top: 96, width: 576, height: 576 }; // 75vh of 768
const TARGET = { left: 260, top: 300, width: 500, height: 32 };

describe('TourOverlay card vs an open dialog', () => {
	it('re-places the card when an open dialog grows under it', async () => {
		stubRect(dialog, SHORT_DIALOG);
		stubRect(target, TARGET);
		await startStep();
		expect(overlaps(cardBox(), boxOf(SHORT_DIALOG))).toBe(false);

		// The Examples tab loads and the dialog grows. No scroll/resize/pointer event.
		stubRect(dialog, TALL_DIALOG);
		fireResize(dialog);
		await tick();

		expect(overlaps(cardBox(), boxOf(TALL_DIALOG))).toBe(false);
	});

	it('squeezes the card beside a dialog that leaves no full-width spot clear', async () => {
		stubRect(dialog, TALL_DIALOG);
		stubRect(target, TARGET);
		await startStep();

		const card = cardBox();
		expect(card.width).toBeGreaterThanOrEqual(200);
		expect(card.width).toBeLessThan(320);
		expect(overlaps(card, boxOf(TALL_DIALOG))).toBe(false);
		expect(card.left).toBeGreaterThanOrEqual(0);
		expect(card.right).toBeLessThanOrEqual(VW);
	});

	it('with no room even for a squeezed card, takes the spot the dialog hides least', async () => {
		// 700px wide leaves 162px strips, under the 200px minimum card width.
		const WIDE_DIALOG = { left: 162, top: 96, width: 700, height: 576 };
		stubRect(dialog, WIDE_DIALOG);
		stubRect(target, TARGET);
		await startStep();

		const card = cardBox();
		const d = boxOf(WIDE_DIALOG);
		const w = Math.min(card.right, d.right) - Math.max(card.left, d.left);
		const h = Math.min(card.bottom, d.bottom) - Math.max(card.top, d.top);
		const hidden = Math.max(0, w) * Math.max(0, h);
		// A viewport corner: about 23% of the card under the dialog. The preferred side
		// ("bottom" of the target) would put the whole card behind it.
		expect(hidden / (320 * 160)).toBeLessThan(0.25);
	});

	it('disconnects its ResizeObserver when the tour stops', async () => {
		stubRect(dialog, SHORT_DIALOG);
		stubRect(target, TARGET);
		await startStep();
		expect(observers.size).toBeGreaterThan(0);
		const watched = [...observers].flatMap((o) => [...o.targets]);
		expect(watched).toContain(dialog);
		expect(watched).toContain(target);

		tourState.activeTour = null;
		tourState.index = -1;
		await tick();
		expect(observers.size).toBe(0);
	});
});
