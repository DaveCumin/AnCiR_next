// @ts-nocheck
/**
 * The Python export's figure look: the APP's side.
 *
 * Loads real demo sessions (static/sessions/demos), changes a saved setting where a case says
 * so (exactly the field the app's control writes: a display zone, a tick count, manual ticks,
 * gridlines off, a log axis, a figure type size, a time tick format, actogram row labels or
 * the heatmap), mounts the real plot component and records what it DRAWS: every axis's ticks
 * (value, label, gridline or not), its tick and title type size and family, its title, the
 * scale domains, the legend and colour-bar type sizes, the actogram's row labels and heatmap
 * cell colours.
 *
 * tools/test_plot_axes_style.py renders the same sessions through the Python runtime and
 * checks the exported figure draws exactly these ticks and labels, these gridlines, these
 * domains and these sizes. The fixture is COMMITTED (tools/parity/axis_style_app.json) so the
 * Python suite runs on its own; this test fails when the app no longer draws it (regenerate
 * with the command below and commit the result).
 *
 *   GEN_AXIS_STYLE=1 pnpm vitest run src/lib/_parity/emitAxisStyle.svelte.test.js
 */
import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, appState, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { exportColumnLabels } from '$lib/core/columnLabels.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';
import { resolveStyle } from '$lib/plots/figureStyle.js';
import { execFileSync } from 'node:child_process';
import { plotByName, demoRefs } from './demoRefs.js';

const ROOT = process.cwd();
const DEMOS = join(ROOT, 'static', 'sessions', 'demos');
const OUT = join(ROOT, 'tools', 'parity', 'axis_style_app.json');
const GENERATE = process.env.GEN_AXIS_STYLE === '1';

// A worker that refuses every message, so the pool computes synchronously.
class SyncComputeWorker {
	postMessage() {
		throw new Error('force synchronous compute');
	}
	terminate() {}
}

const SERIF_L = { fontFamily: 'serif', fontSize: 'l', fontSizePt: null, roleScale: null };

/**
 * Each case: a demo, the plot in it (by NAME: demo ids shift whenever the generator adds a
 * node), the display zone, and the saved settings to change (`edit(plotJSON, ref)` writes the
 * same fields the app's controls write; `ref` finds the demo's columns by name, see
 * demoRefs.js).
 */
