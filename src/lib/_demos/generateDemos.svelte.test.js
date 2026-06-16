/**
 * Demo-session generator (NOT a normal test).
 *
 * Mints AnCiR-native example sessions using the real Column/Plot classes and
 * the same serialization the app uses (outputCoreAsJson), then writes them to
 * static/sessions/demos/ along with an index.json manifest. The load-session
 * modal fetches that manifest and lists the demos under "examples".
 *
 * Run it explicitly (it is gated so it never runs in the normal suite):
 *   GEN_DEMOS=1 npx vitest run src/lib/_demos/generateDemos.svelte.test.js
 *
 * Adding a demo: append a spec to DEMOS below. Each spec builds some synthetic
 * columns and one or more plots. To add time-based plots (Actogram/Periodogram)
 * later, create a 'time'-typed column with a timeFormat and ISO-string rawData.
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
			mk.plot('scatterplot', 'Activity vs hour', { x: xId, y: yId });
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
			mk.plot('histogram', 'Measurement distribution', { column: cId });
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
			mk.plot('boxplot', 'Activity by day', { x: xId, y: yId });
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

// Pre-set customName on referencial plot-wrapper columns so the `name` $derived
// short-circuits instead of mutating state during serialization (the app builds
// in production where that DEV-only guard is off; the generator runs under DEV).
function prewarmWrapperNames() {
	for (const plot of core.plots) {
		for (const series of plot.plot?.data ?? []) {
			for (const field of ['x', 'y', 'column']) {
				const w = series?.[field];
				if (w && typeof w === 'object' && 'refId' in w && w.customName == null) {
					const real = core.data.find((c) => c.id === w.refId);
					w.customName = (real ? `${real.name}` : 'col') + (w.refId >= 0 ? '' : '');
				}
			}
		}
	}
}

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

function tablePlot(name, columnRefs) {
	const p = new Plot({ name, type: 'tableplot' });
	p.plot.columnRefs = [...columnRefs];
	p.plot.showCol = columnRefs.map(() => true);
	pushObj(p);
}

// Build one searchable manifest entry. `keywords` collapses everything a user
// might type (node key, display name, family, description) so the modal search
// behaves like the node palette.
function manifestEntry({ id, name, family, description, file, kind, showcases }) {
	return {
		id,
		name,
		family,
		description,
		url: `sessions/demos/${file}`,
		kind,
		showcases,
		keywords: [name, description, family, kind, ...showcases]
			.filter(Boolean)
			.join(' ')
			.toLowerCase()
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
				plot(type, name, inputs) {
					const p = new Plot({ name, type });
					if (type === 'tableplot') {
						p.plot.columnRefs = [...(inputs.columnRefs ?? [])];
						p.plot.showCol = p.plot.columnRefs.map(() => true);
					} else {
						const data = {};
						for (const [k, colId] of Object.entries(inputs)) data[k] = { refId: colId };
						p.plot.addData(data);
					}
					pushObj(p);
					return p;
				}
			};
			demo.build(mk);
			prewarmWrapperNames();
			const showcases = [...new Set(core.plots.map((p) => p.type))];
			write(
				`demo-${demo.id}.json`,
				manifestEntry({
					id: demo.id,
					name: demo.name,
					family: demo.family,
					description: demo.description,
					file: `demo-${demo.id}.json`,
					kind: 'plot',
					showcases
				})
			);
		}

		// --- Column-process demos (one per process) --------------------------
		for (const spec of PROCESS_SPECS) {
			resetCore();
			const entry = appConsts.processMap.get(spec.name);
			const selfId = mkCol(spec.colType, resolve(spec.data), `${spec.name} input`);
			const otherId = spec.needsOther ? mkCol('number', SAMPLE.index(), 'filter source') : -1;
			const col = core.data.find((c) => c.id === selfId);
			col.addProcess(spec.name);
			const proc = col.processes[col.processes.length - 1];
			spec.setup?.(proc.args, { selfId, otherId });
			const refs = otherId >= 0 ? [selfId, otherId] : [selfId];
			tablePlot(`${entry?.displayName ?? spec.name} result`, refs);
			prewarmWrapperNames();
			const file = `demo-process-${spec.name.toLowerCase()}.json`;
			write(
				file,
				manifestEntry({
					id: `process-${spec.name.toLowerCase()}`,
					name: `${entry?.displayName ?? spec.name} (process)`,
					family: 'Column processes',
					description:
						entry?.description ||
						`Showcases the ${spec.name} column process applied to sample data.`,
					file,
					kind: 'process',
					showcases: [spec.name]
				})
			);
		}

		// --- Table-process demos (one per table process) ---------------------
		for (const spec of TP_SPECS) {
			resetCore();
			const entry = appConsts.tableProcessMap.get(spec.name);
			const ids = spec.inputs.map((inp) =>
				mkCol(inp.type, resolve(inp.data), `${spec.name} input`)
			);
			if (spec.needsStoredValues) {
				core.storedValues.demoSV1 = { staticValue: 12, source: 'manual' };
				core.storedValues.demoSV2 = { staticValue: 34, source: 'manual' };
			}
			const tp = new TableProcess({ name: spec.name, args: spec.args(ids) }, null);
			pushObj(tp);
			// Showcase the node's inputs + any allocated output columns. Output data
			// is computed when the TP node mounts on load (see LoadSessionModal).
			const outIds = Object.values(tp.args.out ?? {}).filter(
				(v) => typeof v === 'number' && v >= 0
			);
			tablePlot(`${entry?.displayName ?? spec.name} table`, [...ids, ...outIds]);
			prewarmWrapperNames();
			const file = `demo-tp-${spec.name.toLowerCase()}.json`;
			write(
				file,
				manifestEntry({
					id: `tp-${spec.name.toLowerCase()}`,
					name: `${entry?.displayName ?? spec.name} (table process)`,
					family: 'Table processes',
					description:
						entry?.description || `Showcases the ${spec.name} table process on sample data.`,
					file,
					kind: 'tableProcess',
					showcases: [spec.name]
				})
			);
		}

		const index = { version: 1, count: manifest.length, sessions: manifest };
		writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
		// eslint-disable-next-line no-console
		console.log(`GENERATED ${manifest.length} demos -> ${OUT_DIR}`);
	});
});
