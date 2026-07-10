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
// Column-process and table-process demos share builders (Sequence x + y → node,
// with a scatter + table, tidy baked layout) — same as the focused generators.
import { buildProcessDemo, buildTPDemo, addDemoNote } from './nodeDemoBuilders.js';

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
		id: 'meansem-by-day',
		name: 'Mean ± SEM — activity by day',
		family: 'Plots',
		description: 'Per-day mean activity with standard-error whiskers (7 days × 24 hourly points).',
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
			mk.plot(
				'meansem',
				'Activity by day (mean ± SEM)',
				{ x: xId, y: yId },
				{ x: 'Day', y: 'Activity' }
			);
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
			// Explanatory note for the showcased plot type (first non-facet plot).
			const showcasedType = core.plots.find((p) => p.facetParent == null)?.type;
			if (showcasedType) addDemoNote(showcasedType);
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

		// --- Column-process demos -------------------------------------------
		// Every process demo is built the same way (Sequence x + one y source →
		// process node → result, with a Before/After scatter + a table). See
		// buildProcessDemo in nodeDemoBuilders.js.
		for (const spec of PROCESS_SPECS) {
			resetCore();
			const entry = appConsts.processMap.get(spec.name);
			const display = entry?.displayName ?? spec.name;
			await buildProcessDemo(spec, display);
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
		// Analysis TPs (fits + windowed/scalar) get a Sequence x + y → node shape
		// with a scatter + table; other TPs keep their natural viz. All get a tidy
		// baked layout. See buildTPDemo in nodeDemoBuilders.js.
		for (const spec of TP_SPECS) {
			resetCore();
			const entry = appConsts.tableProcessMap.get(spec.name);
			const display = entry?.displayName ?? spec.name;
			await buildTPDemo(spec, entry, display);
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
