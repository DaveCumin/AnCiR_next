// @ts-nocheck
/**
 * Colour by in the Python export (colour-by plan 2026-10-20, phase 1d): the APP's side.
 *
 * Builds real sessions in the app (real Column, Plot and Scatterplot classes, the appearance
 * map pinned as the app shell pins it), saves them with outputCoreAsJson() plus the two
 * export-only additions (columnLabels, seriesColours), and records what the app draws for
 * every series: the colour bucket and colour of every point, the coloured line's segments
 * (colouredLine.js, the 1c rule) and their colours, the colour bar (title, ticks, "no value"),
 * the legend swatches, and the colours a series with no saved colour resolves to. Also the
 * app's colormap stop tables and 64 bucket colours per map. Size by (phase 3) adds, per sized
 * series, every drawn point's exact radius and the order the points are drawn in (largest
 * layer first), and per plot the size key (entries, "no value", title, shape) and where the
 * two keys are placed (tools/test_plot_size_by.py).
 *
 * tools/test_plot_colour_by.py runs the same sessions through the Python runtime and checks
 * the exported figure draws exactly these colours. The fixture is COMMITTED
 * (tools/parity/colour_by_app.json) so the Python suite runs on its own; this test fails when
 * the app no longer produces it (regenerate with the command below and commit the result).
 *
 *   GEN_COLOUR_BY=1 pnpm vitest run src/lib/_parity/emitColourBy.svelte.test.js
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { flushSync } from 'svelte';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { core, appConsts, appState, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { loadPlots } from '$test/plotRegistry.js';
import { exportColumnLabels } from '$lib/core/columnLabels.js';
import { exportSeriesColours } from '$lib/core/exportSeriesColours.js';
import { pinAllSeriesAppearance } from '$lib/plots/appearanceIdentity.js';
import { COLORMAPS } from '$lib/components/plotbits/colormaps.js';
import { bucketColours, COLOUR_BUCKETS } from '$lib/components/plotbits/encodings.js';
import { colouredLineSegments, isValidXY } from '$lib/components/plotbits/colouredLine.js';
import { formatColourValue } from '$lib/components/plotbits/encodingHost.js';
import { markerPaths } from '$lib/components/plotbits/markerPaths.js';

/** Values the colour bar prints, through every formatting branch (JS number printing). */
const FORMAT_SAMPLES = [
	[0, 'value'],
	[4.75, 'value'],
	[-0.000012345, 'value'],
	[1234.5, 'value'],
	[0.1 + 0.2, 'value'],
	[2.675, 'value'],
	[1.005, 'value'],
	[123456789, 'value'],
	[1.234e21, 'value'],
	[9.9951, 'value'],
	[23.999, 'hourOfDay'],
	[6.5083, 'hourOfDay'],
	[72.5, 'dayOfYear'],
	[NaN, 'value']
];

const OUT = join(process.cwd(), 'tools', 'parity', 'colour_by_app.json');
const GENERATE = process.env.GEN_COLOUR_BY === '1';
const T0 = Date.UTC(2026, 2, 14, 18, 0, 0); // 14 March 2026, 18:00 UTC

function resetCore() {
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.notes = [];
	core.nodeNotes = {};
	core.storedValues = {};
	core.rawData = new Map();
	core.seriesAppearance = {};
	appState.displayTimezone = 'utc';
}

