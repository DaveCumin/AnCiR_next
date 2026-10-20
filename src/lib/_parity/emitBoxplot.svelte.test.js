// @ts-nocheck
/**
 * The Boxplot in the Python export: the APP's side.
 *
 * Loads real demo sessions (static/sessions/demos), changes saved settings where a case says
 * so (exactly the fields the app's controls write: points, violins, the box toggle, the
 * significance-bar method and look, a second series, series without categories, monochrome,
 * a user's category colour, box styling, x gridlines), mounts the real Boxplot component
 * (which mounts Box and Violin) and records what it DRAWS, in px from the plot area's top
 * left:
 *   - every box (series, centre, half widths, the y of each whisker end, quartile and median,
 *     the outlier rings, fill, stroke, widths, dashes, median colour);
 *   - every jittered point (centre, radius, fill, fill opacity, stroke);
 *   - every violin outline (all its vertices), fill, opacity and stroke;
 *   - every significance bracket (its three lines, the label, its size, colour and place),
 *     and the pairwise statistics behind it (Boxplotclass.sigTableResult);
 *   - the legend's entries and swatches, the category ticks and x gridlines, the domains;
 *   - the colours the export carries for each series (exportSeriesColours).
 *
 * tools/test_plot_boxplot.py renders the same plots through the Python runtime and checks
 * the exported figure draws exactly these. The fixture is COMMITTED
 * (tools/parity/boxplot_app.json) so the Python suite runs on its own; this test fails when
 * the app no longer draws it (regenerate with the command below and commit the result).
 *
 *   GEN_BOXPLOT=1 pnpm vitest run src/lib/_parity/emitBoxplot.svelte.test.js
 */
