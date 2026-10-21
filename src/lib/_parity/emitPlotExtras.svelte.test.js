// @ts-nocheck
/**
 * The Python export's remaining plot features: the APP's side.
 *
 * Loads real demo sessions (static/sessions/demos), changes a saved setting where a case says
 * so (exactly the fields the app's controls write), mounts the real plot component and records
 * what it DRAWS for the features the export used to leave out:
 *
 *   - the FFT's phase: the phase curves (their data, colours and marks), the right-hand phase
 *     axis (its ticks, title and domain) and the legend's phase entries;
 *   - the 'auto' legend: the box the app sizes, the occupancy grid of the marks it avoids
 *     (run-length coded), the candidate it picks or its move outside on the right, the room an
 *     outside legend takes from the plot area and where the legend is drawn; a Colour by key
 *     placed after a legend (inside or outside);
 *   - the actogram's light-band bar, phase markers (dots and fitted lines, own blocks and
 *     marker rules), annotations, its legend, and the single-image (raster) mode;
 *   - the wavelet scalogram (CWT): the power field, its colour scale, the cone of influence,
 *     the ridge, the axes and the period overlays.
 *
 * tools/test_plot_extras_*.py render the same sessions through the Python runtime and check
 * the exported figure draws the same. The fixture is COMMITTED (tools/parity/plot_extras_app
 * .json) so the Python suites run on their own; this test fails when the app no longer draws
 * it (regenerate with the command below and commit the result).
 *
 *   GEN_PLOT_EXTRAS=1 pnpm vitest run src/lib/_parity/emitPlotExtras.svelte.test.js
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
import { loadPlots } from '$test/plotRegistry.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';
import { colormapRGB, normaliseTo01 } from '$lib/components/plotbits/colormaps.js';
import {
	downsampleColumns,
	scalogramImageRows,
	SCALOGRAM_MAX_COLUMNS
} from '$lib/plots/CWT/CWT.svelte';
import { rasterizeRows } from '$lib/plots/Actogram/actogramRaster.js';
import { plotByName, demoRefs } from './demoRefs.js';

const ROOT = process.cwd();
const DEMOS = join(ROOT, 'static', 'sessions', 'demos');
const OUT = join(ROOT, 'tools', 'parity', 'plot_extras_app.json');
const GENERATE = process.env.GEN_PLOT_EXTRAS === '1';

// A worker that refuses every message, so the pool computes synchronously.
class SyncComputeWorker {
	postMessage() {
		throw new Error('force synchronous compute');
	}
	terminate() {}
}

const legendOn = (p, position, extra = {}) => {
	p.plot.legend = { ...(p.plot.legend ?? {}), show: true, position, ...extra };
};

/**
 * Each case: a demo, the plot in it (by NAME, see demoRefs.js), the kind of record to take,
 * and the saved settings to change (`edit(plotJSON, ref)` writes the fields the app's controls
 * write).
 */