const CASES = [
	{
		name: 'timeUtc',
		demo: 'demo-tp-joindata',
		plot: 'Join Data: hourly ambient and hive',
		zone: 'utc'
	},
	{
		name: 'timeKolkata',
		demo: 'demo-tp-joindata',
		plot: 'Join Data: hourly ambient and hive',
		zone: 'Asia/Kolkata'
	},
	{
		name: 'timeNewYorkDst',
		demo: 'demo-tp-joindata',
		plot: 'Join Data: hourly ambient and hive',
		zone: 'America/New_York',
		// Two days across the 10 March 2024 change to daylight time (07:00 UTC).
		edit: (p) => {
			p.plot.xlimsIN = [Date.UTC(2024, 2, 9, 12), Date.UTC(2024, 2, 11, 12)];
		}
	},
	{
		name: 'timeFormatTicks',
		demo: 'demo-tp-joindata',
		plot: 'Join Data: hourly ambient and hive',
		zone: 'Europe/London',
		edit: (p) => {
			p.plot.xTickFormat = 'DD MMM HH:mm';
			p.plot.xAxis.nticks = 3;
			p.plot.yAxisLeft.nticks = 8;
			p.plot.yAxisLeft.gridlines = false;
			p.plot.yAxisRight.gridlines = true;
		}
	},
	{
		name: 'timeColourBy',
		demo: 'demo-workflow-colour-by-hysteresis',
		plot: 'Hive against air, by hour and humidity',
		zone: 'utc',
		// A fixed corner: the export does not reproduce the 'auto' legend's search.
		edit: (p) => {
			p.plot.legend.position = 'topleft';
		}
	},
	{
		name: 'timeAxisDays',
		demo: 'demo-workflow-colour-by-hysteresis',
		plot: 'Air and hive over time',
		zone: 'Pacific/Auckland',
		edit: (p) => {
			p.plot.legend.position = 'bottomright';
			p.plot.xAxis.nticks = 10;
		}
	},
	{ name: 'numericScatter', demo: 'demo-scatter-rhythm', plot: 'Activity vs hour', zone: 'utc' },
	{
		name: 'numericScatterStyled',
		demo: 'demo-scatter-rhythm',
		plot: 'Activity vs hour',
		zone: 'utc',
		edit: (p) => {
			p.style = { ...p.style, ...SERIF_L };
			p.plot.xAxis.manualTicks = [0, 24, 36, 48, 1000];
			p.plot.yAxisLeft.nticks = 3;
			p.plot.xAxis.gridlines = false;
			p.plot.legend.show = true;
		}
	},
	{
		name: 'scatterLogY',
		demo: 'demo-scatter-rhythm',
		plot: 'Activity vs hour',
		zone: 'utc',
		edit: (p) => {
			p.plot.yLogScaleLeft = true;
			p.plot.ylimsLeftIN = [0.5, 2000];
		}
	},
	{
		name: 'periodogram',
		demo: 'demo-periodogram-rhythm',
		plot: 'Activity periodogram',
		zone: 'utc'
	},
	{
		name: 'periodogramLog',
		demo: 'demo-periodogram-rhythm',
		plot: 'Activity periodogram',
		zone: 'utc',
		edit: (p) => {
			p.plot.logScale = true;
			p.plot.xAxis.nticks = 8;
		}
	},
	{
		name: 'periodogramManualTicks',
		demo: 'demo-periodogram-rhythm',
		plot: 'Activity periodogram',
		zone: 'utc',
		edit: (p) => {
			p.plot.xAxis.manualTicks = [6, 12, 24, 30];
			p.plot.xAxis.gridlines = false;
			p.style = { ...p.style, fontSize: 's', fontSizePt: null, roleScale: null };
		}
	},
	{ name: 'fft', demo: 'demo-fft-rhythm', plot: 'Signal FFT', zone: 'utc' },
	{
		name: 'fftLog',
		demo: 'demo-fft-rhythm',
		plot: 'Signal FFT',
		zone: 'utc',
		edit: (p) => {
			p.plot.logScale = true;
		}
	},
	{
		name: 'correlogram',
		demo: 'demo-correlogram-rhythm',
		plot: 'Activity correlogram',
		zone: 'utc'
	},
	// With its significance bars, which raise the value axis (tools/test_plot_boxplot.py).
	{
		name: 'boxplot',
		demo: 'demo-tp-groupcomparison',
		plot: 'Compare groups (stats): groups',
		zone: 'utc'
	},
	{
		name: 'actogram',
		demo: 'demo-workflow-masking',
		plot: 'Actogram: truly entrained',
		zone: 'utc'
	},
	{
		name: 'actogramRowsHeatmap',
		demo: 'demo-workflow-masking',
		plot: 'Actogram: truly entrained',
		zone: 'utc',
		edit: (p) => {
			p.plot.rowLabels = 'period';
			p.plot.renderMode = 'heatmap';
			p.plot.colormap = 'magma';
			p.plot.xAxis.gridlines = true;
		}
	},
	{
		// A heatmap of a series whose range does not start at 0 (air temperature, 10.5 to
		// 25.3 C): the masking demo's actogram, rewired to the hysteresis demo's columns.
		name: 'actogramHeatOffset',
		demo: 'demo-workflow-colour-by-hysteresis',
		source: { demo: 'demo-workflow-masking', plot: 'Actogram: truly entrained' },
		zone: 'utc',
		edit: (p, ref) => {
			p.id = 500;
			p.plot.data = [
				{
					...p.plot.data[0],
					x: { refId: ref.col('time') },
					y: { refId: ref.col('air temperature') }
				}
			];
			p.plot.renderMode = 'heatmap';
			p.plot.colormap = 'viridis';
		}
	},
	{
		name: 'actogramDates',
		demo: 'demo-actogram-rhythm',
		plot: 'Activity actogram',
		zone: 'Asia/Kolkata',
		edit: (p) => {
			p.plot.rowLabels = 'date';
			p.plot.dateFormat = 'D MMM';
		}
	}
];