import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { core, appConsts, appState, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { exportColumnLabels } from '$lib/core/columnLabels.js';
import { exportSeriesColours } from '$lib/core/exportSeriesColours.js';
import { pinAllSeriesAppearance } from '$lib/plots/appearanceIdentity.js';
import { applyFigureAppearance } from '$lib/plots/seriesAppearance.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';
import { resolveStyle } from '$lib/plots/figureStyle.js';

const ROOT = process.cwd();
const DEMOS = join(ROOT, 'static', 'sessions', 'demos');
const OUT = join(ROOT, 'tools', 'parity', 'boxplot_app.json');
const GENERATE = process.env.GEN_BOXPLOT === '1';

// A worker that refuses every message, so the pool computes synchronously.
class SyncComputeWorker {
	postMessage() {
		throw new Error('force synchronous compute');
	}
	terminate() {}
}

/** A series' saved fields over a demo series (same x/y wrappers, new ids). */
const series = (base, fields) => ({ ...structuredClone(base), ...fields });

/**
 * Each case: a demo, the boxplot in it, and the saved settings to change (`edit(plotJSON)`
 * writes the same fields the app's controls write). `categoryColours` adds session category
 * colours (a user's pick); `appearance` runs "apply to all" (applyFigureAppearance), as
 * switching monochrome on does.
 */
const CASES = [
	{ name: 'byDay', demo: 'demo-boxplot-by-day', plot: 73 },
	{
		name: 'byDayPoints',
		demo: 'demo-boxplot-by-day',
		plot: 73,
		edit: (p) => {
			p.plot.showPoints = true;
			p.plot.pointJitter = 0.6;
			p.plot.pointSize = 2;
			p.plot.pointOpacity = 0.4;
			p.plot.xAxis.gridlines = true;
		}
	},
	{
		name: 'byDayMonochrome',
		demo: 'demo-boxplot-by-day',
		plot: 73,
		edit: (p) => {
			p.style = { ...p.style, monochrome: true };
			p.plot.showPoints = true;
		}
	},
	{ name: 'violinGroups', demo: 'demo-violinplot-groups', plot: 74 },
	{
		name: 'violinOnly',
		demo: 'demo-violinplot-groups',
		plot: 74,
		edit: (p) => {
			p.plot.showBox = false;
			p.plot.violinBandwidth = 3;
			p.plot.violinWidth = 0.6;
			p.plot.violinOpacity = 0.5;
			p.plot.pointColour = '#333333';
		}
	},
	{ name: 'anova', demo: 'demo-workflow-stats-anova', plot: 15 },
	{
		name: 'anovaKruskalStyled',
		demo: 'demo-workflow-stats-anova',
		plot: 15,
		edit: (p) => {
			p.plot.sigMethod = 'kruskal';
			p.plot.showNs = true;
			p.plot.sigBarColor = '#aa0000';
			p.plot.sigBarThickness = 2;
			p.plot.sigBarFontSize = 14;
			p.plot.sigBarSpacing = 1.5;
			p.plot.sigBarYOffset = -5;
			p.plot.xAxis.gridlines = true;
		}
	},
	{ name: 'twoGroup', demo: 'demo-workflow-stats-two-group', plot: 12 },
	{
		name: 'twoGroupMannWhitneyPinned',
		demo: 'demo-workflow-stats-two-group',
		plot: 12,
		categoryColours: { Treatment: { hex: '#ff8800' } },
		edit: (p) => {
			p.plot.sigMethod = 'kruskal';
			p.plot.showNs = true;
		}
	},
	{ name: 'groupComparison', demo: 'demo-tp-groupcomparison', plot: 123 },
	{ name: 'joinBySource', demo: 'demo-workflow-join-data', plot: 68 },
	{
		// Two series over the same categories: dodged boxes, series colours, a legend.
		name: 'joinTwoSeries',
		demo: 'demo-workflow-join-data',
		plot: 68,
		edit: (p) => {
			const d = p.plot.data[0];
			p.plot.data = [d, series(d, { y: { ...d.y, id: 9001, refId: 490 } })];
			p.plot.showPoints = true;
			p.plot.showViolin = true;
		}
	},
	{
		// Series with no category column: one box per series, named by its label; the
		// significance groups are the series.
		name: 'seriesNoCategories',
		demo: 'demo-workflow-join-data',
		plot: 68,
		edit: (p) => {
			const d = p.plot.data[0];
			const noX = { ...d.x, id: 9002, refId: -1 };
			p.plot.data = [
				series(d, { x: noX, y: { ...d.y, id: 9003, refId: 483 }, label: 'Control' }),
				series(d, { x: { ...noX, id: 9004 }, y: { ...d.y, id: 9005, refId: 486 }, label: '' })
			];
			p.plot.showSigBars = true;
			p.plot.showNs = true;
		}
	},
	{
		// The box's own styling on uncategorised series (series colours are not overridden).
		name: 'styledSeries',
		demo: 'demo-workflow-join-data',
		plot: 68,
		edit: (p) => {
			const d = p.plot.data[0];
			const noX = { ...d.x, id: 9006, refId: -1 };
			const box = {
				...d.boxPlot,
				colour: '#123456',
				fillColour: '#abcdef',
				strokeWidth: 1,
				stroke: '5, 5',
				boxWidth: 0.5,
				whiskerWidth: 1,
				medianColour: '#ff0000',
				medianWidth: 3,
				outlierMethod: 'zscore',
				zThreshold: 1.5,
				outlierSize: 5
			};
			p.plot.data = [
				series(d, { x: noX, y: { ...d.y, id: 9007, refId: 469 }, label: 'Joined', boxPlot: box }),
				series(d, {
					x: { ...noX, id: 9008 },
					y: { ...d.y, id: 9009, refId: 466 },
					label: 'Logger',
					boxPlot: { ...d.boxPlot, iqrMultiplier: 0.5, showOutliers: true }
				})
			];
			p.plot.legend.position = 'topleft';
		}
	},
	{
		name: 'twoSeriesMonochrome',
		demo: 'demo-workflow-join-data',
		plot: 68,
		appearance: true,
		edit: (p) => {
			const d = p.plot.data[0];
			p.plot.data = [d, series(d, { y: { ...d.y, id: 9010, refId: 490 } })];
			p.style = { ...p.style, monochrome: true };
			p.plot.showPoints = true;
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
	core.categoryColours = {};
	appState.displayTimezone = 'utc';
}

const R = (v) => (Number.isFinite(v) ? Math.round(v * 1e9) / 1e9 : null);
const n = (el, a) => R(Number(el.getAttribute(a)));
const attr = (el, a) => el.getAttribute(a);

/** One box's six marks (Box.svelte order) and the circles after them. */
function readBox(kids, k, seriesIndex) {
	const [lw, lc, rect, med, uw, uc] = kids.slice(k, k + 6);
	const x = n(rect, 'x');
	const w = n(rect, 'width');
	return {
		series: seriesIndex,
		cx: R(x + w / 2),
		halfWidth: R(w / 2),
		whiskerHalfWidth: R((n(lc, 'x2') - n(lc, 'x1')) / 2),
		yQ3: n(rect, 'y'),
		yQ1: R(n(rect, 'y') + n(rect, 'height')),
		yMedian: n(med, 'y1'),
		yLowerWhisker: n(lw, 'y1'),
		yUpperWhisker: n(uw, 'y2'),
		yLowerCap: n(lc, 'y1'),
		yUpperCap: n(uc, 'y1'),
		upperCapX: [n(uc, 'x1'), n(uc, 'x2')],
		fill: attr(rect, 'fill'),
		fillOpacity: attr(rect, 'fill-opacity'),
		stroke: attr(rect, 'stroke'),
		strokeWidth: n(rect, 'stroke-width'),
		dash: attr(rect, 'stroke-dasharray'),
		whiskerDash: attr(lw, 'stroke-dasharray'),
		capDash: attr(lc, 'stroke-dasharray'),
		capStroke: attr(lc, 'stroke'),
		medianStroke: attr(med, 'stroke'),
		medianWidth: n(med, 'stroke-width'),
		medianX: [n(med, 'x1'), n(med, 'x2')],
		outliers: []
	};
}

/** What one Box draws: its boxes (with outlier rings) and its points, in draw order. */
function readBoxGroup(g, seriesIndex) {
	const kids = [...g.children];
	const boxes = [];
	const points = [];
	let cur = null;
	for (let k = 0; k < kids.length; k++) {
		const el = kids[k];
		if (el.tagName === 'line' && kids[k + 2]?.tagName === 'rect') {
			cur = readBox(kids, k, seriesIndex);
			boxes.push(cur);
			k += 5;
			continue;
		}
		if (el.tagName !== 'circle') continue;
		if (attr(el, 'fill') === 'none') {
			cur.outliers.push({
				cx: n(el, 'cx'),
				cy: n(el, 'cy'),
				r: n(el, 'r'),
				stroke: attr(el, 'stroke'),
				strokeWidth: n(el, 'stroke-width')
			});
		} else {
			points.push({
				series: seriesIndex,
				cx: n(el, 'cx'),
				cy: n(el, 'cy'),
				r: n(el, 'r'),
				fill: attr(el, 'fill'),
				fillOpacity: n(el, 'fill-opacity'),
				stroke: attr(el, 'stroke'),
				strokeWidth: n(el, 'stroke-width')
			});
		}
	}
	return { boxes, points };
}

const seriesOfClip = (g) => Number(/url\(#\w+-(\d+)-/.exec(attr(g, 'clip-path'))[1]);

/** What the mounted Boxplot draws. */
function drawn(container, inner, style) {
	const svg = container.querySelector('svg');
	const pad = inner.padding;
	const boxes = [];
	const points = [];
	for (const g of svg.querySelectorAll('g[clip-path^="url(#boxplot-"]')) {
		const r = readBoxGroup(g, seriesOfClip(g));
		boxes.push(...r.boxes);
		points.push(...r.points);
	}
	const violins = [];
	for (const g of svg.querySelectorAll('g[clip-path^="url(#violin-"]')) {
		for (const poly of g.querySelectorAll('polygon')) {
			violins.push({
				series: seriesOfClip(g),
				points: attr(poly, 'points')
					.split(' ')
					.map((p) => p.split(',').map((v) => R(Number(v)))),
				fill: attr(poly, 'fill'),
				fillOpacity: n(poly, 'fill-opacity'),
				stroke: attr(poly, 'stroke'),
				strokeWidth: n(poly, 'stroke-width')
			});
		}
	}
	// Significance brackets: the svg's own <line>s, three per bracket, then its <text>s.
	const lines = [...svg.querySelectorAll(':scope > line')];
	const texts = [...svg.querySelectorAll(':scope > text')];
	const sigBars = [];
	for (let i = 0; i + 2 < lines.length; i += 3) {
		const [a, h, b] = lines.slice(i, i + 3);
		const t = texts[i / 3];
		sigBars.push({
			x1: R(n(h, 'x1') - pad.left),
			x2: R(n(h, 'x2') - pad.left),
			y: R(n(h, 'y1') - pad.top),
			tickBottom: R(n(a, 'y1') - pad.top),
			tickBottomRight: R(n(b, 'y2') - pad.top),
			stroke: attr(h, 'stroke'),
			strokeWidth: n(h, 'stroke-width'),
			label: t?.textContent.trim() ?? null,
			labelX: t ? R(n(t, 'x') - pad.left) : null,
			labelY: t ? R(n(t, 'y') - pad.top) : null,
			labelPx: t ? n(t, 'font-size') : null,
			labelFill: t ? attr(t, 'fill') : null,
			labelAnchor: t ? attr(t, 'text-anchor') : null
		});
	}
	const legend = [...svg.querySelectorAll('text[dy="0.35em"]')].map((t) => {
		const rect = t.parentElement.querySelector('rect');
		return {
			text: t.textContent.trim(),
			px: n(t, 'font-size'),
			swatch: rect
				? {
						fill: attr(rect, 'fill'),
						fillOpacity: attr(rect, 'fill-opacity'),
						stroke: attr(rect, 'stroke'),
						strokeWidth: n(rect, 'stroke-width'),
						width: n(rect, 'width'),
						height: n(rect, 'height')
					}
				: null
		};
	});
	const bottom = svg.querySelector('g.axis-bottom');
	const ticks = [...(bottom?.querySelectorAll('g.tick') ?? [])].map((t) => ({
		value: R(Number(t.__data__)),
		label: t.querySelector('text')?.textContent ?? '',
		grid: !!t.querySelector('line.gridline')
	}));
	const sigTable = inner.sigTableResult.pairs.map((p) => ({
		groupA: p.groupA,
		groupB: p.groupB,
		pValue: p.pValue,
		pAdjusted: p.pAdjusted,
		significant: p.significant
	}));
	return {
		plotSize: [R(inner.plotwidth), R(inner.plotheight)],
		padding: { ...pad },
		categories: inner.uniqueXValues.map(String),
		xDomain: inner.overlayXScale.domain().map(R),
		yDomain: inner.overlayYScale.domain().map(R),
		categoryColoured: inner.categoryColoured,
		sigBarPx: resolveStyle(style).sizes.sigBar,
		boxes,
		points,
		violins,
		sigBars,
		sigTable,
		sigLevels: inner.sigBarLevels.map((e) => ({ i: e.i, j: e.j, level: e.level })),
		legend,
		ticks
	};
}

async function runCase(c) {
	resetCore();
	const session = JSON.parse(readFileSync(join(DEMOS, c.demo + '.json'), 'utf8'));
	const plotJSON = structuredClone(session.plots.find((p) => p.id === c.plot));
	c.edit?.(plotJSON);
	core.storedValues = session.storedValues ?? {};
	core.groups = session.groups ?? [];
	core.categoryColours = { ...(session.categoryColours ?? {}), ...(c.categoryColours ?? {}) };
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
	// As the app shell does: every wired column pinned to its palette slot.
	pinAllSeriesAppearance(core.plots);
	if (c.appearance) applyFigureAppearance(live);
	const Comp = appConsts.plotMap.get(live.type).plot;
	const { container } = render(Comp, { props: { theData: live, which: 'plot' } });
	for (let i = 0; i < 6; i++) {
		flushSync();
		await tick();
	}
	const expected = drawn(container, live.plot, live.style);
	// What the export carries: the plot as saved now, with the colours the app resolved
	// (pythonExport.js adds `seriesColours` to each plot the same way).
	const saved = JSON.parse(JSON.stringify(live));
	const colours = exportSeriesColours([live])[live.id];
	if (colours) saved.seriesColours = colours;
	const columnLabels = exportColumnLabels();
	cleanup();
	return { name: c.name, demo: c.demo, plotId: c.plot, plotJSON: saved, columnLabels, expected };
}

describe('Python export Boxplot: what the app draws', () => {
	it('records the boxes, points, violins, brackets and legend of every case', async () => {
		appConsts.processMap = await loadProcesses();
		appConsts.plotMap = await loadPlots();
		appConsts.tableProcessMap = await loadTableProcesses();
		setWorkerFactory(() => new SyncComputeWorker());
		const cases = [];
		for (const c of CASES) cases.push(await runCase(c));
		const byName = Object.fromEntries(cases.map((c) => [c.name, c]));
		// Every case drew boxes or violins (a case that silently drew nothing pins nothing),
		// and the features each case is about were drawn.
		for (const c of cases) {
			const e = c.expected;
			expect(e.boxes.length + e.violins.length, c.name).toBeGreaterThan(0);
		}
		for (const name of [
			'anova',
			'twoGroup',
			'groupComparison',
			'joinBySource',
			'seriesNoCategories'
		]) {
			expect(byName[name].expected.sigBars.length, name).toBeGreaterThan(0);
		}
		expect(byName.anovaKruskalStyled.expected.sigBars.some((b) => b.label === 'ns')).toBe(true);
		expect(byName.violinGroups.expected.violins.length).toBeGreaterThan(0);
		expect(byName.violinOnly.expected.boxes).toEqual([]);
		expect(byName.byDayPoints.expected.points.length).toBeGreaterThan(0);
		expect(byName.joinTwoSeries.expected.legend.length).toBe(2);
		expect(byName.styledSeries.expected.boxes.some((b) => b.outliers.length > 0)).toBe(true);
		const fixture = { generatedBy: 'src/lib/_parity/emitBoxplot.svelte.test.js', cases };
		const text = JSON.stringify(fixture);
		if (GENERATE) {
			writeFileSync(OUT, text, 'utf8');
			// Formatted as the repo's prettier formats it, so `pnpm lint` stays clean.
			execFileSync(join(ROOT, 'node_modules', '.bin', 'prettier'), ['--write', OUT]);
		} else {
			expect(existsSync(OUT), `${OUT} is missing: regenerate it (see the header)`).toBe(true);
			expect(JSON.parse(readFileSync(OUT, 'utf8'))).toEqual(JSON.parse(text));
		}
	}, 180000);
});
