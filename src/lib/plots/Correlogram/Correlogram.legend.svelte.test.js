/**
 * The correlogram's shared series legend: what each series contributes, the
 * separate confidence-bounds entry, the persisted legend settings, and the
 * legend actually reaching the rendered SVG.
 *
 * The legend defaults OFF for this plot (LegendClass.withDefaults(..., { show:
 * false })): every saved session already contains correlograms, so a legend
 * switching itself on at load would silently change a finished figure.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { core } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import Correlogram, { Correlogramclass } from './Correlogram.svelte';

function mkCol(name, values, type = 'number') {
	const c = new Column({ type, data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

const TIMES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const WAVE = TIMES.map((t) => Math.sin((t * Math.PI) / 3));

/** A 400x300 correlogram figure with `n` wired series. */
function mkPlot(n = 1) {
	const wrapper = { id: 1, type: 'correlogram', name: 'c', width: 400, height: 300, plot: null };
	const c = new Correlogramclass(wrapper, null);
	c.padding = { top: 20, right: 30, bottom: 30, left: 50 };
	const xId = mkCol('t', TIMES);
	for (let i = 0; i < n; i++) {
		c.addData({ x: { refId: xId }, y: { refId: mkCol('series' + (i + 1), WAVE) } });
	}
	wrapper.plot = c;
	return { wrapper, c };
}

const labels = (c) => c.getLegendItems.map((i) => i.label);

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
});
afterEach(() => cleanup());

describe('Correlogram legend items', () => {
	it('contributes one entry per drawn series, labelled by the wired y column and carrying its colours', () => {
		const { c } = mkPlot(2);
		c.data.forEach((d) => (d.showConfidenceBounds = false));
		c.data[0].line.colour = '#123456';
		c.data[0].points.draw = true;
		c.data[0].points.colour = '#abcdef';

		expect(labels(c)).toEqual(['series1', 'series2']);
		const first = c.getLegendItems[0];
		expect(first.elements.map((e) => e.type)).toEqual(['line', 'points']);
		expect(first.elements[0].color).toBe('#123456');
		expect(first.elements[0].strokeWidth).toBe(c.data[0].line.strokeWidth);
		expect(first.elements[0].stroke).toBe(c.data[0].line.stroke);
		expect(first.elements[1].color).toBe('#abcdef');
		expect(first.elements[1].shape).toBe(c.data[0].points.shape);
	});

	it('a user label wins over the wired column name', () => {
		const { c } = mkPlot(1);
		c.data[0].showConfidenceBounds = false;
		c.data[0].label = 'Mouse A';
		expect(labels(c)).toEqual(['Mouse A']);
	});

	it('drops the line element when the line is hidden and the points element when points are hidden', () => {
		const { c } = mkPlot(1);
		const d = c.data[0];
		d.showConfidenceBounds = false;
		d.line.draw = false;
		d.points.draw = true;
		expect(c.getLegendItems[0].elements.map((e) => e.type)).toEqual(['points']);
		d.line.draw = true;
		d.points.draw = false;
		expect(c.getLegendItems[0].elements.map((e) => e.type)).toEqual(['line']);
	});

	it('a fully invisible series contributes nothing at all', () => {
		const { c } = mkPlot(2);
		c.data.forEach((d) => (d.showConfidenceBounds = false));
		const d = c.data[0];
		d.line.draw = false;
		d.points.draw = false;
		expect(d.getLegendItem()).toBeNull();
		expect(labels(c)).toEqual(['series2']);
	});
});