function col(values, type = 'number', name = 'c', extra = {}) {
	const c = new Column({ type, data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	Object.assign(c, extra);
	core.data.push(c);
	return c.id;
}

/**
 * A scatterplot from plain series; `colour` / `size` per series: { refId, ...encoding fields }.
 */
function scatter(
	name,
	series,
	{ legend = false, colourScale = null, sizeScale = null, style = null, size = null } = {}
) {
	const plot = new Plot({
		type: 'scatterplot',
		name,
		...(size ?? {}),
		plot: {
			data: series.map((s) => ({
				x: { refId: s.x },
				y: { refId: s.y },
				line: s.line ?? { draw: false },
				points: s.points ?? {}
			}))
		}
	});
	core.plots.push(plot);
	const p = core.plots[core.plots.length - 1];
	if (style) p.style = { ...p.style, ...style };
	series.forEach((s, i) => {
		if (!s.colour) return;
		const d = p.plot.data[i];
		d.enableColourBy();
		d.colourBy.refId = s.colour.refId;
		for (const [k, v] of Object.entries(s.colour)) {
			if (k !== 'refId') d.colourEncoding[k] = v;
		}
	});
	series.forEach((s, i) => {
		if (!s.size) return;
		const d = p.plot.data[i];
		d.enableSizeBy();
		d.sizeBy.refId = s.size.refId;
		for (const [k, v] of Object.entries(s.size)) {
			if (k !== 'refId') d.sizeEncoding[k] = v;
		}
	});
	p.plot.legend.show = legend;
	if (colourScale) Object.assign(p.plot.colourScale, colourScale);
	if (sizeScale) Object.assign(p.plot.sizeScale, sizeScale);
	return p;
}

/** What the app draws for one plot. */
function drawnByApp(p) {
	const inner = p.plot;
	const series = inner.data.map((d) => {
		const xs = d.xData;
		const ys = d.yData;
		const n = Math.min(xs.length, ys.length);
		const active = d.colourActive;
		const idx = active ? [...d.colourIdx] : null;
		const palette = active ? d.colourPalette : null;
		const bucketOf = (i) => (idx && i < idx.length ? idx[i] : -1);
		const pointColours = [];
		for (let i = 0; i < n; i++) {
			if (!d.points.draw || !isValidXY(xs[i], ys[i])) pointColours.push(null);
			else if (active && bucketOf(i) >= 0) pointColours.push(palette[bucketOf(i)]);
			else pointColours.push(d.points.colour);
		}
		let segments = [];
		const nValid = Array.from({ length: n }, (_, i) => isValidXY(xs[i], ys[i])).filter(
			Boolean
		).length;
		if (active && d.colourEncoding.colourLine && d.line.draw && nValid >= 2) {
			const { groups } = colouredLineSegments(xs, ys, idx, {
				K: COLOUR_BUCKETS,
				joinGaps: d.line.joinGaps
			});
			groups.forEach((g, gi) => {
				for (let k = 0; k < g.length; k += 2) {
					segments.push([g[k], g[k + 1], gi === 0 ? d.line.colour : palette[gi - 1]]);
				}
			});
		}
		// Size by: each drawn point's radius, and the order the app draws the points in (the
		// marker builder's own grouping, read back from centres placed at x = row).
		let size = null;
		if (d.sizeActive) {
			const rows = [];
			for (let i = 0; i < n; i++) if (d.points.draw && isValidXY(xs[i], ys[i])) rows.push(i);
			const sb = d.sizeRender;
			const drawOrder = sb
				? markerPaths(
						rows,
						rows.map(() => 0),
						{
							shape: 'circle',
							radius: d.points.radius,
							colour: 'k',
							colourBy: d.colourRender,
							sizeBy: sb,
							marks: rows
						}
					).flatMap((path) => [...path.d.matchAll(/M(\d+) 0m/g)].map((m) => Number(m[1])))
				: [];
			const radii = Array.from({ length: n }, () => null);
			for (const r of rows) radii[r] = r < sb.r.length ? sb.r[r] : d.points.radius;
			size = {
				mode: d.sizeMode,
				domain: d.sizeDomain,
				range: d.sizeRadiusRange,
				title: d.sizeTitle,
				radii,
				drawOrder
			};
		}
		return {
			resolved: { line: d.line.colour, points: d.points.colour },
			size,
			active,
			mode: d.colourMode,
			colormap: active ? d.colourMap : null,
			domain: active ? d.colourDomain : null,
			title: active ? d.colourTitle : null,
			idx,
			pointColours,
			segments,
			legend: d.getLegendItem()
		};
	});
	const key = inner.colourKey;
	const sizeKey = inner.sizeKey;
	const keys = inner.encodingKeys;
	return {
		id: p.id,
		series,
		sizeKey: sizeKey
			? {
					series: inner.data.indexOf(sizeKey.series),
					title: sizeKey.title,
					shape: sizeKey.shape,
					items: sizeKey.items,
					noValue: sizeKey.noValue
				}
			: null,
		// Where the keys go, px from the plot area's top left (EncodingKeyLayout), at the
		// app's default figure size.
		keyLayout: {
			plotArea: { w: inner.plotwidth, h: inner.plotheight },
			colour: keys.placement,
			size: keys.sizePlacement,
			sizeGeometry: keys.sizeBase,
			// Side by side (a column of both would squeeze the bar), and what the placed bar
			// shows: its tick labels thinned to its length, its title shortened to it (v82.45).
			sizeBeside: keys.sizeBeside,
			shown: keys.shown
		},
		key: key
			? {
					series: inner.data.indexOf(key.series),
					colormap: key.colormap,
					domain: key.domain,
					title: key.title,
					ticks: key.ticks,
					noValue: key.noValue
				}
			: null
	};
}

function snapshot(name, zone) {
	flushSync();
	// The app shell pins every wired column's appearance in one effect; the export sees that.
	pinAllSeriesAppearance(core.plots);
	flushSync();
	const saved = JSON.parse(outputCoreAsJson());
	return {
		name,
		session: {
			rawData: saved.rawData,
			data: saved.data,
			plots: saved.plots,
			appState: { displayTimezone: zone },
			columnLabels: exportColumnLabels(),
			seriesColours: exportSeriesColours()
		},
		expected: core.plots.map(drawnByApp)
	};
}

// ---- the cases -------------------------------------------------------------------------

const CASES = {
	/** Value mode; missing and text colour cells; coloured line with a y gap; a second series
	 *  on the same column (shared range) with a plain line that joins its gap. */
	valueLines() {
		const x = col([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 'number', 'x');
		const y = col([1, 3, 2, 5, 4, null, 6, 8, 7, 9, 8, 10], 'number', 'temp');
		const y2 = col([2, 1, 3, 2, 4, 3, null, 4, 5, 4, 6, 5], 'number', 'humidity');
		const c = col([0, 1, 2, null, 'abc', 5, 6, 7.5, 8, 9, 10.25, 30], 'number', 'outside');
		scatter(
			'value',
			[
				{
					x,
					y,
					line: { draw: true, strokeWidth: 2 },
					points: { radius: 3 },
					colour: { refId: c, colourLine: true }
				},
				{
					x,
					y: y2,
					line: { draw: true, joinGaps: true, stroke: '5 3' },
					points: { shape: 'square' },
					colour: { refId: c }
				}
			],
			{ legend: true }
		);
	},
	/** Hour of day of a time column in a half-hour zone, across midnight; a manual range on a
	 *  cyclic mode is ignored. The coloured line joins its gaps. */
	hourOfDayZone() {
		const n = 60;
		const t = Array.from({ length: n }, (_, i) => T0 + i * 30 * 60000);
		t[10] = null;
		const x = col(t, 'time', 'time');
		const y = col(
			t.map((_, i) => Math.round(Math.sin(i / 6) * 1000) / 100),
			'number',
			'inside'
		);
		scatter('hour', [
			{
				x,
				y,
				line: { draw: true, joinGaps: true },
				colour: { refId: x, domainMin: 3, colourLine: true }
			}
		]);
		return 'Asia/Kolkata';
	},
	/** A coloured line with no points (the bar names its "no value" segments in the saved
	 *  line colour); the colour column is shorter than the series. */
	lineOnly() {
		const x = col([0, 1, 2, 3, 4, 5, 6, 7], 'number', 'x');
		const y = col([3, 1, 4, 1, 5, 9, 2, 6], 'number', 'y');
		const c = col([null, 2, 4, 6, 8, 10], 'number', 'light');
		scatter('line only', [
			{
				x,
				y,
				line: { draw: true, colour: '#aa3311', strokeWidth: 4 },
				points: { draw: false },
				// No colourLine set: switching Colour by on with the points hidden colours the
				// line (Scatterplot enableColourBy), and that is saved.
				colour: { refId: c }
			}
		]);
	},
	/** Manual range (clamping, the ends marked), magma, the bar in a corner; a second series on
	 *  another column has its own range (the bar shows the first). */
	manualRange() {
		const x = col([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'number', 'x');
		const y = col([5, 4, 6, 3, 7, 2, 8, 1, 9, 0], 'number', 'y');
		const c = col([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'number', 'dose');
		const c2 = col([100, 90, 80, 70, 60, 50, 40, 30, 20, 10], 'number', 'other');
		scatter(
			'manual',
			[
				{ x, y, colour: { refId: c, colormap: 'magma', domainMin: 2, domainMax: 7.5 } },
				{ x, y: c, colour: { refId: c2 } }
			],
			{ colourScale: { position: 'topleft' } }
		);
	},
	/** Monochrome: a sequential map draws in greys, a cyclic one in cyclic greys. */
	monochrome() {
		const t = Array.from({ length: 30 }, (_, i) => T0 + i * 3600000);
		const x = col(t, 'time', 'time');
		const y = col(
			t.map((_, i) => i % 7),
			'number',
			'y'
		);
		const c = col(
			t.map((_, i) => i * i),
			'number',
			'square'
		);
		scatter(
			'mono',
			[
				{ x, y, colour: { refId: c, colormap: 'magma' } },
				{ x, y: c, colour: { refId: x }, line: { draw: true }, points: { draw: true } }
			],
			{ style: { monochrome: true } }
		);
	},
	/** Facets: the panels share one range over every coloured series of the mode. */
	facets() {
		const x = col([0, 1, 2, 3], 'number', 'x');
		const ya = col([1, 2, 3, 4], 'number', 'a');
		const yb = col([4, 3, 2, 1], 'number', 'b');
		const ca = col([0, 1, 2, 3], 'number', 'ca');
		const cb = col([10, 20, 30, 40], 'number', 'cb');
		const p = scatter('facet', [
			{ x, y: ya, colour: { refId: ca } },
			{ x, y: yb, colour: { refId: cb } }
		]);
		p.facet = true;
	},
	/** The other modes: hour of day of hours from a time origin, day of year, days since
	 *  start, and hour of day of a number column with no clock (wrapped, with its title). */
	modes() {
		const hrs = Array.from({ length: 40 }, (_, i) => i * 1.5);
		const x = col(hrs, 'number', 'hours');
		const y = col(
			hrs.map((h) => Math.round(Math.cos(h / 4) * 100) / 10),
			'number',
			'y'
		);
		const withOrigin = col(hrs, 'number', 'clock hours', { originTime_ms: T0 });
		const days = Array.from({ length: 40 }, (_, i) => T0 + i * 0.8 * 86400000);
		const dates = col(days, 'time', 'date');
		const plain = col(hrs, 'number', 'elapsed');
		scatter('hour from origin', [{ x, y, colour: { refId: withOrigin, mode: 'hourOfDay' } }]);
		scatter('day of year', [{ x, y, colour: { refId: dates, mode: 'dayOfYear' } }]);
		scatter('days since start', [{ x, y, colour: { refId: dates, mode: 'daysSinceStart' } }]);
		scatter('wrapped', [{ x, y, colour: { refId: plain, mode: 'hourOfDay' } }]);
		return 'America/New_York';
	},
	// ---- Size by (phase 3) ----
	/** Size and colour together: missing values on both channels, the colour bar and the
	 *  size key stacked beside the plot, square markers, the legend on. */
	sizeAndColour() {
		const x = col([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'number', 'x');
		const y = col([3, 1, 4, 1, 5, 9, 2, 6, 5, 3], 'number', 'hive');
		const c = col([0, 1, 2, null, 4, 5, 6, 7, 8, 9], 'number', 'outside');
		const h = col([40, 55, null, 70, 'n/a', 90, 62, 48, 81, 75], 'number', 'humidity');
		scatter(
			'size and colour',
			[
				{
					x,
					y,
					line: { draw: true, strokeWidth: 1 },
					points: { shape: 'square', radius: 3 },
					colour: { refId: c },
					size: { refId: h }
				}
			],
			{ legend: true }
		);
	},
	/** Size only: a manual range clamping, a custom size range, the key in a corner over the
	 *  data (its backdrop), triangles; a second series on another column (the key shows the
	 *  first). */
	sizeManual() {
		const x = col([0, 1, 2, 3, 4, 5, 6, 7], 'number', 'x');
		const y = col([2, 4, 3, 5, 4, 6, 5, 7], 'number', 'y');
		const s1 = col([0, 10, 20, 30, 40, 50, 60, 70], 'number', 'count');
		const s2 = col([5, 4, 3, 2, 1, 0, 1, 2], 'number', 'other');
		scatter(
			'size manual',
			[
				{
					x,
					y,
					points: { shape: 'triangle' },
					size: { refId: s1, domainMin: 15, domainMax: 55, minRadius: 3, maxRadius: 14 }
				},
				{ x, y: s2, points: { shape: 'circle', radius: 2 }, size: { refId: s2 } }
			],
			{ sizeScale: { position: 'topleft' } }
		);
	},
	/** A time size column (days since start), both keys sharing the bottom right corner (the
	 *  bar shortens to leave the size key room), stars. */
	sizeTimeCorner() {
		const t = Array.from({ length: 24 }, (_, i) => T0 + i * 6 * 3600000);
		const x = col(t, 'time', 'time');
		const y = col(
			t.map((_, i) => Math.round(Math.cos(i / 3) * 100) / 10),
			'number',
			'inside'
		);
		scatter(
			'size time',
			[
				{
					x,
					y,
					points: { shape: 'star', radius: 5 },
					colour: { refId: x },
					size: { refId: x }
				}
			],
			{ colourScale: { position: 'bottomright' }, sizeScale: { position: 'bottomright' } }
		);
	},
	// ---- Small plots: the keys sharing a place (v82.45) ----
	/** Hour of day and a long size title beside a small plot: a column of both would squeeze
	 *  the bar under its title, so the size key goes beside the bar (both widths reserved). */
	sizeKeysBesideRight() {
		const t = Array.from({ length: 48 }, (_, i) => T0 + i * 3600000);
		const x = col(
			t.map((_, i) => 10 + 8 * Math.sin(i / 7.6)),
			'number',
			'air'
		);
		const y = col(
			t.map((_, i) => 22 + 3 * Math.sin(i / 7.6 - 0.6)),
			'number',
			'hive'
		);
		const time = col(t, 'time', 'time');
		const h = col(
			t.map((_, i) => 40 + i),
			'number',
			'Binned: relative humidity (%)'
		);
		scatter(
			'keys beside right',
			[{ x, y, line: { draw: true, strokeWidth: 2 }, colour: { refId: time }, size: { refId: h } }],
			{ size: { width: 400, height: 220 } }
		);
	},
	/** The same in a smaller plot's top right corner: the size key on the bar's left; the bar
	 *  short enough that its labels thin to 0, 12, 24 and its title is shortened. */
	sizeKeysBesideCorner() {
		const t = Array.from({ length: 48 }, (_, i) => T0 + i * 3600000);
		const x = col(
			t.map((_, i) => i),
			'number',
			'x'
		);
		const y = col(
			t.map((_, i) => Math.cos(i / 5)),
			'number',
			'y'
		);
		const time = col(t, 'time', 'time');
		const h = col(
			t.map((_, i) => i % 13),
			'number',
			'Binned: relative humidity (%)'
		);
		scatter('keys beside corner', [{ x, y, colour: { refId: time }, size: { refId: h } }], {
			size: { width: 360, height: 150 },
			colourScale: { position: 'topright' },
			sizeScale: { position: 'topright' }
		});
	},
	/** A short colour title: the column still fits, so the keys stack (the size key under the
	 *  bar), the bar shortened to the room left and its three labels thinned to the ends. */
	sizeKeysStackedThin() {
		const x = col([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'number', 'x');
		const y = col([3, 1, 4, 1, 5, 9, 2, 6, 5, 3], 'number', 'y');
		const c = col([10.5, 12, 14, 16, 18, 20, 22, 24, 25, 25.3], 'number', 'air');
		const h = col(
			[40, 45, 50, 55, 60, 65, 70, 75, 80, 98],
			'number',
			'Binned: relative humidity (%)'
		);
		scatter('keys stacked thin', [{ x, y, colour: { refId: c }, size: { refId: h } }], {
			size: { width: 420, height: 190 }
		});
	},
	/** Facets: the panels share one size range over every sized series of the mode. */
	sizeFacets() {
		const x = col([0, 1, 2, 3], 'number', 'x');
		const ya = col([1, 2, 3, 4], 'number', 'a');
		const yb = col([4, 3, 2, 1], 'number', 'b');
		const sa = col([0, 1, 2, 3], 'number', 'sa');
		const sb = col([10, 20, 30, 40], 'number', 'sb');
		const p = scatter('size facet', [
			{ x, y: ya, size: { refId: sa } },
			{ x, y: yb, size: { refId: sb } }
		]);
		p.facet = true;
	},
	/** Series with no saved colour: the app's colour is the column's pinned colour, not the
	 *  series' position (the second plot's only series is the first plot's second). */
	resolvedColours() {
		const x = col([0, 1, 2, 3, 4], 'number', 'x');
		const y1 = col([1, 2, 1, 2, 1], 'number', 'hive A');
		const y2 = col([2, 3, 2, 3, 2], 'number', 'hive B');
		scatter(
			'both hives',
			[
				{ x, y: y1, line: { draw: true } },
				{ x, y: y2, line: { draw: true, stroke: '2 2' }, points: { shape: 'triangle' } }
			],
			{ legend: true }
		);
		scatter('hive B alone', [{ x, y: y2, line: { draw: true } }], { legend: true });
	}
};

function buildFixture() {
	const cases = [];
	for (const [name, build] of Object.entries(CASES)) {
		resetCore();
		const zone = build() ?? 'utc';
		appState.displayTimezone = zone;
		cases.push(snapshot(name, zone));
	}
	resetCore();
	return {
		_comment:
			'Generated by src/lib/_parity/emitColourBy.svelte.test.js (GEN_COLOUR_BY=1); do not edit.',
		buckets: COLOUR_BUCKETS,
		colormaps: COLORMAPS,
		bucketColours: Object.fromEntries(Object.keys(COLORMAPS).map((m) => [m, bucketColours(m)])),
		formatSamples: FORMAT_SAMPLES.map(([v, mode]) => [
			Number.isFinite(v) ? v : null,
			mode,
			formatColourValue(v, mode)
		]),
		cases
	};
}

/** The parts the Python tests read, so unrelated plot settings do not count as drift. */
function essentials(fx) {
	return {
		buckets: fx.buckets,
		colormaps: fx.colormaps,
		bucketColours: fx.bucketColours,
		formatSamples: fx.formatSamples,
		cases: fx.cases.map((c) => ({
			name: c.name,
			rawData: c.session.rawData,
			series: c.session.plots.map((p) => p.plot.data),
			facet: c.session.plots.map((p) => p.facet),
			monochrome: c.session.plots.map((p) => p.style?.monochrome ?? false),
			colourScale: c.session.plots.map((p) => p.plot.colourScale ?? null),
			sizeScale: c.session.plots.map((p) => p.plot.sizeScale ?? null),
			appState: c.session.appState,
			seriesColours: c.session.seriesColours,
			expected: c.expected
		}))
	};
}

beforeAll(async () => {
	appConsts.plotMap = await loadPlots();
});

describe('colour by: the app side of the Python export fixture', () => {
	it.runIf(GENERATE)('writes tools/parity/colour_by_app.json', () => {
		const fx = buildFixture();
		// Written as the repo's prettier writes it, so `pnpm lint` stays clean after a regen.
		writeFileSync(OUT, JSON.stringify(fx));
		execFileSync(join(process.cwd(), 'node_modules', '.bin', 'prettier'), ['--write', OUT]);
	});

	it.skipIf(GENERATE)('the committed fixture is what the app draws today', () => {
		expect(existsSync(OUT), `missing ${OUT}: run GEN_COLOUR_BY=1`).toBe(true);
		const committed = JSON.parse(readFileSync(OUT, 'utf8'));
		const now = JSON.parse(JSON.stringify(buildFixture()));
		expect(
			essentials(now),
			'tools/parity/colour_by_app.json is stale: regenerate with GEN_COLOUR_BY=1 and commit'
		).toEqual(essentials(committed));
	});

	it('every case colours something, and the resolved-colour case differs from position', () => {
		const fx = buildFixture();
		for (const c of fx.cases.filter((k) => k.name !== 'resolvedColours')) {
			expect(
				c.expected.some((p) => p.series.some((s) => s.active || s.size)),
				c.name
			).toBe(true);
		}
		// The size cases size something, and their draw order covers every drawn point.
		for (const c of fx.cases.filter((k) => k.name.startsWith('size'))) {
			const sized = c.expected.flatMap((p) => p.series).filter((s) => s.size);
			expect(sized.length, c.name).toBeGreaterThan(0);
			for (const s of sized) {
				const drawn = s.size.radii.filter((r) => r != null).length;
				expect(s.size.drawOrder.length, c.name).toBe(drawn);
			}
		}
		const rc = fx.cases.find((k) => k.name === 'resolvedColours');
		const [both, alone] = rc.expected;
		// Hive B is the second series of plot 1 and the only one of plot 2: same colour, which
		// is not the palette's first entry (what a positional palette gives plot 2).
		expect(alone.series[0].resolved.line).toBe(both.series[1].resolved.line);
		expect(alone.series[0].resolved.line).not.toBe(appState.appColours[0]);
	});
});
