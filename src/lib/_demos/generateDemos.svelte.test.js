/**
 * Demo-session generator (NOT a normal test).
 *
 * Mints AnCiR-native example sessions using the real Column/Plot/TableProcess
 * classes and the same serialization the app uses (outputCoreAsJson), then
 * writes them to static/sessions/demos/ along with an index.json manifest. The
 * load-session modal fetches that manifest and lists the demos under "examples".
 *
 * Run it explicitly (it is gated so it never runs in the normal suite):
 *   GEN_DEMOS=1 npx vitest run src/lib/_demos/generateDemos.svelte.test.js
 *
 * Design notes
 * ------------
 * Each demo is meant to *show the node doing its job*, not just list numbers:
 *   - Plot demos render one plot on representative data.
 *   - Column-process demos render a before/after scatter so the effect is
 *     visible (input cloud vs processed cloud).
 *   - Analysis (table-process) demos AWAIT the analysis so its outputs are
 *     baked into the session. Curve-fitting analyses (Cosinor, Smooth, Bin,
 *     Trend, Double-logistic, Rectangular wave, Fit function) render the raw
 *     points plus the fitted curve as a line (the pattern users expect); the
 *     rest render a tableplot of real inputs + outputs, or a fitting-specific
 *     plot (boxplot for group comparison).
 *
 * Grouping/wording: families and descriptions come from the real node registry
 * (nodeMeta via processMap / tableProcessMap), so the gallery matches the
 * in-app palette (Arithmetic, Fitting, Analysis, Transform, …) and never uses
 * internal jargon like "table process".
 */
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, pushObj, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
// The per-node specs are shared with allNodesCoverage.test.js so the gallery
// covers exactly the registered nodes (one example session per process / TP).
import { PROCESS_SPECS, TP_SPECS, SAMPLE } from './nodeCatalog.js';

const OUT_DIR = join(process.cwd(), 'static', 'sessions', 'demos');

// Showcase palette: raw data in navy, derived/fitted curve in terracotta.
const RAW_COLOUR = '#234154';
const FIT_COLOUR = '#BE796B';

// Order the gallery the way the node palette is ordered (NodePalette.svelte).
const FAMILY_ORDER = [
	'Sources',
	'Arithmetic',
	'Filtering',
	'Smoothing',
	'Binning',
	'Fitting',
	'Analysis',
	'Transform',
	'Plots',
	'Other'
];
const familyRank = (f) => {
	const i = FAMILY_ORDER.indexOf(f);
	return i === -1 ? FAMILY_ORDER.length : i;
};

