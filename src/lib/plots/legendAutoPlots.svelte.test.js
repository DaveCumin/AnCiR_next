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
import { Plot } from '$lib/core/Plot.svelte';

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
		// A second series: with one, boxes are coloured per category and there is no legend
		// at all (see figurePolish.svelte.test.js).
		const d = p.data[0];
		p.addData({ x: { refId: d.x.refId }, y: { refId: d.y.refId } });
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

	// The five plots whose legends arrived in v76.1 (default OFF). Turned on, they place
	// 'auto' exactly as the older six do.
	it('periodogram: a corner clear of the spectrum is used, inside', async () => {
		const p = await loadDemo('demo-periodogram-rhythm', 'periodogram');
		p.legend.show = true;
		p.legend.position = 'auto';
		expect(p.legendLayout.auto).toMatchObject({ outside: false, covered: 0 });
		expect(p.plotwidth).toBe(p.basePlotWidth);
	});

	it('FFT: a corner clear of the spectrum is used, inside', async () => {
		const p = await loadDemo('demo-fft-rhythm', 'fft');
		p.legend.show = true;
		p.legend.position = 'auto';
		expect(p.legendLayout.auto).toMatchObject({ outside: false, covered: 0 });
	});

	it('correlogram: the oscillating ACF and its bounds cross every corner, so it goes outside', async () => {
		const p = await loadDemo('demo-correlogram-rhythm', 'correlogram');
		p.legend.show = true;
		p.legend.position = 'auto';
		expect(p.legendLayout.auto.outside).toBe(true);
		expect(p.plotwidth).toBeLessThan(p.basePlotWidth);
	});

	it('actogram: the legend finds a spot clear of the activity bars', async () => {
		const p = await loadDemo('demo-actogram-rhythm', 'actogram');
		p.legend.show = true;
		p.legend.position = 'auto';
		expect(p.legendLayout.auto).toMatchObject({ covered: 0 });
	});

	it('pairs plot: the matrix fills its square, so the legend goes beside it', async () => {
		const p = await loadDemo('demo-pairsplot-matrix', 'pairsplot');
		p.legend.show = true;
		p.legend.position = 'auto';
		expect(p.legendLayout.auto.outside).toBe(true);
		expect(p.legendLayout.outsidePosition.x).toBeGreaterThan(0);
	});

	it('a saved corner is honoured on every plot: no auto decision, no reservation', async () => {
		for (const [name, type] of [
			['demo-circular-phase-two-groups', 'circularphase'],
			['demo-boxplot-by-day', 'boxplot'],
			['demo-histogram-normal', 'histogram'],
			['demo-meansem-by-day', 'meansem'],
			['demo-qqplot-normality', 'qqplot'],
			['demo-scatter-rhythm', 'scatterplot'],
			['demo-periodogram-rhythm', 'periodogram'],
			['demo-fft-rhythm', 'fft'],
			['demo-correlogram-rhythm', 'correlogram'],
			['demo-actogram-rhythm', 'actogram'],
			['demo-pairsplot-matrix', 'pairsplot']
		]) {
			core.plots = [];
			const p = await loadDemo(name, type);
			p.legend.show = true;
			p.legend.position = 'topright';
			expect(p.legendLayout.auto, name).toBeNull();
			expect(p.legendLayout.reserveW + p.legendLayout.reserveH, name).toBe(0);
		}
	});
});

// The DEFAULT position (requested 2026-10-08). 'auto' may move a legend outside the plot,
// which surprised users on a brand-new figure, so a NEW legend starts top right and 'auto'
// stays one choice away in the dropdown. A loaded legend keeps exactly what it was saved
// with, 'auto' included, so no finished figure moves.
describe('legend default position', () => {
	// Every plot that draws a series legend (legendDefaultCoverage.test.js classifies them).
	const LEGEND_TYPES = [
		'scatterplot',
		'boxplot',
		'histogram',
		'meansem',
		'qqplot',
		'circularphase',
		'periodogram',
		'fft',
		'correlogram',
		'actogram',
		'pairsplot'
	];

	it('a brand-new plot of every type starts its legend top right', () => {
		for (const type of LEGEND_TYPES) {
			const p = new Plot({ type });
			expect(p.plot.legend.position, type).toBe('topright');
		}
	});

	it('a saved legend keeps its saved position on load, auto included', () => {
		for (const type of LEGEND_TYPES) {
			for (const position of ['auto', 'topright', 'bottomleft']) {
				const p = Plot.fromJSON({
					type,
					plot: { data: [], legend: { show: true, position } }
				});
				expect(p.plot.legend.position, `${type} saved ${position}`).toBe(position);
			}
		}
	});

	it('a saved legend with no position field loads top right, as it always has', () => {
		// The field has been written since legends existed; a legend without it is older
		// still and was drawn top right then, so this is unchanged by the new default.
		for (const type of LEGEND_TYPES) {
			const p = Plot.fromJSON({ type, plot: { data: [], legend: { show: true } } });
			expect(p.plot.legend.position, type).toBe('topright');
		}
	});

	it('a whole session saved with an auto legend (v77.0 to v81.11) still loads it as auto', async () => {
		// Through importJson, the real load path. The position is forced in the JSON rather
		// than read from the shipped demo, so regenerating the demos cannot hollow this out.
		const json = JSON.parse(
			readFileSync(join(DEMOS, 'demo-circular-phase-two-groups.json'), 'utf8')
		);
		const saved = json.plots.find((p) => p.type === 'circularphase');
		saved.plot.legend.position = 'auto';
		await importJson(json);
		const p = core.plots.find((w) => w.type === 'circularphase').plot;
		expect(p.legend.position).toBe('auto');
	});

	it('toJSON then fromJSON round-trips auto and the new default', () => {
		const fresh = new Plot({ type: 'scatterplot' });
		const again = Plot.fromJSON(JSON.parse(JSON.stringify(fresh.toJSON())));
		expect(again.plot.legend.position).toBe('topright');
		fresh.plot.legend.position = 'auto';
		const auto = Plot.fromJSON(JSON.parse(JSON.stringify(fresh.toJSON())));
		expect(auto.plot.legend.position).toBe('auto');
	});
});