function resetCore() {
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.notes = [];
	core.nodeNotes = {};
	core.orphanProcesses = [];
	core.storedValues = {};
	core.rawData = new Map();
	core.seriesAppearance = {};
	appState.displayTimezone = 'utc';
}

const num = (v) => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Number(v));
const round = (v) => (Number.isFinite(v) ? Math.round(v * 1e9) / 1e9 : null);
const px = (s) => (s == null || s === '' ? null : round(parseFloat(s)));

/** What the mounted plot draws. */
function drawn(container, inner, style) {
	const axes = {};
	for (const g of container.querySelectorAll('g[class^="axis-"]')) {
		const position = g.getAttribute('class').replace('axis-', '').split(' ')[0];
		const ticks = [...g.querySelectorAll('g.tick')].map((t) => ({
			value: round(num(t.__data__)),
			label: t.querySelector('text')?.textContent ?? '',
			grid: !!t.querySelector('line.gridline')
		}));
		const label = g.querySelector('text.axis-label');
		axes[position] = {
			ticks,
			tickPx: px(g.style.fontSize),
			fontFamily: g.style.fontFamily,
			label: label?.textContent ?? '',
			labelPx: px(label?.style.fontSize)
		};
	}
	const domains = {};
	for (const key of [
		'XScale',
		'YScaleLeft',
		'YScaleRight',
		'yScale',
		'overlayXScale',
		'overlayYScale'
	]) {
		let scale;
		try {
			scale = inner[key];
		} catch {
			scale = null;
		}
		if (scale && typeof scale.domain === 'function') {
			domains[key] = scale.domain().map((v) => round(num(v)));
		}
	}
	const texts = (sel) =>
		[...container.querySelectorAll(sel)].map((t) => ({
			text: t.textContent,
			px: px(t.getAttribute('font-size'))
		}));
	const legend = [...container.querySelectorAll('text[dy="0.35em"]')].map((t) => ({
		text: t.textContent,
		px: px(t.getAttribute('font-size'))
	}));
	const rowLabels = [
		...container.querySelectorAll('text[text-anchor="end"][dominant-baseline="central"]')
	]
		.filter((t) => !t.classList.contains('colour-scale-tick'))
		.map((t) => ({ text: t.textContent, px: px(t.getAttribute('font-size')) }));
	// Heatmap cells as [start (h along the row), row, fill], from where each is drawn.
	const span = (inner.periodHrs ?? 24) * (inner.doublePlot ?? 1);
	const heatCells = [...container.querySelectorAll('rect[shape-rendering="crispEdges"]')].map(
		(r) => [
			round(((Number(r.getAttribute('x')) - inner.padding.left) / inner.plotwidth) * span),
			Math.round(
				(Number(r.getAttribute('y')) - inner.padding.top - inner.rowGap) /
					(inner.rowGap + inner.eachplotheight)
			),
			r.getAttribute('fill')
		]
	);
	const heatLegend = [...container.querySelectorAll('text[font-size="9"]')].map(
		(t) => t.textContent
	);
	const r = resolveStyle(style);
	return {
		axes,
		domains,
		plotSize: [round(inner.plotwidth), round(inner.plotheight)],
		sizes: r.sizes,
		fontFamily: r.fontFamily,
		legend,
		colourScale: texts('text.colour-scale-tick'),
		colourScaleTitle: texts('text.colour-scale-label'),
		rowLabels,
		heatCells,
		heatLegend
	};
}