// --- synthetic data helpers (deterministic; no Math.random) -------------------
function mulberry32(seed) {
	return function () {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
// Box–Muller normal from a uniform generator
function normal(rng, mean = 0, sd = 1) {
	const u = Math.max(rng(), 1e-12);
	const v = rng();
	return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));

/**
 * A demo spec returns the list of plots to build given a `mk` toolkit:
 *   mk.col(name, type, values)  -> creates a Column with rawData, returns its id
 *   mk.plot(type, name, inputs) -> new Plot wired to the given {inputKey: colId}
 */
const DEMOS = [
	{
		id: 'scatter-rhythm',
		name: 'Scatter — activity vs hour',
		family: 'Plots',
		description:
			'A simple scatterplot of a noisy ~24 h rhythmic signal against hours since start (7 days, hourly).',
		build(mk) {
			const rng = mulberry32(1);
			const hours = Array.from({ length: 24 * 7 }, (_, i) => i);
			const activity = hours.map(
				(h) => 50 + 40 * Math.sin((2 * Math.PI * h) / 24 - Math.PI / 2) + normal(rng, 0, 6)
			);
			const xId = mk.col('hour', 'number', hours);
			const yId = mk.col('activity', 'number', activity);
			mk.plot('scatterplot', 'Activity vs hour', { x: xId, y: yId }, { x: 'Hour', y: 'Activity' });
		}
	},
	{
		id: 'histogram-normal',
		name: 'Histogram — distribution',
		family: 'Plots',
		description: 'Histogram of 500 samples drawn from a normal distribution (mean 100, sd 15).',
		build(mk) {
			const rng = mulberry32(2);
			const samples = Array.from({ length: 500 }, () => normal(rng, 100, 15));
			const cId = mk.col('measurement', 'number', samples);
			mk.plot(
				'histogram',
				'Measurement distribution',
				{ column: cId },
				{ x: 'Measurement', y: 'Count' }
			);
		}
	},
	{
		id: 'boxplot-by-day',
		name: 'Boxplot — activity by day',
		family: 'Plots',
		description:
			'Boxplot of daily activity values grouped by day index (7 days × 24 hourly points).',
		build(mk) {
			const rng = mulberry32(3);
			const day = [];
			const value = [];
			for (let d = 1; d <= 7; d++) {
				for (let h = 0; h < 24; h++) {
					day.push(d);
					value.push(50 + 40 * Math.sin((2 * Math.PI * h) / 24 - Math.PI / 2) + normal(rng, 0, 8));
				}
			}
			const xId = mk.col('day', 'number', day);
			const yId = mk.col('activity', 'number', value);
			mk.plot('boxplot', 'Activity by day', { x: xId, y: yId }, { x: 'Day', y: 'Activity' });
		}
	},
	{
		id: 'actogram-rhythm',
		name: 'Actogram — multi-day activity',
		family: 'Plots',
		description: 'Actogram of a noisy ~24 h rhythm over 7 days (hourly samples).',
		build(mk) {
			const rng = mulberry32(4);
			const hours = Array.from({ length: 24 * 7 }, (_, i) => i);
			const activity = hours.map((h) =>
				Math.max(0, 60 * Math.sin((2 * Math.PI * h) / 24 - Math.PI / 2) + normal(rng, 10, 8))
			);
			const t = mk.col('hour', 'number', hours);
			const v = mk.col('activity', 'number', activity);
			mk.plot('actogram', 'Activity actogram', { time: t, values: v });
		}
	},
	{
		id: 'periodogram-rhythm',
		name: 'Periodogram — period detection',
		family: 'Plots',
		description: 'Lomb–Scargle periodogram of a ~24 h rhythm (7 days, hourly).',
		build(mk) {
			const rng = mulberry32(5);
			const hours = Array.from({ length: 24 * 7 }, (_, i) => i);
			const activity = hours.map(
				(h) => 50 + 40 * Math.sin((2 * Math.PI * h) / 24) + normal(rng, 0, 6)
			);
			const t = mk.col('hour', 'number', hours);
			const v = mk.col('activity', 'number', activity);
			mk.plot('periodogram', 'Activity periodogram', { time: t, values: v });
		}
	},
	{
		id: 'correlogram-rhythm',
		name: 'Correlogram — autocorrelation',
		family: 'Plots',
		description: 'Autocorrelogram of a ~24 h rhythm (7 days, hourly).',
		build(mk) {
			const rng = mulberry32(6);
			const hours = Array.from({ length: 24 * 7 }, (_, i) => i);
			const activity = hours.map(
				(h) => 50 + 40 * Math.cos((2 * Math.PI * h) / 24) + normal(rng, 0, 6)
			);
			const t = mk.col('hour', 'number', hours);
			const v = mk.col('activity', 'number', activity);
			mk.plot('correlogram', 'Activity correlogram', { time: t, values: v });
		}
	},
	{
		id: 'fft-rhythm',
		name: 'FFT — frequency spectrum',
		family: 'Plots',
		description: 'Fourier spectrum of a 12 h + 24 h composite rhythm (8 days, hourly).',
		build(mk) {
			const rng = mulberry32(7);
			const hours = Array.from({ length: 24 * 8 }, (_, i) => i);
			const activity = hours.map(
				(h) =>
					50 +
					30 * Math.sin((2 * Math.PI * h) / 24) +
					15 * Math.sin((2 * Math.PI * h) / 12) +
					normal(rng, 0, 4)
			);
			const t = mk.col('hour', 'number', hours);
			const v = mk.col('signal', 'number', activity);
			mk.plot('fft', 'Signal FFT', { time: t, values: v });
		}
	},
	{
		id: 'table-columns',
		name: 'Table — raw columns',
		family: 'Plots',
		description: 'A tableplot listing an hour index alongside two derived signals.',
		build(mk) {
			const hours = Array.from({ length: 48 }, (_, i) => i);
			const a = hours.map((h) => Math.round(50 + 40 * Math.sin((2 * Math.PI * h) / 24)));
			const b = hours.map((h) => Math.round(20 + 10 * Math.cos((2 * Math.PI * h) / 24)));
			const hId = mk.col('hour', 'number', hours);
			const aId = mk.col('signalA', 'number', a);
			const bId = mk.col('signalB', 'number', b);
			mk.plot('tableplot', 'Signal table', { columnRefs: [hId, aId, bId] });
		}
	}
];

// Column-process demos that benefit from custom, good-looking demo data
// (otherwise the before/after scatter is hard to read). Keyed by process name;
// anything not listed falls back to the nodeCatalog spec's data.
const PROCESS_DEMO_DATA = {
	// One obvious outlier sitting above a gentle rhythm, so removal is visible
	// without a single huge value squashing the y-axis.
	OutlierRemoval: () => {
		const rng = mulberry32(21);
		const base = seq(40, (i) => 30 + 10 * Math.sin((2 * Math.PI * i) / 20) + normal(rng, 0, 2));
		base[18] = 95; // the outlier
		return base;
	},
	// A clear upward trend with scatter, so "remove trend" visibly flattens it.
	RemoveTrend: () => {
		const rng = mulberry32(22);
		return seq(40, (i) => 5 + 1.5 * i + normal(rng, 0, 4));
	},
	// Noisy rhythm so normalising to a range is a meaningful rescale.
	normalize: () => {
		const rng = mulberry32(23);
		return seq(40, (i) => 200 + 60 * Math.sin((2 * Math.PI * i) / 24) + normal(rng, 0, 8));
	}
};

// Analyses that produce a fitted/derived curve aligned to an x grid. For these
// we draw the raw points + the fitted curve as a line. Their y-input is made
// noisy (below) so the fit visibly threads through scattered points.
const FIT_ANALYSES = new Set([
	'Cosinor',
	'FitFunction',
	'DoubleLogistic',
	'TrendFit',
	'SmoothedData',
	'BinnedData',
	'RectangularWave'
]);

// Per-fit-analysis noisy y data + axis labels. The x input and the args still
// come from the shared nodeCatalog spec; we only swap in nicer demo y data.
const FIT_DEMO = {
	Cosinor: {
		seed: 31,
		y: (rng) =>
			seq(50, (i) => 50 + 40 * Math.sin((2 * Math.PI * i) / 24 - Math.PI / 2) + normal(rng, 0, 7)),
		axes: { x: 'Hour', y: 'Activity' }
	},
	FitFunction: {
		seed: 32,
		y: (rng) =>
			seq(50, (i) => 50 + 40 * Math.sin((2 * Math.PI * i) / 24 - Math.PI / 2) + normal(rng, 0, 7)),
		axes: { x: 'Hour', y: 'Signal' }
	},
	DoubleLogistic: {
		seed: 33,
		y: (rng) =>
			seq(
				50,
				(i) =>
					25 + 50 / (1 + Math.exp(-(i - 12))) - 50 / (1 + Math.exp(-(i - 36))) + normal(rng, 0, 3)
			),
		axes: { x: 'Time', y: 'Level' }
	},
	TrendFit: {
		seed: 34,
		y: (rng) => seq(50, (i) => 5 + 1.8 * i + normal(rng, 0, 6)),
		axes: { x: 'x', y: 'y' }
	},
	SmoothedData: {
		seed: 35,
		y: (rng) => seq(50, (i) => 30 + 15 * Math.sin((2 * Math.PI * i) / 25) + normal(rng, 0, 6)),
		axes: { x: 'x', y: 'Value' }
	},
	BinnedData: {
		seed: 36,
		y: (rng) => seq(50, (i) => 50 + 40 * Math.sin((2 * Math.PI * i) / 24) + normal(rng, 0, 9)),
		axes: { x: 'x', y: 'Value' }
	},
	RectangularWave: {
		seed: 37,
		x: () => seq(48, (i) => i),
		y: (rng) => seq(48, (i) => (i % 24 < 12 ? 75 : 25) + normal(rng, 0, 5)),
		axes: { x: 'Hour', y: 'Signal' }
	}
};

// Reset core to a clean slate between demos.
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
}

