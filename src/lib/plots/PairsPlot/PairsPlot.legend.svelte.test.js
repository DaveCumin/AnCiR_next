// @ts-nocheck
/**
 * PairsPlot legend: the entries are the MARKS the matrix draws, not its variables.
 *
 * Every variable is drawn in the same `pointColour` and its name is already printed
 * on its diagonal cell and down the left edge, so a per-variable legend would be N
 * identical swatches restating labels that are on screen. What a reader genuinely
 * cannot decode is which mark is which: points, the density curve, the fit line.
 *
 * These tests pin that contract, the honesty conditions (an entry only when the mark
 * is actually drawn), the default-off flag for saved sessions, and the fact that the
 * swatch colours come from the SAME module constants the template strokes with.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { core } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import PairsPlot, {
	PairsPlotClass,
	PAIRS_DENSITY_STROKE,
	PAIRS_DENSITY_WIDTH,
	PAIRS_FIT_STROKE,
	PAIRS_FIT_WIDTH
} from './PairsPlot.svelte';

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

/** A pairs plot with `n` wired numeric variables on a 500x400 figure. */
function mkPairs(n) {
	const wrapper = { id: 1, type: 'pairsplot', name: 'p', width: 500, height: 400, plot: null };
	const p = new PairsPlotClass(wrapper, null);
	const seeds = [
		[1, 2, 3, 4, 5, 6, 7, 8],
		[2, 1, 4, 3, 6, 5, 8, 7],
		[8, 6, 7, 5, 3, 4, 1, 2]
	];
	for (let i = 0; i < n; i++) p.addData({ column: { refId: mkCol(`v${i + 1}`, seeds[i]) } });
	wrapper.plot = p;
	return { wrapper, p };
}

const labels = (p) => p.getLegendItems.map((it) => it.label);

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
});
afterEach(() => cleanup());

describe('PairsPlot legend items describe the marks', () => {
	it('three wired variables with the density curve on give exactly the three mark entries', () => {
		const { p } = mkPairs(3);
		p.showDensity = true;
		expect(labels(p)).toEqual(['Observations', 'Density', 'Linear fit']);

		const [obs, density, fit] = p.getLegendItems;
		expect(obs.elements).toEqual([
			{ type: 'points', color: p.pointColour, shape: 'circle', size: 3 }
		]);
		expect(density.elements).toEqual([
			{
				type: 'line',
				color: PAIRS_DENSITY_STROKE,
				strokeWidth: PAIRS_DENSITY_WIDTH,
				stroke: 'solid'
			}
		]);
		expect(fit.elements).toEqual([
			{ type: 'line', color: PAIRS_FIT_STROKE, strokeWidth: PAIRS_FIT_WIDTH, stroke: 'solid' }
		]);
	});

	it('the entries are marks, not variables: three variables do not make three swatches', () => {
		const { p } = mkPairs(3);
		expect(labels(p)).not.toContain('v1');
		expect(labels(p)).not.toContain('v2');
		expect(labels(p)).not.toContain('v3');
	});

	it('turning the density curve off drops only the Density entry', () => {
		const { p } = mkPairs(3);
		p.showDensity = false;
		expect(labels(p)).toEqual(['Observations', 'Linear fit']);
		p.showDensity = true;
		expect(labels(p)).toEqual(['Observations', 'Density', 'Linear fit']);
	});

	it('fewer than two variables draws nothing, so it legends nothing', () => {
		expect(labels(mkPairs(0).p)).toEqual([]);
		expect(labels(mkPairs(1).p)).toEqual([]);
		expect(labels(mkPairs(2).p)).toEqual(['Observations', 'Density', 'Linear fit']);
	});

	it('the pointColour swatch follows the plot, so it can never misdescribe the points', () => {
		const { p } = mkPairs(2);
		p.pointColour = '#123456';
		expect(p.getLegendItems[0].elements[0].color).toBe('#123456');
	});
});

describe('PairsPlot legend swatches match the marks actually drawn', () => {
	it('the density path and fit line in the SVG stroke with the same constants the legend shows', () => {
		const { wrapper, p } = mkPairs(3);
		p.showDensity = true;
		const { container } = render(PairsPlot, { props: { theData: wrapper, which: 'plot' } });

		const densityPaths = [...container.querySelectorAll('path[stroke]')];
		expect(densityPaths.length).toBeGreaterThan(0);
		for (const el of densityPaths) {
			expect(el.getAttribute('stroke')).toBe(PAIRS_DENSITY_STROKE);
			expect(el.getAttribute('stroke-width')).toBe(String(PAIRS_DENSITY_WIDTH));
		}

		const fitLines = [...container.querySelectorAll('line[stroke]')];
		expect(fitLines.length).toBeGreaterThan(0);
		for (const el of fitLines) {
			expect(el.getAttribute('stroke')).toBe(PAIRS_FIT_STROKE);
			expect(el.getAttribute('stroke-width')).toBe(String(PAIRS_FIT_WIDTH));
		}
	});

	it('the legend text renders in the SVG when shown and not when hidden', () => {
		const { wrapper, p } = mkPairs(3);
		p.legend.show = true;
		const shown = render(PairsPlot, { props: { theData: wrapper, which: 'plot' } });
		const text = [...shown.container.querySelectorAll('text')].map((t) => t.textContent.trim());
		expect(text).toContain('Observations');
		expect(text).toContain('Density');
		expect(text).toContain('Linear fit');
		cleanup();

		const { wrapper: w2, p: p2 } = mkPairs(3);
		p2.legend.show = false;
		const hidden = render(PairsPlot, { props: { theData: w2, which: 'plot' } });
		const text2 = [...hidden.container.querySelectorAll('text')].map((t) => t.textContent.trim());
		expect(text2).not.toContain('Observations');
		expect(text2).not.toContain('Density');
		expect(text2).not.toContain('Linear fit');
	});
});

describe('PairsPlot legend persistence', () => {
	it('defaults OFF on a brand-new plot, so a legend never appears on a finished figure', () => {
		const { p } = mkPairs(2);
		expect(p.legend.show).toBe(false);
	});

	it('an OLD saved session (no legend key) loads with the legend off', () => {
		const wrapper = { id: 2, type: 'pairsplot', name: 'p', width: 500, height: 400 };
		expect(PairsPlotClass.fromJSON(wrapper, {}).legend.show).toBe(false);
		expect(PairsPlotClass.fromJSON(wrapper, null).legend.show).toBe(false);
	});

	it('round trips through toJSON/fromJSON, keeping a deliberately shown legend shown', () => {
		const { p } = mkPairs(2);
		p.legend.show = true;
		p.legend.position = 'bottomleft';
		p.legend.orientation = 'horizontal';
		const json = JSON.parse(JSON.stringify(p.toJSON()));
		expect(json.legend.show).toBe(true);

		const wrapper = { id: 3, type: 'pairsplot', name: 'p', width: 500, height: 400 };
		const back = PairsPlotClass.fromJSON(wrapper, json);
		expect(back.legend.show).toBe(true);
		expect(back.legend.position).toBe('bottomleft');
		expect(back.legend.orientation).toBe('horizontal');
		expect(back.legend.toJSON()).toEqual(json.legend);
	});
});
