// @ts-nocheck
// A legend in a workflow-canvas node must be a miniature of the figure's legend, not a
// full-size legend pasted onto a miniature plot.
//
// A node draws the plot at the node's size (`renderBox`) and shrinks the TYPE by `fontScale`
// (plots/viewBox.js). The legend's label text shrank with it, but everything else in the box
// (inner padding, item spacing, the 25 px swatch column, the gap, the inset from the plot
// edge) stayed at full size. So in a node the box was roughly twice as big relative to the
// plot as it is in the figure, 'auto' found no inside spot big enough, and the legend was
// pushed OUTSIDE the plot area on plots whose figure keeps it comfortably inside (histogram,
// mean ± SEM, Q-Q on the shipped demos). Reported as "the legend is being put off the plots".
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup } from '@testing-library/svelte';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import Legend, { LegendClass } from '$lib/components/plotbits/Legend.svelte';
import { LEGEND_MARGIN } from '$lib/components/plotbits/legendLayout.js';

const DEMOS = join(process.cwd(), 'static', 'sessions', 'demos');

async function loadDemo(name, type) {
	await importJson(JSON.parse(readFileSync(join(DEMOS, name + '.json'), 'utf8')));
	const wrapper = core.plots.find((p) => p.type === type);
	expect(wrapper, `${name} has a ${type}`).toBeTruthy();
	return wrapper.plot;
}

// The scale a default-sized plot node draws at: the shipped demos are 520 x 300 figures shown
// in a 237 x 137 node, measured in the running app.
const NODE_SCALE = 237 / 520;

beforeAll(async () => {
	appConsts.plotMap = await loadPlots();
	appConsts.processMap = await loadProcesses();
	appConsts.tableProcessMap = await loadTableProcesses();
}, 60000);

beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.tableProcesses = [];
});

afterEach(() => cleanup());

describe('auto legend placement in a workflow node', () => {
	for (const [name, type] of [
		['demo-histogram-normal', 'histogram'],
		['demo-meansem-by-day', 'meansem'],
		['demo-qqplot-normality', 'qqplot']
	]) {
		it(`${type}: the node keeps the legend inside, where the figure puts it`, async () => {
			const p = await loadDemo(name, type);
			p.legend.show = true;
			p.legend.position = 'auto';
			const figure = { ...p.legendLayout.auto };
			const figureBox = { ...p.legendLayout.box };
			expect(figure.outside).toBe(false);

			p.renderBox = { w: p.parentBox.width * NODE_SCALE, h: p.parentBox.height * NODE_SCALE };
			expect(p.fontScale).toBeCloseTo(NODE_SCALE, 6);

			// The box is the figure's box, scaled: every part of it, not only the text.
			expect(p.legendLayout.box.width).toBeCloseTo(figureBox.width * NODE_SCALE, 6);
			expect(p.legendLayout.box.height).toBeCloseTo(figureBox.height * NODE_SCALE, 6);
			// So it still fits where the figure put it, and nothing is reserved outside.
			expect(p.legendLayout.auto).toMatchObject({ outside: false, name: figure.name });
			expect(p.plotwidth).toBe(p.basePlotWidth);
			// Inset from the top edge by the scaled margin, as the figure is by the full one
			// (all three demos choose a top corner).
			expect(p.legendLayout.auto.y).toBeCloseTo(LEGEND_MARGIN * NODE_SCALE, 6);
		});
	}

	it('a per-legend type size override shrinks with the node too', async () => {
		const p = await loadDemo('demo-histogram-normal', 'histogram');
		p.legend.show = true;
		p.legend.fontSize = 14;
		const figureBox = { ...p.legendLayout.box };
		p.renderBox = { w: p.parentBox.width * NODE_SCALE, h: p.parentBox.height * NODE_SCALE };
		expect(p.legendLayout.fontPx).toBeCloseTo(14 * NODE_SCALE, 6);
		expect(p.legendLayout.box.width).toBeCloseTo(figureBox.width * NODE_SCALE, 6);
	});

	it('an outside legend in a node is inset by the scaled margin', async () => {
		const p = await loadDemo('demo-histogram-normal', 'histogram');
		p.legend.show = true;
		p.legend.position = 'outsideright';
		p.renderBox = { w: p.parentBox.width * NODE_SCALE, h: p.parentBox.height * NODE_SCALE };
		const m = LEGEND_MARGIN * NODE_SCALE;
		expect(p.legendLayout.reserveW).toBeCloseTo(p.legendLayout.box.width + m, 6);
		expect(p.legendLayout.outsidePosition.x).toBeCloseTo(p.plotwidth + m, 6);
	});
});

describe('the drawn legend in a node', () => {
	const items = [
		{
			label: 'activity',
			elements: [{ type: 'points', color: '#234154', shape: 'circle', size: 3 }]
		},
		{ label: 'a longer label', elements: [{ type: 'line', color: '#234154', strokeWidth: 2 }] }
	];

	function drawn(fontScale) {
		const { container } = render(Legend, {
			props: {
				which: 'plot',
				legendData: new LegendClass({ show: true, position: 'topright' }),
				items,
				plotWidth: 400,
				plotHeight: 300,
				padding: { top: 0, right: 0, bottom: 0, left: 0 },
				figureStyle: fontScale === 1 ? null : { fontScale }
			}
		});
		const rect = container.querySelector('rect');
		const g = rect.parentElement;
		const [, x, y] = g.getAttribute('transform').match(/translate\(([-\d.e]+),\s*([-\d.e]+)\)/);
		const out = {
			w: Number(rect.getAttribute('width')),
			h: Number(rect.getAttribute('height')),
			x: Number(x),
			y: Number(y),
			textX: Number(container.querySelector('text').getAttribute('x'))
		};
		cleanup();
		return out;
	}

	it('is the figure legend scaled down, box, inset and label offset alike', () => {
		const full = drawn(1);
		const half = drawn(0.5);
		expect(half.w).toBeCloseTo(full.w / 2, 6);
		expect(half.h).toBeCloseTo(full.h / 2, 6);
		expect(half.textX).toBeCloseTo(full.textX / 2, 6);
		// Top right, inset by the scaled margin.
		expect(half.y).toBeCloseTo(LEGEND_MARGIN / 2, 6);
		expect(half.x).toBeCloseTo(400 - half.w - LEGEND_MARGIN / 2, 6);
	});
});