const resolve = (d) => (typeof d === 'function' ? d() : d);

// Column auto-ids share the global Column counter, so columns created here never
// collide with output columns the TableProcess constructor allocates.
function mkCol(type, values, name) {
	const c = new Column({ type, data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	if (type === 'time') c.timeFormat = 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]';
	core.data.push(c);
	return c.id;
}

function setAxisLabels(p, axes) {
	if (!axes) return;
	// Axis objects vary by plot type (scatter has xAxis/yAxisLeft; others differ).
	if (axes.x != null && p.plot.xAxis) p.plot.xAxis.label = axes.x;
	if (axes.y != null && p.plot.yAxisLeft) p.plot.yAxisLeft.label = axes.y;
	if (axes.y != null && !p.plot.yAxisLeft && p.plot.yAxis) p.plot.yAxis.label = axes.y;
}

// Build a scatterplot from explicit series. Each series:
//   { x, y, label, kind: 'points'|'line', colour }
function scatterPlot(name, series, axes) {
	const p = new Plot({ name, type: 'scatterplot' });
	for (const s of series) {
		const isLine = s.kind === 'line';
		p.plot.addData({
			x: { refId: s.x },
			y: { refId: s.y },
			label: s.label,
			line: { colour: s.colour, draw: isLine, strokeWidth: isLine ? 2.5 : 2, stroke: 'solid' },
			points: { colour: s.colour, draw: !isLine, radius: 3, shape: 'circle' }
		});
	}
	setAxisLabels(p, axes);
	pushObj(p);
	return p;
}

function tablePlot(name, columnRefs) {
	const p = new Plot({ name, type: 'tableplot' });
	p.plot.columnRefs = [...columnRefs];
	p.plot.showCol = columnRefs.map(() => true);
	pushObj(p);
	return p;
}

// Pre-set customName on referencial plot-wrapper columns so the `name` $derived
// short-circuits instead of mutating state during serialization (the app builds
// in production where that DEV-only guard is off; the generator runs under DEV).
function prewarmWrapperNames() {
	for (const plot of core.plots) {
		for (const series of plot.plot?.data ?? []) {
			for (const field of ['x', 'y', 'column', 'time', 'values']) {
				const w = series?.[field];
				if (w && typeof w === 'object' && 'refId' in w && w.customName == null) {
					const real = core.data.find((c) => c.id === w.refId);
					w.customName = real ? `${real.name}` : 'col';
				}
			}
		}
	}
}

// Build one searchable manifest entry. `keywords` collapses everything a user
// might type (display name, family, description, showcased node) so the modal
// search behaves like the node palette.
function manifestEntry({ id, name, family, description, file, kind, showcases }) {
	return {
		id,
		name,
		family,
		description,
		url: `sessions/demos/${file}`,
		kind,
		showcases,
		keywords: [name, description, family, ...showcases].filter(Boolean).join(' ').toLowerCase()
	};
}

describe.runIf(process.env.GEN_DEMOS)('generate demo sessions', () => {
	it('writes demo JSON + index.json', async () => {
		appConsts.processMap = await loadProcesses();
		appConsts.plotMap = await loadPlots();
		appConsts.tableProcessMap = await loadTableProcesses();

		const manifest = [];
		const write = (file, entry) => {
			writeFileSync(join(OUT_DIR, file), outputCoreAsJson(), 'utf8');
			manifest.push(entry);
		};

		// --- Plot demos (hand-crafted, richer narrative) ---------------------
		for (const demo of DEMOS) {
			resetCore();
			const mk = {
				col: (name, type, values) => mkCol(type, values, name),
				plot(type, name, inputs, axes) {
					const p = new Plot({ name, type });
					if (type === 'tableplot') {
						p.plot.columnRefs = [...(inputs.columnRefs ?? [])];
						p.plot.showCol = p.plot.columnRefs.map(() => true);
					} else {
						const data = {};
						for (const [k, colId] of Object.entries(inputs)) data[k] = { refId: colId };
						p.plot.addData(data);
						setAxisLabels(p, axes);
					}
					pushObj(p);
					return p;
				}
			};
			demo.build(mk);
			prewarmWrapperNames();
			write(
				`demo-${demo.id}.json`,
				manifestEntry({
					id: demo.id,
					name: demo.name,
					family: demo.family,
					description: demo.description,
					file: `demo-${demo.id}.json`,
					kind: 'plot',
					showcases: [...new Set(core.plots.map((p) => p.type))]
				})
			);
		}

		// --- Column-process demos (before/after scatter) ---------------------
		for (const spec of PROCESS_SPECS) {
			resetCore();
			const entry = appConsts.processMap.get(spec.name);
			const display = entry?.displayName ?? spec.name;
			const data = PROCESS_DEMO_DATA[spec.name]
				? PROCESS_DEMO_DATA[spec.name]()
				: resolve(spec.data);

			// "before" = a plain copy of the input; "after" = the same data with
			// the process attached (getData() applies it live on load).
			const beforeId = mkCol(spec.colType, [...data], 'input');
			const afterId = mkCol(spec.colType, [...data], `${display.toLowerCase()} result`);
			const otherId = spec.needsOther
				? mkCol(
						'number',
						data.map((_, i) => i),
						'reference'
					)
				: -1;
			const afterCol = core.data.find((c) => c.id === afterId);
			afterCol.addProcess(spec.name);
			const proc = afterCol.processes[afterCol.processes.length - 1];
			spec.setup?.(proc.args, { selfId: afterId, otherId });

			const idx = mkCol(
				'number',
				data.map((_, i) => i),
				'index'
			);
			scatterPlot(
				`${display}: before vs after`,
				[
					{ x: idx, y: beforeId, label: 'Before', kind: 'points', colour: RAW_COLOUR },
					{ x: idx, y: afterId, label: 'After', kind: 'points', colour: FIT_COLOUR }
				],
				{ x: 'Index', y: 'Value' }
			);
			prewarmWrapperNames();
			const file = `demo-process-${spec.name.toLowerCase()}.json`;
			write(
				file,
				manifestEntry({
					id: `process-${spec.name.toLowerCase()}`,
					name: display,
					family: entry?.family ?? 'Other',
					description:
						entry?.description || `Showcases the ${spec.name} process applied to sample data.`,
					file,
					kind: 'process',
					showcases: [spec.name]
				})
			);
		}

		// --- Analysis (table-process) demos ----------------------------------
		for (const spec of TP_SPECS) {
			resetCore();
			const entry = appConsts.tableProcessMap.get(spec.name);
			const display = entry?.displayName ?? spec.name;
			const isFit = FIT_ANALYSES.has(spec.name);

			// Build the input columns. For fit analyses we swap in nicer noisy y
			// data (and sometimes x) so the fitted curve threads through scatter.
			let ids;
			if (isFit) {
				const cfg = FIT_DEMO[spec.name];
				const rng = mulberry32(cfg.seed);
				ids = spec.inputs.map((inp, i) => {
					let values = resolve(inp.data);
					if (i === 0 && cfg.x) values = cfg.x();
					if (i === 1 && cfg.y) values = cfg.y(rng);
					const label = i === 0 ? 'x' : 'y';
					return mkCol(inp.type, values, label);
				});
			} else {
				ids = spec.inputs.map((inp) => mkCol(inp.type, resolve(inp.data), `${display} input`));
			}

			if (spec.needsStoredValues) {
				core.storedValues.demoSV1 = { staticValue: 12, source: 'manual' };
				core.storedValues.demoSV2 = { staticValue: 34, source: 'manual' };
			}

			const tp = new TableProcess({ name: spec.name, args: spec.args(ids) }, null);
			pushObj(tp);
			// Actually run the analysis so its outputs are populated (and baked into
			// the saved session). Workers are bypassed for small inputs / in node.
			try {
				await tp.doProcess();
			} catch (err) {
				// eslint-disable-next-line no-console
				console.warn(`doProcess failed for ${spec.name}:`, err?.message ?? err);
			}

			if (isFit) {
				// raw points + fitted curve as a line
				const cfg = FIT_DEMO[spec.name];
				const xRaw = ids[0];
				const yRaw = ids[1];
				const xOut = tp.args.out[entry.xOutKey];
				const yOut = tp.args.out[(entry.yOutKeyPrefix ?? '') + yRaw];
				const series = [{ x: xRaw, y: yRaw, label: 'Data', kind: 'points', colour: RAW_COLOUR }];
				if (xOut >= 0 && yOut >= 0) {
					series.push({ x: xOut, y: yOut, label: display, kind: 'line', colour: FIT_COLOUR });
				}
				scatterPlot(`${display}: data + fit`, series, cfg.axes);
			} else if (spec.name === 'GroupComparison') {
				// the comparison itself is read off the node; show the groups as a boxplot
				const p = new Plot({ name: `${display}: groups`, type: 'boxplot' });
				p.plot.addData({ x: { refId: ids[0] }, y: { refId: ids[1] } });
				setAxisLabels(p, { x: 'Group', y: 'Value' });
				pushObj(p);
			} else {
				// tableplot of real inputs + any allocated output columns
				const outIds = Object.values(tp.args.out ?? {}).filter(
					(v) => typeof v === 'number' && v >= 0
				);
				tablePlot(`${display} result`, [...ids, ...outIds]);
			}

			prewarmWrapperNames();
			const file = `demo-tp-${spec.name.toLowerCase()}.json`;
			write(
				file,
				manifestEntry({
					id: `tp-${spec.name.toLowerCase()}`,
					name: display,
					family: entry?.family ?? 'Other',
					description: entry?.description || `Showcases the ${spec.name} analysis on sample data.`,
					file,
					kind: 'tableProcess',
					showcases: [spec.name]
				})
			);
		}

		// Order the gallery like the palette (Sources → … → Plots), keeping each
		// family's members in their generation order.
		manifest.sort((a, b) => familyRank(a.family) - familyRank(b.family));

		const index = { version: 1, count: manifest.length, sessions: manifest };
		writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
		// eslint-disable-next-line no-console
		console.log(`GENERATED ${manifest.length} demos -> ${OUT_DIR}`);
	});
});