const CASES = [
	// ---- FFT phase ------------------------------------------------------------------------
	{
		name: 'fftPhasePeriod',
		kind: 'fft',
		demo: 'demo-fft-rhythm',
		plot: 'Signal FFT',
		edit: (p) => {
			p.plot.data[0].showPhase = true;
		}
	},
	{
		name: 'fftPhaseFrequency',
		kind: 'fft',
		demo: 'demo-fft-rhythm',
		plot: 'Signal FFT',
		edit: (p) => {
			p.plot.showPeriod = false;
			p.plot.xlimsIN = [null, null];
			p.plot.xAxis.label = 'Frequency (cycles/h)';
			p.plot.data[0].showPhase = true;
			p.plot.data[0].phaseLine = {
				...p.plot.data[0].phaseLine,
				colour: '#cc3300',
				strokeWidth: 1.5
			};
			p.plot.data[0].phasePoints = { ...p.plot.data[0].phasePoints, draw: false };
			p.plot.yAxisPhase = { ...p.plot.yAxisPhase, gridlines: true, nticks: 4 };
			legendOn(p, 'bottomleft');
		}
	},
	{
		name: 'fftPhaseManual',
		kind: 'fft',
		demo: 'demo-fft-rhythm',
		plot: 'Signal FFT',
		edit: (p) => {
			p.plot.data[0].showPhase = true;
			p.plot.data[0].phaseLine = { ...p.plot.data[0].phaseLine, draw: false };
			p.plot.data[0].phasePoints = { ...p.plot.data[0].phasePoints, shape: 'square', radius: 2 };
			p.plot.phaseYlimsIN = [-4, 4];
			p.plot.yAxisPhase = { ...p.plot.yAxisPhase, label: 'Phase (rad)' };
			legendOn(p, 'auto');
		}
	},

	// ---- Legend: 'auto' and outside -------------------------------------------------------
	{
		name: 'legendAutoScatter',
		kind: 'legend',
		demo: 'demo-scatter-rhythm',
		plot: 'Activity vs hour',
		edit: (p) => legendOn(p, 'auto')
	},
	{
		name: 'legendAutoScatterTwo',
		kind: 'legend',
		demo: 'demo-tp-cosinor',
		plot: 'Cosinor: data + fit',
		edit: (p) => legendOn(p, 'auto')
	},
	{
		name: 'legendOutsideScatter',
		kind: 'legend',
		demo: 'demo-tp-cosinor',
		plot: 'Cosinor: data + fit',
		edit: (p) => legendOn(p, 'outsideright')
	},
	{
		name: 'legendAutoScatterTime',
		kind: 'legend',
		demo: 'demo-workflow-colour-by-hysteresis',
		plot: 'Air and hive over time',
		edit: (p) => legendOn(p, 'auto')
	},
	{
		// Every inside spot covers data: the legend goes outside on the right.
		name: 'legendAutoScatterCrowded',
		kind: 'legend',
		demo: 'demo-workflow-colour-by-hysteresis',
		plot: 'Air and hive over time',
		edit: (p) => {
			legendOn(p, 'auto', { fontSize: 16, padding: 12 });
			p.plot.data.forEach((d) => {
				d.points = { ...(d.points ?? {}), draw: true, radius: 6 };
			});
		}
	},
	{
		name: 'legendColourKeyOutside',
		kind: 'legend',
		demo: 'demo-workflow-colour-by-hysteresis',
		plot: 'Hive against air, by hour and humidity',
		edit: (p) => legendOn(p, 'outsideright')
	},
	{
		name: 'legendColourKeyAuto',
		kind: 'legend',
		demo: 'demo-workflow-colour-by-hysteresis',
		plot: 'Hive against air, by hour and humidity',
		edit: (p) => legendOn(p, 'auto')
	},
	{
		// A legend and the colour bar in the same inside corner: the bar goes under it.
		name: 'legendColourKeyCorner',
		kind: 'legend',
		demo: 'demo-workflow-colour-by-hysteresis',
		plot: 'Hive against air, by hour and humidity',
		edit: (p) => {
			legendOn(p, 'topleft');
			p.plot.colourScale = { ...(p.plot.colourScale ?? {}), position: 'topleft' };
		}
	},
	{
		name: 'legendAutoPeriodogram',
		kind: 'legend',
		demo: 'demo-workflow-noise-peak',
		plot: 'Periodograms of pure noise',
		edit: (p) => legendOn(p, 'auto')
	},
	{
		name: 'legendOutsidePeriodogram',
		kind: 'legend',
		demo: 'demo-workflow-arrhythmic',
		plot: 'Periodogram: both records',
		edit: (p) => legendOn(p, 'outsideright', { orientation: 'vertical' })
	},
	{
		name: 'legendAutoFft',
		kind: 'legend',
		demo: 'demo-fft-rhythm',
		plot: 'Signal FFT',
		edit: (p) => {
			p.plot.data[0].showPhase = true;
			legendOn(p, 'auto');
		}
	},
	{
		name: 'legendOutsideFftPhase',
		kind: 'legend',
		demo: 'demo-fft-rhythm',
		plot: 'Signal FFT',
		edit: (p) => {
			p.plot.data[0].showPhase = true;
			legendOn(p, 'outsideright');
		}
	},
	{
		name: 'legendAutoCorrelogram',
		kind: 'legend',
		demo: 'demo-correlogram-rhythm',
		plot: 'Activity correlogram',
		edit: (p) => legendOn(p, 'auto')
	},
	{
		name: 'legendAutoBoxplot',
		kind: 'legend',
		demo: 'demo-tp-groupcomparison',
		plot: 'Compare groups (stats): groups',
		// A second series, so the legend names the series (one series is coloured per
		// category and has no legend entries).
		edit: (p) => {
			p.plot.data.push({ ...structuredClone(p.plot.data[0]), label: 'second look' });
			legendOn(p, 'auto');
		}
	},
	{
		name: 'legendAutoBoxplotTwo',
		kind: 'legend',
		demo: 'demo-workflow-stats-two-group',
		plot: 'Response by group',
		edit: (p) => {
			p.plot.data.push({ ...structuredClone(p.plot.data[0]), label: 'again' });
			legendOn(p, 'auto', { orientation: 'horizontal' });
		}
	},
	{
		name: 'legendOutsideBoxplot',
		kind: 'legend',
		demo: 'demo-workflow-stats-two-group',
		plot: 'Response by group',
		edit: (p) => {
			p.plot.data.push({ ...structuredClone(p.plot.data[0]), label: 'again' });
			legendOn(p, 'outsideright');
		}
	},
	{
		name: 'legendAutoActogram',
		kind: 'legend',
		demo: 'demo-workflow-arrhythmic',
		plot: 'Actogram: intact vs arrhythmic',
		edit: (p) => legendOn(p, 'auto')
	},
	{
		name: 'legendAutoActogramHeat',
		kind: 'legend',
		demo: 'demo-workflow-masking',
		plot: 'Actogram: truly entrained',
		edit: (p) => {
			p.plot.renderMode = 'heatmap';
			legendOn(p, 'auto');
		}
	},
	// ---- Actogram: light bands, phase markers, annotations, legend, raster ---------------
	{
		name: 'actogramBands',
		kind: 'actogram',
		demo: 'demo-workflow-masking',
		plot: 'Actogram: truly entrained',
		edit: (p) => {
			p.plot.lightBands = {
				bands: [
					{ col: '#000000', pc: 25 },
					{ col: '#ffffff', pc: 50 },
					{ col: '#000000', pc: 25 }
				]
			};
		}
	},
	{
		// Row labels widen the left padding; the bar starts where the rows do.
		name: 'actogramBandsRowLabels',
		kind: 'actogram',
		demo: 'demo-workflow-masking',
		plot: 'Actogram: truly entrained',
		edit: (p) => {
			p.plot.rowLabels = 'period';
			p.plot.doublePlot = 1;
			p.plot.lightBands = {
				bands: [
					{ col: '#ffffff', pc: 30 },
					{ col: '#202020', pc: 70 }
				]
			};
		}
	},
	{
		// An outside legend narrows the rows; the bar (double-plotted: one copy per period)
		// narrows with them. A taller bar than the default, saved with the plot.
		name: 'actogramBandsLegendOutside',
		kind: 'actogram',
		demo: 'demo-workflow-masking',
		plot: 'Actogram: truly entrained',
		edit: (p) => {
			p.plot.rowLabels = 'date';
			legendOn(p, 'outsideright');
			p.plot.lightBands = {
				height: 16,
				bands: [
					{ col: '#000000', pc: 25 },
					{ col: '#ffee88', pc: 50 },
					{ col: '#000000', pc: 25 }
				]
			};
		}
	},
	{
		name: 'actogramMarkers',
		kind: 'actogram',
		demo: 'demo-workflow-free-running',
		plot: 'Actogram (double-plotted)',
		edit: (p) => {
			p.plot.data[0].phaseMarkers = [
				{
					name: 'onsets',
					type: 'onset',
					colour: '#d62728',
					showLine: true,
					lineWidth: 2,
					markerSize: 4
				},
				{
					name: 'by hand',
					type: 'manual',
					colour: '#1f77b4',
					showLine: true,
					lineWidth: 1,
					markerSize: 3,
					manualMarkers: [20, 45.5, 69, 93.25, 118],
					lineMinDay: 2,
					lineMaxDay: 9
				},
				{
					name: 'fixed line',
					type: 'manual',
					colour: '#2ca02c',
					lockTau: 'fixed',
					lockTheta: 'fixed',
					fitSlope: 24.6,
					fitIntercept: 5,
					showLine: true,
					lineWidth: 1.5
				}
			];
			legendOn(p, 'auto');
		}
	},
	{
		name: 'actogramRules',
		kind: 'actogram',
		demo: 'demo-workflow-arrhythmic',
		plot: 'Actogram: intact vs arrhythmic',
		edit: (p) => {
			p.plot.markerRules = [
				{ id: 'r1', name: 'Onset', type: 'onset', colour: null, lineWidth: 2 },
				{
					id: 'r2',
					name: 'Offset',
					type: 'offset',
					colour: '#9467bd',
					showLine: false,
					markerSize: 3
				}
			];
			legendOn(p, 'topright');
		}
	},
	{
		name: 'actogramAnnotations',
		kind: 'actogram',
		demo: 'demo-workflow-masking',
		plot: 'Actogram: truly entrained',
		edit: (p, ref, session) => {
			const t0 = actogramStart(session, p);
			p.plot.annotations = [
				{ name: 'pulse', startMs: t0 + 30 * 3600000, duration: 3, colour: '#ff000080' },
				// Across the end of a period, into the next row.
				{ name: 'long', startMs: t0 + 70 * 3600000, duration: 6, colour: '#0000FF' },
				{ name: 'late', startMs: t0 + 260.5 * 3600000, duration: 1.5, colour: '#00aa00' }
			];
		}
	},
	{
		// More rows than the plot has pixels: every row drawn into one image.
		name: 'actogramRasterBars',
		kind: 'actogram',
		demo: 'demo-workflow-masking',
		plot: 'Actogram: truly entrained',
		edit: (p) => {
			p.plot.periodHrs = 1.5;
		}
	},
	{
		name: 'actogramRasterHeat',
		kind: 'actogram',
		demo: 'demo-workflow-masking',
		plot: 'Actogram: truly entrained',
		edit: (p) => {
			p.plot.periodHrs = 1.5;
			p.plot.renderMode = 'heatmap';
			p.plot.colormap = 'magma';
		}
	},
	// ---- Wavelet scalogram (CWT) ------------------------------------------------------------
	{ name: 'cwtDemo', kind: 'cwt', demo: 'demo-cwt-period-change', plot: 'Wavelet scalogram' },
	{
		name: 'cwtRidgeOverlays',
		kind: 'cwt',
		demo: 'demo-cwt-period-change',
		plot: 'Wavelet scalogram',
		edit: (p) => {
			p.plot.showRidge = true;
			p.plot.colormap = 'magma';
			p.plot.overlays = [
				{
					id: 0,
					name: 'Band 1',
					kind: 'band',
					form: 'horizontal',
					enabled: true,
					label: '',
					fill: '#ffffff40',
					edge: true,
					edgeColour: '#ffffff',
					edgeWidth: 1,
					channels: { lower: { columns: [], typed: [20] }, upper: { columns: [], typed: [28] } }
				},
				{
					id: 1,
					name: 'Line 1',
					kind: 'line',
					form: 'horizontal',
					enabled: true,
					label: '',
					colour: '#ff8800',
					strokeWidth: 2,
					stroke: '5, 5',
					channels: { at: { columns: [], typed: [12, 100] } }
				}
			];
		}
	},
	{
		// Linear period axis, raw (unrectified) power, the colour scale in a corner.
		name: 'cwtLinearRaw',
		kind: 'cwt',
		demo: 'demo-cwt-period-change',
		plot: 'Wavelet scalogram',
		edit: (p) => {
			p.plot.logScale = false;
			p.plot.rectify = false;
			p.plot.showCOI = false;
			p.plot.periodMin = 4;
			p.plot.periodMax = 30;
			p.plot.colourScale = { ...p.plot.colourScale, position: 'topright' };
		}
	},
	{
		name: 'cwtPaul',
		kind: 'cwt',
		demo: 'demo-cwt-period-change',
		plot: 'Wavelet scalogram',
		edit: (p) => {
			p.plot.wavelet = 'paul';
			p.plot.waveletParam = 4;
			p.plot.dj = 0.25;
		}
	},
	{
		name: 'cwtDog',
		kind: 'cwt',
		demo: 'demo-cwt-period-change',
		plot: 'Wavelet scalogram',
		edit: (p) => {
			p.plot.wavelet = 'dog';
			p.plot.waveletParam = 2;
			p.plot.colourScale = { ...p.plot.colourScale, show: false };
		}
	},
	{
		name: 'legendOutsideActogram',
		kind: 'legend',
		demo: 'demo-workflow-rest-activity',
		plot: 'Representative actograms',
		edit: (p) => legendOn(p, 'outsideright')
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

const num = (v) => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Number(v));
const round = (v) => (Number.isFinite(v) ? Math.round(v * 1e9) / 1e9 : null);
const roundAll = (a) => Array.from(a ?? [], (v) => round(num(v)));

/** Every axis the plot draws: its ticks (value, label, gridline) and its title. */
function drawnAxes(container) {
	const axes = {};
	for (const g of container.querySelectorAll('g[class^="axis-"]')) {
		const position = g.getAttribute('class').replace('axis-', '').split(' ')[0];
		axes[position] = {
			ticks: [...g.querySelectorAll('g.tick')].map((t) => ({
				value: round(num(t.__data__)),
				label: t.querySelector('text')?.textContent ?? '',
				grid: !!t.querySelector('line.gridline')
			})),
			label: g.querySelector('text.axis-label')?.textContent ?? ''
		};
	}
	return axes;
}

/** A 0/1 grid as run lengths, starting with a run of 0s. */
function rle(grid) {
	const out = [];
	let cur = 0;
	let n = 0;
	for (const v of grid) {
		if (v === cur) n++;
		else {
			out.push(n);
			cur = v;
			n = 1;
		}
	}
	out.push(n);
	return out;
}

/** The legend as the app lays it out (legendAuto.svelte.js) and draws it (Legend.svelte). */
function drawnLegend(container, inner) {
	const L = inner.legendLayout;
	const g = container.querySelector('g.plot-legend');
	const m = g ? /translate\(([-\d.e]+),\s*([-\d.e]+)\)/.exec(g.getAttribute('transform')) : null;
	const rect = g?.querySelector('rect');
	const occ = L?.occupancy;
	return {
		labels: (inner.getLegendItems ?? []).map((it) => it.label),
		items: (inner.getLegendItems ?? []).map((it) => ({
			label: it.label,
			elements: (it.elements ?? []).map((e) => ({ ...e }))
		})),
		fontPx: L?.fontPx ?? null,
		margin: L?.margin ?? null,
		box: L?.box ? { ...L.box } : null,
		area: L ? [round(L.areaW), round(L.areaH)] : null,
		occupancy: occ ? { cols: occ.cols, rows: occ.rows, cell: occ.cell, rle: rle(occ.grid) } : null,
		auto: L?.auto ? { ...L.auto } : null,
		outsidePosition: L?.outsidePosition ? { ...L.outsidePosition } : null,
		reserveW: L?.reserveW ?? 0,
		drawn: g
			? {
					x: round(Number(m[1])),
					y: round(Number(m[2])),
					width: round(Number(rect.getAttribute('width'))),
					height: round(Number(rect.getAttribute('height')))
				}
			: null
	};
}

/** Where a scatterplot's Colour by / Size by keys go (EncodingKeyLayout), with the legend. */
function drawnKeys(inner) {
	const keys = inner.encodingKeys;
	if (!keys) return null;
	return {
		reserveW: keys.reserveW,
		legendPlaced: keys.legendPlaced ? { ...keys.legendPlaced } : null,
		colour: keys.placement ? { ...keys.placement } : null,
		size: keys.sizePlacement ? { ...keys.sizePlacement } : null
	};
}

/** The FFT's phase: what each series' phase curve draws with, and the phase axis's domain. */
function drawnFft(inner) {
	return {
		phaseDomain: roundAll(inner.phaseYlims),
		series: inner.data.map((d) => {
			const f = d.fftData?.frequencies ?? [];
			const keep = (_, i) => !inner.showPeriod || f[i] > 0;
			return {
				showPhase: !!d.showPhase,
				x: roundAll(inner.showPeriod ? f.filter((v) => v > 0).map((v) => 1 / v) : f),
				phase: roundAll((d.fftData?.phases ?? []).filter(keep)),
				phaseLine: {
					colour: d.phaseLine.colour,
					strokeWidth: d.phaseLine.strokeWidth,
					stroke: d.phaseLine.stroke,
					draw: d.phaseLine.draw
				},
				phasePoints: {
					colour: d.phasePoints.colour,
					radius: d.phasePoints.radius,
					shape: d.phasePoints.shape,
					draw: d.phasePoints.draw
				}
			};
		})
	};
}

/** The actogram's first row start (ms), as the app picks it, before the plot is mounted. */
function actogramStart(session, p) {
	const xs = (p.plot.data ?? []).map((d) => session.data.find((c) => c.id === d.x.refId));
	let t0 = Infinity;
	for (const col of xs) {
		const raw = session.rawData[String(col?.data)] ?? [];
		for (const v of raw) if (v != null && Number(v) < t0) t0 = Number(v);
	}
	const d = new Date(t0);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const attrs = (el, names) =>
	Object.fromEntries(
		names.map((n) => {
			const v = el.getAttribute(n);
			const x = Number(v);
			return [n, v != null && v !== '' && Number.isFinite(x) ? round(x) : v];
		})
	);

/** A translate(x, y) transform's numbers (or x px, y px). */
function translateOf(t) {
	const m = /translate\(\s*([-\d.e]+)(?:px)?[,\s]+([-\d.e]+)(?:px)?\s*\)/.exec(t ?? '');
	return m ? [round(Number(m[1])), round(Number(m[2]))] : [0, 0];
}

/** The actogram's extras as drawn: light-band bar, markers and lines, annotations, raster. */
function drawnActogram(container, inner) {
	const bandG = container.querySelector('g.actogram');
	const bands = bandG
		? {
				translate: translateOf(bandG.getAttribute('style')),
				rects: [...bandG.querySelectorAll('rect')].map((r) =>
					attrs(r, ['x', 'y', 'width', 'height', 'fill', 'stroke', 'stroke-width'])
				)
			}
		: null;
	// The marker layer: one clipped <g> per series, holding its blocks' lines and dot paths.
	const clipped = [...container.querySelectorAll('g[clip-path^="url(#actogram-clip-"]')];
	const markers = clipped.map((g) => ({
		lines: [...g.querySelectorAll('line')]
			.filter((l) => !l.classList.contains('line-handle'))
			.map((l) => attrs(l, ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width'])),
		dots: [...g.querySelectorAll('path')].map((pth) => {
			const d = pth.getAttribute('d') ?? '';
			const centres = [...d.matchAll(/M([-\d.e]+) ([-\d.e]+) m-([\d.e]+) 0/g)].map((m) => [
				round(Number(m[1])),
				round(Number(m[2])),
				round(Number(m[3]))
			]);
			return { fill: pth.getAttribute('fill'), centres };
		})
	}));
	const annotations = [...container.querySelectorAll('g.annotations')].map((g) => ({
		translate: translateOf(g.getAttribute('transform')),
		points: g.querySelector('polyline')?.getAttribute('points') ?? '',
		fill: g.querySelector('polyline')?.getAttribute('fill') ?? null
	}));
	const out = {
		Ndays: inner.Ndays,
		startTime: inner.startTime,
		eachplotheight: round(inner.eachplotheight),
		rowGap: round(inner.rowGap),
		rasterRows: !!inner.rasterRows,
		bands,
		markers,
		annotations
	};
	if (inner.rasterRows) {
		// What the image holds (jsdom has no canvas to encode it): the coverage the app's
		// rasterizeRows gives each pixel at 1 device px per CSS px, summed over 8 x 8 px tiles,
		// with each tile's cover-weighted mean colour for a heatmap.
		const N = inner.Ndays;
		const W = Math.round(inner.plotwidth);
		const H = Math.round(N * (inner.eachplotheight + inner.rowGap));
		const heat = inner.renderMode === 'heatmap';
		out.raster = inner.data.map((datum, d) => {
			const dom = inner.intensityDomain[d] ?? [0, 1];
			const lims = inner.ylims[d] ?? [];
			const r = rasterizeRows({
				nRows: N,
				widthPx: W,
				heightPx: H,
				span: inner.periodHrs * inner.doublePlot,
				rowH: inner.eachplotheight,
				gap: inner.rowGap,
				mode: heat ? 'heatmap' : 'bars',
				rowBins: (day) => {
					const xStart = [];
					const xEnd = [];
					const y = [];
					for (let q = day; q < day + inner.doublePlot; q++) {
						for (const bin of datum.binsByPeriod[q] ?? []) {
							xStart.push(bin.xStart - day * inner.periodHrs);
							xEnd.push(bin.xEnd - day * inner.periodHrs);
							y.push(bin.y);
						}
					}
					return { xStart, xEnd, y };
				},
				yFrac: (day, y) => {
					const [lo, hi] = lims[day] ?? [0, 1];
					return hi > lo ? (y - lo) / (hi - lo) : 0;
				},
				colour: (y) => {
					const m = /rgb\((\d+),\s*(\d+),\s*(\d+)/.exec(
						colormapRGB(inner.colormap, normaliseTo01(y, dom[0], dom[1]))
					);
					return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
				}
			});
			const T = 8;
			const tw = Math.ceil(W / T);
			const th = Math.ceil(H / T);
			const cover = new Array(tw * th).fill(0);
			const rgb = heat ? new Array(tw * th * 3).fill(0) : null;
			for (let yy = 0; yy < H; yy++) {
				for (let xx = 0; xx < W; xx++) {
					const k = yy * W + xx;
					const t = Math.floor(yy / T) * tw + Math.floor(xx / T);
					cover[t] += r.cover[k];
					if (rgb) for (let ch = 0; ch < 3; ch++) rgb[3 * t + ch] += r.rgb[3 * k + ch];
				}
			}
			return {
				W,
				H,
				tile: T,
				colour: datum.colour,
				cover: cover.map((v) => Math.round(v * 1e4) / 1e4),
				rgb: rgb
					? rgb.map((v, i) => Math.round((v / (cover[Math.floor(i / 3)] || 1)) * 100) / 100)
					: null
			};
		});
	}
	return out;
}

/** Points of an SVG polyline / polygon `points` attribute, as [x, y] pairs. */
const pointsOf = (el) =>
	(el?.getAttribute('points') ?? '')
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map((q) => q.split(',').map((v) => round(Number(v))));

/** The scalogram as computed and drawn (jsdom cannot encode its image, so the cells are
 *  computed from the plot's own transform with the component's own helpers). */
function drawnCwt(container, inner) {
	const tr = inner.transform;
	if (!tr.valid) return { valid: false, reason: tr.reason };
	const nS = tr.periods.length;
	const nT = tr.times.length;
	const rowStep = Math.max(1, Math.floor(nS / 9));
	const colStep = Math.max(1, Math.floor(nT / 24));
	const samples = [];
	for (let j = 0; j < nS; j += rowStep) {
		for (let i = 0; i < nT; i += colStep) samples.push([j, i, round(tr.power[j][i])]);
	}
	const img = downsampleColumns(tr.power, SCALOGRAM_MAX_COLUMNS);
	// The scale each image row shows, as the plot paints it: one row per scale on a log axis,
	// resampled onto a linear one.
	// resampled (two scales blended) onto a linear one.
	const rows = scalogramImageRows(tr.periods, inner.logScale);
	const nR = rows.j0.length;
	const imgRowStep = Math.max(1, Math.floor(nR / 9));
	const rgbAt = (j, i) =>
		colormapRGB(inner.colormap, normaliseTo01(img[j][i], 0, inner.powerMax))
			.match(/\d+/g)
			.map(Number);
	const cells = [];
	for (let row = 0; row < nR; row += imgRowStep) {
		const wt = rows.w[row];
		for (let i = 0; i < img[0].length; i += colStep) {
			const a = rgbAt(rows.j0[row], i);
			const b = rgbAt(rows.j1[row], i);
			const c = wt > 0 ? a.map((v, k) => Math.round(v + (b[k] - v) * wt)) : a;
			cells.push([row, i, `rgb(${c.join(', ')})`]);
		}
	}
	const g = [...container.querySelectorAll('svg > g')].find(
		(el) =>
			el.querySelector('polyline, rect[fill="none"]') && !el.classList.contains('colour-scale')
	);
	const coi = container.querySelector('polyline[stroke="#fff"]');
	const shade = container.querySelector('polygon');
	const ridge = container.querySelector('polyline[stroke="#ff3b30"]');
	const texts = [...container.querySelectorAll('text')].map((t) => ({
		text: t.textContent,
		x: t.getAttribute('x') != null ? round(Number(t.getAttribute('x'))) : null,
		y: t.getAttribute('y') != null ? round(Number(t.getAttribute('y'))) : null,
		transform: t.getAttribute('transform'),
		size: round(Number(t.getAttribute('font-size'))),
		cls: t.getAttribute('class')
	}));
	const key = container.querySelector('g.colour-scale');
	const dl = inner.getDownloadData();
	return {
		valid: true,
		download: {
			headers: dl.headers,
			n: dl.rows.length,
			head: dl.rows.slice(0, 3).map(roundAll),
			tail: dl.rows.slice(-3).map(roundAll),
			note: dl.note ?? null
		},
		periods: roundAll(tr.periods),
		nTimes: nT,
		t0: round(tr.times[0]),
		t1: round(tr.times[nT - 1]),
		dt: round(tr.dt),
		powerMax: round(inner.powerMax),
		powerSamples: samples,
		imageCells: cells,
		imageRows: {
			j0: Array.from(rows.j0),
			j1: Array.from(rows.j1),
			w: roundAll(Array.from(rows.w))
		},
		imageColumns: img[0].length,
		ridge: inner.showRidge ? roundAll(inner.ridge.ridgePeriod) : null,
		groupTranslate: g ? translateOf(g.getAttribute('transform')) : null,
		coi: coi ? pointsOf(coi) : null,
		coiShade: shade ? pointsOf(shade) : null,
		ridgeLine: ridge ? pointsOf(ridge) : null,
		texts,
		overlayLines: [...container.querySelectorAll('line.overlay-rule')].map((l) =>
			attrs(l, ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'stroke-dasharray'])
		),
		overlayBands: [...container.querySelectorAll('rect.band-rect')].map((r) =>
			attrs(r, ['x', 'y', 'width', 'height', 'fill'])
		),
		bandEdges: [...container.querySelectorAll('.band-edge')].map((l) =>
			attrs(l, ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width'])
		),
		key: key
			? {
					translate: translateOf(key.getAttribute('transform')),
					bar: attrs(key.querySelector('rect[fill^="url("]'), ['x', 'y', 'width', 'height'])
				}
			: null
	};
}

function record(c, container, live) {
	const inner = live.plot;
	const out = {
		axes: drawnAxes(container),
		plotSize: [round(inner.plotwidth), round(inner.plotheight)],
		basePlotWidth: round(inner.basePlotWidth ?? inner.plotwidth),
		padding: { ...inner.padding },
		legend: inner.legendLayout ? drawnLegend(container, inner) : null
	};
	if (live.type === 'scatterplot') out.keys = drawnKeys(inner);
	if (c.kind === 'fft') out.fft = drawnFft(inner);
	if (live.type === 'actogram') out.actogram = drawnActogram(container, inner);
	if (live.type === 'cwt') out.cwt = drawnCwt(container, inner);
	return out;
}

async function runCase(c) {
	resetCore();
	const session = JSON.parse(readFileSync(join(DEMOS, c.demo + '.json'), 'utf8'));
	const plotJSON = structuredClone(plotByName(session, c.plot, c.demo));
	c.edit?.(plotJSON, demoRefs(session, c.demo), session);
	appState.displayTimezone = c.zone ?? 'utc';
	core.storedValues = session.storedValues ?? {};
	core.groups = session.groups ?? [];
	core.seriesAppearance = session.seriesAppearance ?? {};
	core.categoryColours = session.categoryColours ?? {};
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
	pinAllSeriesAppearance(core.plots);
	const Comp = appConsts.plotMap.get(live.type).plot;
	const { container } = render(Comp, { props: { theData: live, which: 'plot' } });
	const ready = () =>
		(live.plot.data ?? []).every(
			(d) =>
				(!('periodData' in d) || (d.periodData?.x?.length ?? 0) > 0) &&
				(!('fftData' in d) || (d.fftData?.frequencies?.length ?? 0) > 0)
		);
	for (let i = 0; i < 100 && !(i > 4 && ready()); i++) {
		flushSync();
		await tick();
		await new Promise((r) => setTimeout(r, 50));
	}
	flushSync();
	await tick();
	flushSync();
	const expected = record(c, container, live);
	// The plot as the app saves (and so exports) it once loaded: what the Python side reads.
	const savedJSON = JSON.parse(JSON.stringify(live));
	const columnLabels = exportColumnLabels();
	const seriesColours = exportSeriesColours([live])[live.id] ?? null;
	cleanup();
	return {
		name: c.name,
		kind: c.kind,
		demo: c.demo,
		zone: c.zone ?? 'utc',
		plotJSON: { ...savedJSON, ...(seriesColours ? { seriesColours } : {}) },
		columnLabels,
		expected
	};
}

describe('Python export plot extras: what the app draws', () => {
	it('records the phase, legend, actogram and scalogram of every case', async () => {
		appConsts.processMap = await loadProcesses();
		appConsts.plotMap = await loadPlots();
		appConsts.tableProcessMap = await loadTableProcesses();
		setWorkerFactory(() => new SyncComputeWorker());
		const cases = [];
		for (const c of CASES) cases.push(await runCase(c));
		// actogramRaster.js on fractional geometry (bins and rows that straddle pixels), so the
		// per-pixel area weighting is pinned exactly.
		const probeBins = (day) => ({
			xStart: [0.1 + day * 0.2, 0.9, 1.65],
			xEnd: [0.7 + day * 0.2, 1.4, 2.25],
			y: [3, day === 1 ? null : 7, 10]
		});
		const probe = (mode) => {
			const r = rasterizeRows({
				nRows: 3,
				widthPx: 7,
				heightPx: 5,
				span: 2.3,
				rowH: 1.3,
				gap: 0.35,
				mode,
				rowBins: probeBins,
				yFrac: (day, y) => y / 10 - day * 0.05,
				colour: (y) => [y * 20, 255 - y * 10, y * 3]
			});
			return {
				cover: Array.from(r.cover, (v) => round(v)),
				rgb: r.rgb ? Array.from(r.rgb, (v) => round(v)) : null
			};
		};
		const rasterProbe = { bars: probe('bars'), heatmap: probe('heatmap') };
		const fixture = {
			generatedBy: 'src/lib/_parity/emitPlotExtras.svelte.test.js',
			rasterProbe,
			cases
		};
		const text = JSON.stringify(fixture);
		if (GENERATE) {
			writeFileSync(OUT, text, 'utf8');
			execFileSync(join(ROOT, 'node_modules', '.bin', 'prettier'), ['--write', OUT]);
		} else {
			expect(existsSync(OUT), `${OUT} is missing: regenerate it (see the header)`).toBe(true);
			expect(JSON.parse(readFileSync(OUT, 'utf8'))).toEqual(JSON.parse(text));
		}
		// Every case drew what it is about (a case that silently drew nothing pins nothing).
		for (const c of cases) {
			if (c.kind !== 'cwt') expect(Object.keys(c.expected.axes).length, c.name).toBeGreaterThan(0);
			else expect(c.expected.cwt.valid, c.name).toBe(true);
			if (c.kind === 'legend') expect(c.expected.legend?.drawn, c.name).toBeTruthy();
		}
	}, 240000);
});
