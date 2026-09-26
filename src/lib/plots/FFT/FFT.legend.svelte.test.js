// @ts-nocheck
// The FFT plot's shared series legend.
//
// The FFT draws magnitude and (optionally, per series) phase into ONE plot
// area: phase is an overlay with its own right-hand axis, not a separate
// stacked panel. So a single legend covers both, and a phase entry is emitted
// only for a series whose `showPhase` is on and whose phase line/points are
// actually drawn. Never an entry for something that is not on screen.
//
// The default is OFF (`show: false`): every saved session already contains FFT
// plots, and a legend that switched itself on at load would silently change a
// figure the user had finished with.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { core } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import FFT, { FFTclass } from './FFT.svelte';

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

// A 64-sample series over 64 hours, so computeFFT has something real to chew on.
function sine(n, period) {
	return Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * i) / period));
}

/** A 500x320 FFT figure with `labels.length` wired series. */
function mkFFT(labels = ['a']) {
	const wrapper = {
		id: 1,
		type: 'fft',
		name: 'p',
		width: 500,
		height: 320,
		style: null,
		plot: null
	};
	const f = new FFTclass(wrapper, null);
	f.padding = { top: 20, right: 40, bottom: 35, left: 55 };
	const xId = mkCol(
		't',
		Array.from({ length: 64 }, (_, i) => i)
	);
	labels.forEach((label, k) => {
		f.addData({ x: { refId: xId }, y: { refId: mkCol(label, sine(64, 8 + k * 4)) } });
	});
	wrapper.plot = f;
	return { wrapper, f };
}

const labels = (f) => f.getLegendItems.map((i) => i.label);

beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
});
afterEach(() => cleanup());

describe('FFT legend items', () => {
	it('emits one entry per drawn series, labelled by its wired y column, with its colours', () => {
		const { f } = mkFFT(['activity', 'temperature']);
		f.data[0].line.colour = '#123456';
		f.data[0].points.colour = '#abcdef';
		f.data[1].line.colour = '#654321';
		f.data[1].points.colour = '#fedcba';

		const items = f.getLegendItems;
		expect(items.map((i) => i.label)).toEqual(['activity', 'temperature']);
		// Line and points are both drawn by default, so each entry carries both.
		expect(items[0].elements.map((e) => e.type)).toEqual(['line', 'points']);
		expect(items[0].elements[0].color).toBe('#123456');
		expect(items[0].elements[1].color).toBe('#abcdef');
		expect(items[1].elements[0].color).toBe('#654321');
		expect(items[1].elements[1].color).toBe('#fedcba');
	});

	it('carries the line width/dash and the point radius/shape through to the entry', () => {
		const { f } = mkFFT(['activity']);
		f.data[0].line.strokeWidth = 5;
		f.data[0].line.stroke = 'dashed';
		f.data[0].points.radius = 7;
		f.data[0].points.shape = 'square';

		const [line, points] = f.getLegendItems[0].elements;
		expect(line.strokeWidth).toBe(5);
		expect(line.stroke).toBe('dashed');
		expect(points.size).toBe(7);
		expect(points.shape).toBe('square');
	});

	it('a series with neither line nor points drawn contributes nothing', () => {
		const { f } = mkFFT(['activity', 'temperature']);
		f.data[0].line.draw = false;
		f.data[0].points.draw = false;
		expect(labels(f)).toEqual(['temperature']);

		// Turning just the line back on brings the series back with a line only.
		f.data[0].line.draw = true;
		expect(labels(f)).toEqual(['activity', 'temperature']);
		expect(f.getLegendItems[0].elements.map((e) => e.type)).toEqual(['line']);
	});

	it('a phase entry appears only when that series actually draws phase', () => {
		const { f } = mkFFT(['activity']);
		// showPhase off: the phase line/points are not rendered at all.
		expect(labels(f)).toEqual(['activity']);

		f.data[0].showPhase = true;
		expect(labels(f)).toEqual(['activity', 'activity phase']);
		const phase = f.getLegendItems[1];
		expect(phase.elements.map((e) => e.type)).toEqual(['line', 'points']);

		// showPhase on but both phase marks hidden: nothing to show, no entry.
		f.data[0].phaseLine.draw = false;
		f.data[0].phasePoints.draw = false;
		expect(labels(f)).toEqual(['activity']);

		// One of them back on: the entry returns with only that element.
		f.data[0].phasePoints.draw = true;
		f.data[0].phasePoints.colour = '#00ff00';
		expect(labels(f)).toEqual(['activity', 'activity phase']);
		expect(f.getLegendItems[1].elements).toEqual([
			{ type: 'points', color: '#00ff00', size: 4, shape: 'circle' }
		]);

		// And a magnitude series that draws nothing still contributes its phase.
		f.data[0].line.draw = false;
		f.data[0].points.draw = false;
		expect(labels(f)).toEqual(['activity phase']);
	});
});

describe('FFT legend rendering', () => {
	it('draws the series labels in the SVG when show is true, and nothing when false', () => {
		const { wrapper, f } = mkFFT(['activity']);
		f.data[0].showPhase = true;
		f.legend.show = true;

		const on = render(FFT, { props: { theData: wrapper, which: 'plot' } });
		const texts = [...on.container.querySelectorAll('svg text')].map((t) => t.textContent.trim());
		expect(texts).toContain('activity');
		expect(texts).toContain('activity phase');
		cleanup();

		f.legend.show = false;
		const off = render(FFT, { props: { theData: wrapper, which: 'plot' } });
		const offTexts = [...off.container.querySelectorAll('svg text')].map((t) =>
			t.textContent.trim()
		);
		expect(offTexts).not.toContain('activity');
		expect(offTexts).not.toContain('activity phase');
	});
});

describe('FFT legend persistence', () => {
	it('defaults to hidden on a brand-new plot and on an old session with no legend key', () => {
		const { f } = mkFFT();
		expect(f.legend.show).toBe(false);
		expect(FFTclass.fromJSON({ id: 2, type: 'fft', width: 400, height: 300 }, {}).legend.show).toBe(
			false
		);
	});

	it('round-trips show/position/orientation through toJSON and fromJSON', () => {
		const { wrapper, f } = mkFFT(['activity']);
		f.legend.show = true;
		f.legend.position = 'bottomleft';
		f.legend.orientation = 'horizontal';
		f.legend.padding = 11;

		const json = JSON.parse(JSON.stringify(f.toJSON()));
		expect(json.legend.show).toBe(true);

		const back = FFTclass.fromJSON(wrapper, json);
		expect(back.legend.show).toBe(true);
		expect(back.legend.position).toBe('bottomleft');
		expect(back.legend.orientation).toBe('horizontal');
		expect(back.legend.padding).toBe(11);
	});

	it('an explicitly saved show:false survives the round trip', () => {
		const { wrapper, f } = mkFFT(['activity']);
		f.legend.show = false;
		const back = FFTclass.fromJSON(wrapper, JSON.parse(JSON.stringify(f.toJSON())));
		expect(back.legend.show).toBe(false);
	});
});