async function runCase(c) {
	resetCore();
	const session = JSON.parse(readFileSync(join(DEMOS, c.demo + '.json'), 'utf8'));
	const from = c.source
		? JSON.parse(readFileSync(join(DEMOS, c.source.demo + '.json'), 'utf8'))
		: session;
	const plotJSON = structuredClone(
		plotByName(from, c.source?.plot ?? c.plot, c.source?.demo ?? c.demo)
	);
	c.edit?.(plotJSON, demoRefs(session, c.demo));
	appState.displayTimezone = c.zone;
	core.storedValues = session.storedValues ?? {};
	core.groups = session.groups ?? [];
	core.rawData = new Map(Object.entries(session.rawData ?? {}).map(([k, v]) => [+k, v]));
	for (const cd of session.data ?? []) pushObj(Column.fromJSON(cd));
	for (const tpj of session.tableProcesses ?? []) {
		core.tableProcesses.push(new TableProcess(tpj, null, tpj.id));
	}
	for (const tp of core.tableProcesses) {
		try {
			await tp.doProcess();
		} catch {
			// a node that cannot run here draws nothing
		}
	}
	const plot = Plot.fromJSON(plotJSON);
	core.plots.push(plot);
	const live = core.plots[core.plots.length - 1];
	const Comp = appConsts.plotMap.get(live.type).plot;
	const { container } = render(Comp, { props: { theData: live, which: 'plot' } });
	// Calculating plots compute after a debounce (the Periodogram waits 250 ms, then yields):
	// wait until every series has its numbers, or 5 s.
	const ready = () =>
		(live.plot.data ?? []).every((d) => !('periodData' in d) || (d.periodData?.x?.length ?? 0) > 0);
	for (let i = 0; i < 100 && !(i > 4 && ready()); i++) {
		flushSync();
		await tick();
		await new Promise((r) => setTimeout(r, 50));
	}
	flushSync();
	await tick();
	flushSync();
	const out = drawn(container, live.plot, live.style);
	// The names the app shows for node outputs ("Binned: air temperature"), which the export
	// carries too: a key titled by its column (a size key) is as wide as its words.
	const columnLabels = exportColumnLabels();
	cleanup();
	return {
		name: c.name,
		demo: c.demo,
		plotId: plotJSON.id,
		zone: c.zone,
		plotJSON,
		columnLabels,
		expected: out
	};
}

describe('Python export figure look: what the app draws', () => {
	it('records the axes, gridlines and type of every case', async () => {
		appConsts.processMap = await loadProcesses();
		appConsts.plotMap = await loadPlots();
		appConsts.tableProcessMap = await loadTableProcesses();
		setWorkerFactory(() => new SyncComputeWorker());
		const cases = [];
		for (const c of CASES) cases.push(await runCase(c));
		// Every case drew axes with ticks (a case that silently drew nothing pins nothing).
		for (const c of cases) {
			const axes = Object.values(c.expected.axes);
			expect(axes.length, c.name).toBeGreaterThan(0);
			expect(
				axes.some((a) => a.ticks.length > 0),
				c.name
			).toBe(true);
		}
		const fixture = { generatedBy: 'src/lib/_parity/emitAxisStyle.svelte.test.js', cases };
		const text = JSON.stringify(fixture);
		if (GENERATE) {
			writeFileSync(OUT, text, 'utf8');
			// Formatted as the repo's prettier formats it, so `pnpm lint` stays clean.
			execFileSync(join(ROOT, 'node_modules', '.bin', 'prettier'), ['--write', OUT]);
		} else {
			expect(existsSync(OUT), `${OUT} is missing: regenerate it (see the header)`).toBe(true);
			expect(JSON.parse(readFileSync(OUT, 'utf8'))).toEqual(JSON.parse(text));
		}
	}, 120000);
});