describe('Correlogram confidence-bounds legend entry', () => {
	it('appears only when the bounds are actually drawn, and carries the confidence line style', () => {
		const { c } = mkPlot(1);
		const d = c.data[0];
		d.showConfidenceBounds = true;
		d.confidenceLine.draw = true;
		d.confidenceLine.colour = '#ff0000';

		expect(d.confidenceBoundsDrawn).toBe(true);
		const item = c.getLegendItems.find((i) => i.label !== 'series1');
		expect(item).toBeTruthy();
		expect(item.elements).toHaveLength(1);
		expect(item.elements[0].type).toBe('line');
		expect(item.elements[0].color).toBe('#ff0000');
		expect(item.elements[0].strokeWidth).toBe(d.confidenceLine.strokeWidth);
		expect(item.elements[0].stroke).toBe(d.confidenceLine.stroke);
		// Its own colour, not the series line's.
		expect(item.elements[0].color).not.toBe(d.line.colour);
	});

	it('is suppressed by the showConfidenceBounds gate and by the line being hidden', () => {
		const { c } = mkPlot(1);
		const d = c.data[0];
		d.confidenceLine.draw = true;

		d.showConfidenceBounds = false;
		expect(d.confidenceBoundsDrawn).toBe(false);
		expect(d.getConfidenceLegendItem()).toBeNull();
		expect(labels(c)).toEqual(['series1']);

		d.showConfidenceBounds = true;
		d.confidenceLine.draw = false;
		expect(d.confidenceBoundsDrawn).toBe(false);
		expect(labels(c)).toEqual(['series1']);
	});

	it('names the series when there is more than one, and the confidence level either way', () => {
		const { c } = mkPlot(2);
		c.data.forEach((d) => {
			d.showConfidenceBounds = true;
			d.confidenceLine.draw = true;
		});
		expect(labels(c)).toEqual(['series1', 'series1 95% bounds', 'series2', 'series2 95% bounds']);

		const single = mkPlot(1).c;
		single.data[0].showConfidenceBounds = true;
		single.data[0].confidenceLine.draw = true;
		single.data[0].confidenceLevel = 0.99;
		expect(labels(single)).toEqual(['series1', '99% confidence bounds']);
	});
});

describe('Correlogram legend persistence', () => {
	it('defaults OFF for a brand-new plot and for an old session that has no legend key', () => {
		const wrapper = { id: 2, type: 'correlogram', name: 'c', width: 400, height: 300, plot: null };
		expect(new Correlogramclass(wrapper, null).legend.show).toBe(false);
		expect(Correlogramclass.fromJSON(wrapper, {}).legend.show).toBe(false);
		expect(Correlogramclass.fromJSON(wrapper, null).legend.show).toBe(false);
	});

	it('round trips the legend settings through toJSON / fromJSON', () => {
		const { wrapper, c } = mkPlot(1);
		c.legend.show = true;
		c.legend.position = 'bottomleft';
		c.legend.orientation = 'horizontal';
		c.legend.padding = 12;
		c.legend.fontSize = 17;

		const json = JSON.parse(JSON.stringify(c.toJSON()));
		expect(json.legend.show).toBe(true);
		const back = Correlogramclass.fromJSON(wrapper, json);
		expect(back.legend.show).toBe(true);
		expect(back.legend.position).toBe('bottomleft');
		expect(back.legend.orientation).toBe('horizontal');
		expect(back.legend.padding).toBe(12);
		expect(back.legend.fontSize).toBe(17);
	});
});

describe('Correlogram legend rendering', () => {
	it('draws the series labels in the SVG when show is true, and nothing when false', () => {
		const { wrapper, c } = mkPlot(2);
		c.data.forEach((d) => (d.showConfidenceBounds = false));
		c.legend.show = true;

		const shown = render(Correlogram, { props: { theData: wrapper, which: 'plot' } });
		const texts = [...shown.container.querySelectorAll('svg text')].map((t) =>
			t.textContent.trim()
		);
		expect(texts).toContain('series1');
		expect(texts).toContain('series2');
		cleanup();

		c.legend.show = false;
		const hidden = render(Correlogram, { props: { theData: wrapper, which: 'plot' } });
		const hiddenTexts = [...hidden.container.querySelectorAll('svg text')].map((t) =>
			t.textContent.trim()
		);
		expect(hiddenTexts).not.toContain('series1');
		expect(hiddenTexts).not.toContain('series2');
	});
});
