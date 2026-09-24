/**
 * Mount test: overlays actually reach the scatterplot SVG. Bands sit BENEATH
 * the series and lines ABOVE them; a disabled overlay draws nothing. Pure
 * model tests cannot see any of that, so this renders the real component.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { core } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import Scatterplot, { Scatterplotclass } from './Scatterplot.svelte';
import Overlay from './Overlay.svelte';

function mkCol(values, type = 'number') {
	const c = new Column({ type, data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

/** One number series x=0..10, y=0..10 on a 400x300 figure with a known padding. */
function mkPlot() {
	const xId = mkCol([0, 2, 4, 6, 8, 10]);
	const yId = mkCol([0, 2, 4, 6, 8, 10]);
	const wrapper = { id: 1, type: 'scatterplot', name: 'p', width: 400, height: 300, plot: null };
	const s = new Scatterplotclass(wrapper, null);
	s.padding = { top: 20, right: 30, bottom: 30, left: 50 };
	s.addData({ x: { refId: xId }, y: { refId: yId } });
	wrapper.plot = s;
	return { wrapper, s };
}

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
});
afterEach(() => cleanup());

describe('Scatterplot overlay rendering', () => {
	it('a vertical line overlay with typed positions draws one clipped <line> per position at the scaled x', () => {
		const { wrapper, s } = mkPlot();
		const line = s.addOverlay('line', 'vertical');
		line.setTyped('at', [2, 5]);
		line.colour = '#C0392B';
		line.strokeWidth = 2;

		const { container } = render(Scatterplot, { props: { theData: wrapper, which: 'plot' } });
		const rules = container.querySelectorAll('line.overlay-rule');
		expect(rules).toHaveLength(2);
		// plotwidth = 400 - 50 - 30 = 320 over the domain (the data's [0, 10] plus a little
		// marker room), plus the left padding. Both endpoints span the plot height
		// (300 - 20 - 30 = 250).
		expect(Number(rules[0].getAttribute('x1'))).toBeCloseTo(50 + s.XScale(2));
		expect(Number(rules[0].getAttribute('x2'))).toBeCloseTo(50 + s.XScale(2));
		expect(Number(rules[0].getAttribute('y1'))).toBeCloseTo(20);
		expect(Number(rules[0].getAttribute('y2'))).toBeCloseTo(20 + 250);
		expect(Number(rules[1].getAttribute('x1'))).toBeCloseTo(50 + s.XScale(5));
		expect(rules[0].getAttribute('stroke')).toBe('#C0392B');
		expect(rules[0].getAttribute('stroke-width')).toBe('2');
		expect(rules[0].getAttribute('stroke-dasharray')).toBe('5, 5');
		expect(rules[0].closest('g[clip-path]')).not.toBeNull();
	});

	it('a horizontal line spans the plot width at the scaled y', () => {
		const { wrapper, s } = mkPlot();
		const line = s.addOverlay('line', 'horizontal');
		line.setTyped('at', [5]);
		const { container } = render(Scatterplot, { props: { theData: wrapper, which: 'plot' } });
		const rule = container.querySelector('line.overlay-rule');
		expect(Number(rule.getAttribute('x1'))).toBeCloseTo(50);
		expect(Number(rule.getAttribute('x2'))).toBeCloseTo(50 + 320);
		expect(Number(rule.getAttribute('y1'))).toBeCloseTo(20 + 125);
	});

	it('a ribbon band draws a <path> beneath the series, and a vertical band draws <rect>s', () => {
		const { wrapper, s } = mkPlot();
		const ribbon = s.addOverlay('band', 'ribbon');
		ribbon.setTyped('x', [0, 10]);
		ribbon.setTyped('lower', [1, 1]);
		ribbon.setTyped('upper', [3, 3]);
		const vband = s.addOverlay('band', 'vertical');
		vband.setTyped('start', [1]);
		vband.setTyped('end', [2]);
		s.data[0].line.draw = true;

		const { container } = render(Scatterplot, { props: { theData: wrapper, which: 'plot' } });
		expect(container.querySelectorAll('path.band-ribbon')).toHaveLength(1);
		expect(container.querySelectorAll('rect.band-rect')).toHaveLength(1);
		// Draw order: the bands layer precedes the series line in document order.
		const bandsLayer = container.querySelector('g.overlay-bands-layer');
		const seriesPath = container.querySelector('g[clip-path] > path[fill="none"]:not(.band-edge)');
		expect(bandsLayer).not.toBeNull();
		expect(seriesPath).not.toBeNull();
		expect(
			bandsLayer.compareDocumentPosition(seriesPath) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	it('lines are drawn after (above) the series', () => {
		const { wrapper, s } = mkPlot();
		const line = s.addOverlay('line', 'vertical');
		line.setTyped('at', [2]);
		s.data[0].line.draw = true;
		const { container } = render(Scatterplot, { props: { theData: wrapper, which: 'plot' } });
		const rule = container.querySelector('line.overlay-rule');
		const seriesPath = container.querySelector('g[clip-path] > path[fill="none"]');
		expect(
			seriesPath.compareDocumentPosition(rule) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	it('a disabled overlay and an overlay that cannot be drawn render nothing', () => {
		const { wrapper, s } = mkPlot();
		const off = s.addOverlay('line', 'vertical');
		off.setTyped('at', [2]);
		off.enabled = false;
		const broken = s.addOverlay('band', 'ribbon');
		broken.setTyped('x', [0, 10]);
		broken.setTyped('lower', [1]); // length mismatch → warning, nothing drawn
		broken.setTyped('upper', [3, 3]);
		expect(broken.warning).toMatch(/cannot be drawn/);
		const { container } = render(Scatterplot, { props: { theData: wrapper, which: 'plot' } });
		expect(container.querySelectorAll('line.overlay-rule')).toHaveLength(0);
		expect(container.querySelectorAll('path.band-ribbon')).toHaveLength(0);
	});
});

describe('Overlays tab: one picker per channel', () => {
	// Decision 2026-09-18: a channel holds ONE column, so the block shows exactly
	// one picker per channel: the wired column when wired, else the blank picker.
	// (The dynamic-`at` era rendered one picker per wire PLUS an always-present
	// blank one; a wired Line showed two.)
	const pickersIn = (container) =>
		container.querySelectorAll('.overlay-channel-pickers > .clps-container');

	it('an unwired Line shows one (blank) picker', () => {
		const { s } = mkPlot();
		const line = s.addOverlay('line', 'vertical');
		const { container } = render(Overlay, {
			props: { overlay: line, inner: s, which: 'controls' }
		});
		expect(container.querySelectorAll('.overlay-channel')).toHaveLength(1);
		expect(pickersIn(container)).toHaveLength(1);
	});

	it('a wired Line still shows exactly one picker (the wired column, no extra blank)', () => {
		const { s } = mkPlot();
		const line = s.addOverlay('line', 'vertical');
		line.setWire('at', mkCol([2, 5]));
		const { container } = render(Overlay, {
			props: { overlay: line, inner: s, which: 'controls' }
		});
		expect(pickersIn(container)).toHaveLength(1);
	});

	it('a ribbon band shows one picker per channel (x, lower, upper), wired or not', () => {
		const { s } = mkPlot();
		const band = s.addOverlay('band', 'ribbon');
		band.setWire('lower', mkCol([1, 1, 1]));
		const { container } = render(Overlay, {
			props: { overlay: band, inner: s, which: 'controls' }
		});
		const rows = container.querySelectorAll('.overlay-channel');
		expect(rows).toHaveLength(3);
		for (const row of rows) {
			expect(row.querySelectorAll('.overlay-channel-pickers > .clps-container')).toHaveLength(1);
		}
	});
});
