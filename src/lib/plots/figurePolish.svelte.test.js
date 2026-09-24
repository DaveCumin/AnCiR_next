// @ts-nocheck
// Pixel-level fixes, checked on the shipped demo sessions:
//   - histogram bars never sit on the y axis line (x domain has room at automatic ends);
//   - boxplot whisker caps never sit on the x axis line;
//   - a boxplot coloured per category shows no single-swatch legend.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scaleLinear } from 'd3-scale';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';

const DEMOS = join(process.cwd(), 'static', 'sessions', 'demos');

async function loadDemo(name, type) {
	await importJson(JSON.parse(readFileSync(join(DEMOS, name + '.json'), 'utf8')));
	return core.plots.find((p) => p.type === type);
}

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

describe('histogram x domain', () => {
	it('the outermost bars are clear of the axis line and the right edge', async () => {
		const p = (await loadDemo('demo-histogram-normal', 'histogram')).plot;
		const b = p.data[0].binned;
		const xs = scaleLinear().domain(p.xlims).range([0, p.plotwidth]);
		expect(xs(b.bins[0])).toBeGreaterThan(4);
		expect(p.plotwidth - xs(b.binEnds.at(-1))).toBeGreaterThan(4);
	});

	it('limits the user set are kept exactly', async () => {
		const p = (await loadDemo('demo-histogram-normal', 'histogram')).plot;
		p.xlimsIN = [40, null];
		expect(p.xlims[0]).toBe(40);
		expect(p.xlims[1]).toBeGreaterThan(p.data[0].binned.binEnds.at(-1));
	});
});

describe('boxplot legend with per-category colours', () => {
	it('shows no legend: one swatch cannot stand for seven colours', async () => {
		const p = (await loadDemo('demo-boxplot-by-day', 'boxplot')).plot;
		expect(p.categoryColoured).toBe(true);
		expect(p.getLegendItems).toEqual([]);
		// ...so nothing is reserved for it either.
		expect(p.legendLayout.box).toBeNull();
		expect(p.plotwidth).toBe(p.basePlotWidth);
	});

	it('a second series brings the legend back, since colour identifies series again', async () => {
		const p = (await loadDemo('demo-boxplot-by-day', 'boxplot')).plot;
		const d = p.data[0];
		p.addData({ x: { refId: d.x.refId }, y: { refId: d.y.refId } });
		expect(p.categoryColoured).toBe(false);
		expect(p.getLegendItems).toHaveLength(2);
	});
});

describe('boxplot whisker clearance', () => {
	it('no whisker cap lies on the x axis line', async () => {
		const p = (await loadDemo('demo-boxplot-by-day', 'boxplot')).plot;
		const values = p.data[0].y.getData().filter((v) => Number.isFinite(v));
		const lo = Math.min(...values);
		const ys = scaleLinear().domain(p.ylims).range([p.plotheight, 0]);
		expect(p.plotheight - ys(lo)).toBeGreaterThanOrEqual(4 - 1e-9);
	});
});
