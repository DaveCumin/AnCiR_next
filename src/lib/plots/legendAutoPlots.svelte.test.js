// @ts-nocheck
// "Auto (avoid data)" legend placement on every plot that draws a legend, checked on the
// shipped demo sessions (the same figures the before/after screenshots were taken from).
//
// Each plot supplies its own marks to the shared LegendAutoLayout
// (components/plotbits/legendAuto.svelte.js); these tests pin what each one decides.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';

const DEMOS = join(process.cwd(), 'static', 'sessions', 'demos');

async function loadDemo(name, type) {
	await importJson(JSON.parse(readFileSync(join(DEMOS, name + '.json'), 'utf8')));
	const wrapper = core.plots.find((p) => p.type === type);
	expect(wrapper, `${name} has a ${type}`).toBeTruthy();
	return wrapper.plot;
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

describe('auto legend placement per plot', () => {
	it('circular phase: the legend leaves the ring and its "24 / 0" label alone', async () => {
		const p = await loadDemo('demo-circular-phase-two-groups', 'circularphase');
		p.legend.position = 'auto';
		// No inside spot is clear of the ring, so it goes outside; on a square figure the
		// cheaper side is below (a 3-line legend is far shorter than it is wide).
		expect(p.legendLayout.auto.outside).toBe(true);
		expect(p.legendLayout.outsidePlacement.side).toBe('below');
		expect(p.plotSize).toBeLessThan(p.basePlotWidth);
		expect(p.legendLayout.outsidePosition.y).toBeGreaterThan(p.plotSize);
	});

	it('circular phase: an explicit Outside Right goes right', async () => {
		const p = await loadDemo('demo-circular-phase-two-groups', 'circularphase');
		p.legend.position = 'outsideright';
		expect(p.legendLayout.outsidePlacement.side).toBe('right');
		expect(p.legendLayout.outsidePosition.x).toBeGreaterThan(p.plotSize);
	});

	it('boxplot: whiskers reach the top in every category, so the legend goes outside', async () => {
		const p = await loadDemo('demo-boxplot-by-day', 'boxplot');
		p.legend.position = 'auto';
		expect(p.legendLayout.auto.outside).toBe(true);
		expect(p.plotwidth).toBeLessThan(p.basePlotWidth);
	});

	it('histogram: the empty top right is used, inside', async () => {
		const p = await loadDemo('demo-histogram-normal', 'histogram');
		p.legend.position = 'auto';
		expect(p.legendLayout.auto).toMatchObject({ outside: false, name: 'topright' });
		expect(p.plotwidth).toBe(p.basePlotWidth);
	});

	it('mean ± SEM: the empty top right is used, inside', async () => {
		const p = await loadDemo('demo-meansem-by-day', 'meansem');
		p.legend.position = 'auto';
		expect(p.legendLayout.auto).toMatchObject({ outside: false, name: 'topright' });
	});

	it('Q-Q: the top right holds the upper tail, so the legend moves to the top left', async () => {
		const p = await loadDemo('demo-qqplot-normality', 'qqplot');
		p.legend.position = 'auto';
		expect(p.legendLayout.auto).toMatchObject({ outside: false, name: 'topleft' });
	});

	it('a saved corner is honoured on every plot: no auto decision, no reservation', async () => {
		for (const [name, type] of [
			['demo-circular-phase-two-groups', 'circularphase'],
			['demo-boxplot-by-day', 'boxplot'],
			['demo-histogram-normal', 'histogram'],
			['demo-meansem-by-day', 'meansem'],
			['demo-qqplot-normality', 'qqplot'],
			['demo-scatter-rhythm', 'scatterplot']
		]) {
			core.plots = [];
			const p = await loadDemo(name, type);
			p.legend.position = 'topright';
			expect(p.legendLayout.auto, name).toBeNull();
			expect(p.legendLayout.reserveW + p.legendLayout.reserveH, name).toBe(0);
		}
	});
});
