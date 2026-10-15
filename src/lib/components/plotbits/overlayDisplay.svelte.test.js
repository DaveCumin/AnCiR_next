// @ts-nocheck
/**
 * Display-side reads of an overlay host (overlays plan 2026-10-15, step 2): the clip-id
 * prefix that makes every overlay clip path unique in a document, the "outside the visible
 * range" note a block shows when a host's range is fixed (decision Q7), and the "Legend is
 * off" note for a labelled overlay on a plot whose legend is hidden.
 */
import { describe, it, expect } from 'vitest';
import { scaleLinear } from 'd3-scale';
import { OverlayClass } from './Overlay.svelte';
import {
	overlayClipPrefix,
	overlayRangeNote,
	overlayLegendNote,
	overlayXNote
} from './overlayDisplay.js';

const CAPS = { line: ['vertical', 'horizontal'], band: ['vertical'], legend: true, xTime: false };

/** A plain host: x 1..30, y 0..10, an optional legend and range hint. */
function host({ id = 7, legend = { show: true }, hint = null, caps = CAPS, xIsTime = false } = {}) {
	return {
		constructor: { overlayCapabilities: caps },
		parentBox: id == null ? undefined : { id },
		overlays: [],
		legend,
		overlayXScale: scaleLinear().domain([1, 30]).range([0, 290]),
		overlayYScale: scaleLinear().domain([0, 10]).range([100, 0]),
		overlayContext: () => ({ xDomainMin: 1, xDomainMax: 30, xAnchorMin: 1, xIsTime }),
		...(hint ? { overlayRangeHint: hint } : {})
	};
}

function line(h, form, at) {
	const o = new OverlayClass(h, { kind: 'line', form });
	o.setTyped('at', at);
	return o;
}

describe('overlayClipPrefix', () => {
	it('names the plot and the overlay, so two plots of the same size never share an id', () => {
		const a = host({ id: 7 });
		const b = host({ id: 8 });
		const oa = line(a, 'vertical', [24]);
		const ob = line(b, 'vertical', [24]);
		expect(overlayClipPrefix(a, oa)).toBe(`p7-ov${oa.id}-`);
		expect(overlayClipPrefix(b, ob)).toBe(`p8-ov${ob.id}-`);
		expect(overlayClipPrefix(a, oa)).not.toBe(overlayClipPrefix(b, ob));
	});

	it("a facet panel's string id is made safe for url(#...): only letters, digits, _ and -", () => {
		const h = host({ id: '12:y112#0' });
		const o = line(h, 'vertical', [3]);
		expect(overlayClipPrefix(h, o)).toBe(`p12_y112_0-ov${o.id}-`);
	});

	it('a host with no wrapper still gets a per-overlay prefix', () => {
		const h = host({ id: null });
		const o = line(h, 'vertical', [3]);
		expect(overlayClipPrefix(h, o)).toBe(`ov${o.id}-`);
	});
});

describe('overlayRangeNote', () => {
	it('is silent while the overlay sits inside the visible range', () => {
		const h = host();
		expect(overlayRangeNote(h, line(h, 'vertical', [24]))).toBeNull();
		expect(overlayRangeNote(h, line(h, 'horizontal', [5]))).toBeNull();
		// Exactly on the edge is inside.
		expect(overlayRangeNote(h, line(h, 'vertical', [1, 30]))).toBeNull();
	});

	it('says when a line is entirely outside the x range, with the range', () => {
		const h = host();
		expect(overlayRangeNote(h, line(h, 'vertical', [40]))).toBe(
			'Outside the visible x range (1 to 30), so it is not drawn.'
		);
	});

	it('says when a mark is only partly outside, and on which axis', () => {
		const h = host();
		expect(overlayRangeNote(h, line(h, 'vertical', [24, 40]))).toBe(
			'Partly outside the visible x range (1 to 30).'
		);
		expect(overlayRangeNote(h, line(h, 'horizontal', [-2]))).toBe(
			'Outside the visible y range (0 to 10), so it is not drawn.'
		);
		const band = new OverlayClass(h, { kind: 'band', form: 'vertical' });
		band.setTyped('start', [20]);
		band.setTyped('end', [36]);
		expect(overlayRangeNote(h, band)).toBe('Partly outside the visible x range (1 to 30).');
	});

	it("appends the host's hint for that axis", () => {
		const h = host({
			hint: (axis) => (axis === 'x' ? 'Change the period range in Properties.' : null)
		});
		expect(overlayRangeNote(h, line(h, 'vertical', [40]))).toBe(
			'Outside the visible x range (1 to 30), so it is not drawn. Change the period range in Properties.'
		);
		expect(overlayRangeNote(h, line(h, 'horizontal', [20]))).toBe(
			'Outside the visible y range (0 to 10), so it is not drawn.'
		);
	});

	it('is silent for a hidden overlay and for one with nothing to draw', () => {
		const h = host();
		const hidden = line(h, 'vertical', [40]);
		hidden.enabled = false;
		expect(overlayRangeNote(h, hidden)).toBeNull();
		expect(overlayRangeNote(h, new OverlayClass(h, { kind: 'line', form: 'vertical' }))).toBeNull();
	});

	it('formats a time x range as dates', () => {
		const t0 = Date.UTC(2026, 0, 1);
		const h = host({ xIsTime: true });
		h.overlayXScale = scaleLinear()
			.domain([t0, t0 + 86400000])
			.range([0, 100]);
		expect(overlayRangeNote(h, line(h, 'vertical', [t0 + 2 * 86400000]))).toBe(
			'Outside the visible x range (2026-01-01 00:00 to 2026-01-02 00:00), so it is not drawn.'
		);
	});
});

describe('overlayLegendNote', () => {
	it('points at Properties when a labelled overlay sits on a plot whose legend is off', () => {
		const h = host({ legend: { show: false } });
		const o = line(h, 'vertical', [24]);
		expect(overlayLegendNote(h, o)).toBeNull(); // no label, nothing to show
		o.label = '  ';
		expect(overlayLegendNote(h, o)).toBeNull();
		o.label = 'tau';
		expect(overlayLegendNote(h, o)).toBe('Legend is off (Properties)');
	});

	it('is silent while the legend is on, and on a host without a legend', () => {
		const on = host({ legend: { show: true } });
		const o = line(on, 'vertical', [24]);
		o.label = 'tau';
		expect(overlayLegendNote(on, o)).toBeNull();
		const none = host({ caps: { ...CAPS, legend: false }, legend: { show: false } });
		const o2 = line(none, 'vertical', [24]);
		o2.label = 'tau';
		expect(overlayLegendNote(none, o2)).toBeNull();
	});
});

describe('overlayXNote', () => {
	const NOTE = 'Vertical positions are periods in hours.';
	it("shows the host's x note on an overlay that reads x, and nowhere else", () => {
		const h = host({ caps: { ...CAPS, xNote: NOTE } });
		expect(overlayXNote(h, line(h, 'vertical', [24]))).toBe(NOTE);
		const band = new OverlayClass(h, { kind: 'band', form: 'vertical' });
		expect(overlayXNote(h, band)).toBe(NOTE);
		expect(overlayXNote(h, line(h, 'horizontal', [2]))).toBeNull();
	});

	it('is silent on a host without one', () => {
		const h = host();
		expect(overlayXNote(h, line(h, 'vertical', [24]))).toBeNull();
	});
});
