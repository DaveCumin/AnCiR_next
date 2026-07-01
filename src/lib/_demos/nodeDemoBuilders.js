// nodeDemoBuilders.js — shared builders for the gallery's node demos.
//
// Every column-process demo follows the same shape (mirroring the original "add"
// demo): a Sequence source for x, ONE source column for y, and the process as a
// free/orphan node that turns y into a result column (y → [Process] → result):
//
//   Sequence (x) ───────────────┐
//                                ├─→ Scatter (Before: x,y | After: x,result)
//   y (source) ──┬──────────────┘
//                └─→ [Process] ─→ result ─┬─→ Table (y, result)
//                                          └─→ (also on the scatter, as "After")
//
// This replaces the old before/after pattern that had THREE raw sources (index +
// input + result). Here there are only TWO sources (Sequence x, y); `result` is
// the process node's OUTPUT (a producer column), not a third source. All nodes
// load EXPANDED, and positions are baked with generous rows because the canvas
// auto-layout underestimates an expanded node's height.
import { core, pushObj, createOrphanProcess, getProcessNodeGraph } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { SAMPLE } from './nodeCatalog.js';

// Deterministic RNG (seeded) so the fit demos' noisy data is stable across runs.
function mulberry32(seed) {
	return function () {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
function normal(rng, mean = 0, sd = 1) {
	const u = Math.max(rng(), 1e-12);
	const v = rng();
	return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));

// Analyses that produce a fitted curve aligned to an x grid (raw points + fit
// line). Their y is made noisy so the fit visibly threads through the scatter.
const FIT_ANALYSES = new Set([
	'Cosinor',
	'FitFunction',
	'DoubleLogistic',
	'TrendFit',
	'SmoothedData',
	'BinnedData',
	'RectangularWave'
]);
// x+y → output analyses without a fitted curve (windowed / scalar outputs).
const SCALAR_ANALYSES = new Set(['MovingAnalysis', 'RhythmicityAnalysis']);
const isAnalysisTP = (name) => FIT_ANALYSES.has(name) || SCALAR_ANALYSES.has(name);

// Per-fit-analysis noisy y data (+ optional x override) and axis labels.
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
				(i) => 25 + 50 / (1 + Math.exp(-(i - 12))) - 50 / (1 + Math.exp(-(i - 36))) + normal(rng, 0, 3)
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

const RAW_COLOUR = '#234154'; // navy — the input (Before)
const OUT_COLOUR = '#BE796B'; // terracotta — the processed result (After)

const resolve = (d) => (typeof d === 'function' ? d() : d);

// --- shared helpers ----------------------------------------------------------

/** A raw source column holding `values`, named `name`. Returns its id. */
function mkCol(type, values, name) {
	const c = new Column({ type, data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	if (type === 'time') c.timeFormat = 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]';
	core.data.push(c);
	return c.id;
}

// Build a scatterplot from explicit series. Each series may set `yAxis: 'right'`
// to plot on the second y-axis; `axes.yRight` labels it. Returns the Plot.
function scatterPlot(name, series, axes) {
	const p = new Plot({ name, type: 'scatterplot' });
	for (const s of series) {
		const isLine = s.kind === 'line';
		p.plot.addData({
			x: { refId: s.x },
			y: { refId: s.y },
			label: s.label,
			yAxis: s.yAxis || 'left',
			line: { colour: s.colour, draw: isLine, strokeWidth: isLine ? 2.5 : 2, stroke: 'solid' },
			points: { colour: s.colour, draw: !isLine, radius: 3, shape: 'circle' }
		});
	}
	if (axes?.x != null && p.plot.xAxis) p.plot.xAxis.label = axes.x;
	if (axes?.y != null && p.plot.yAxisLeft) p.plot.yAxisLeft.label = axes.y;
	if (axes?.yRight != null && p.plot.yAxisRight) p.plot.yAxisRight.label = axes.yRight;
	pushObj(p);
	return p;
}

/** Build a tableplot listing `columnRefs`. Returns the Plot. */
function tablePlot(name, columnRefs) {
	const p = new Plot({ name, type: 'tableplot' });
	p.plot.columnRefs = [...columnRefs];
	p.plot.showCol = p.plot.columnRefs.map(() => true);
	pushObj(p);
	return p;
}

// Pre-set customName on plot-wrapper columns so the `name` $derived short-circuits
// instead of mutating state during serialization (the generator runs under DEV).
function prewarmWrapperNames() {
	for (const plot of core.plots) {
		for (const series of plot.plot?.data ?? []) {
			for (const field of ['x', 'y']) {
				const w = series?.[field];
				if (w && typeof w === 'object' && 'refId' in w && w.customName == null) {
					const real = core.data.find((c) => c.id === w.refId);
					w.customName = real ? `${real.name}` : 'col';
				}
			}
		}
	}
}

function setAxisLabels(p, axes) {
	if (!axes) return;
	if (axes.x != null && p.plot.xAxis) p.plot.xAxis.label = axes.x;
	if (axes.y != null && p.plot.yAxisLeft) p.plot.yAxisLeft.label = axes.y;
	if (axes.y != null && !p.plot.yAxisLeft && p.plot.yAxis) p.plot.yAxis.label = axes.y;
}

// Bake a tidy left→right layout from the live node graph: source nodes (raw data
// + input-less generator TPs) in column 1, operations (processing TPs + free
// processes) in column 2, plots in column 3 — each column stacked with tall rows.
// Rows are generous (≈500px) because nodes load EXPANDED and the canvas
// auto-layout can't measure an expanded node's height; the WorkflowEditor
// `_importedLayout` restore honours these even for late-loading plot nodes.
function bakeLayoutFromGraph() {
	const { nodes } = getProcessNodeGraph();
	const sources = [];
	const ops = [];
	const plots = [];
	for (const n of nodes) {
		if (n.type === 'plot') plots.push(n.id);
		else if (n.type === 'data') sources.push(n.id);
		else if (n.type === 'tableprocess' && (n.ports?.inputs?.length ?? 0) === 0) sources.push(n.id);
		else ops.push(n.id);
	}
	const COL = [60, 440, 820];
	const ROW = 500;
	const layout = {};
	sources.forEach((id, i) => (layout[id] = { x: COL[0], y: 60 + i * ROW }));
	ops.forEach((id, i) => (layout[id] = { x: COL[1], y: 60 + i * ROW }));
	plots.forEach((id, i) => (layout[id] = { x: COL[2], y: 60 + i * ROW }));
	core.nodeLayout = layout;
}

/** A Sequence source TP producing 0..count-1. Returns { nodeId, colId }. */
async function makeSequenceX(count, name = 'x') {
	const tp = new TableProcess(
		{
			name: 'SequenceColumn',
			args: { seqType: 'number', start: 0, step: 1, count, end: count - 1, out: { result: -1 } }
		},
		null
	);
	pushObj(tp);
	await tp.doProcess();
	const colId = tp.args.out.result;
	const col = core.data.find((c) => c.id === colId);
	if (col) col.customName = name;
	return { nodeId: `tableprocess_${tp.id}`, colId };
}

// --- the column-process demo -------------------------------------------------

/**
 * Build a column-process demo into the (reset) core. Async because the Sequence
 * source runs to bake its column.
 *
 * @param spec  a PROCESS_SPECS entry ({ name, colType, data, setup, needsOther })
 * @param display  the process display name (for plot titles)
 */
export async function buildProcessDemo(spec, display) {
	const data = resolve(spec.data);
	const N = data.length;

	// x — a Sequence source (0..N-1).
	const x = await makeSequenceX(N, 'x');

	// y — one source column holding the sample data.
	const yId = mkCol(spec.colType, [...data], 'y');

	// A second "reference" column for the rare cross-column process.
	let otherId = -1;
	let otherNode = null;
	if (spec.needsOther) {
		otherId = mkCol('number', SAMPLE.index(), 'reference');
		otherNode = `data_${otherId}`;
	}

	// The process as a free/orphan node consuming y → result (a producer column).
	const args = { inIN: [yId] };
	spec.setup?.(args, { selfId: yId, otherId });
	const proc = createOrphanProcess(spec.name, args);
	const result = new Column({
		type: spec.colType,
		producerNodeId: `process_${proc.id}`,
		producerPort: `out_${yId}`,
		producerArtifactKind: 'column'
	});
	result.customName = `${display} result`;
	core.data.push(result);

	// Before/After scatter + a table of y alongside the result.
	const scatter = scatterPlot(
		`${display}: before vs after`,
		[
			{ x: x.colId, y: yId, label: 'Before', kind: 'points', colour: RAW_COLOUR },
			{ x: x.colId, y: result.id, label: 'After', kind: 'points', colour: OUT_COLOUR }
		],
		{ x: 'x', y: 'value' }
	);
	const table = tablePlot(`${display}: values`, [yId, result.id]);

	prewarmWrapperNames();
	bakeLayoutFromGraph();
	return { proc, xId: x.colId, yId, resultId: result.id, scatter, table };
}

/**
 * Build a table-process (analysis) demo into the (reset) core.
 *
 * Analysis TPs (fit curves + windowed/scalar analyses) get the same shape as the
 * process demos: a Sequence x-source + one y source feeding the analysis node,
 * with a scatter + a table. Every other TP (sources, reshapers, multi-column,
 * categorical) keeps its natural structure and viz. All get a tidy baked layout.
 *
 * @param spec  a TP_SPECS entry
 * @param entry the tableProcessMap registry entry (for displayName / out keys)
 * @param display the TP display name
 */
export async function buildTPDemo(spec, entry, display) {
	const isFit = FIT_ANALYSES.has(spec.name);
	const analysis = isAnalysisTP(spec.name);

	// Inputs. Analysis TPs use a Sequence x-source + one y source; everything else
	// builds its declared inputs as plain source columns.
	let ids;
	if (analysis) {
		const cfg = isFit ? FIT_DEMO[spec.name] : null;
		const yData = cfg ? cfg.y(mulberry32(cfg.seed)) : resolve(spec.inputs[1].data);
		const x = await makeSequenceX(yData.length, 'x');
		const yId = mkCol(spec.inputs[1].type, yData, 'y');
		ids = [x.colId, yId];
	} else {
		// Disambiguate when there's more than one input ("… input 1", "… input 2").
		ids = spec.inputs.map((inp, i) =>
			mkCol(
				inp.type,
				resolve(inp.data),
				spec.inputs.length > 1 ? `${display} input ${i + 1}` : `${display} input`
			)
		);
	}

	if (spec.needsStoredValues) {
		core.storedValues.demoSV1 = { staticValue: 12, source: 'manual' };
		core.storedValues.demoSV2 = { staticValue: 34, source: 'manual' };
	}

	const tp = new TableProcess({ name: spec.name, args: spec.args(ids) }, null);
	pushObj(tp);
	try {
		await tp.doProcess();
	} catch (err) {
		// eslint-disable-next-line no-console
		console.warn(`doProcess failed for ${spec.name}:`, err?.message ?? err);
	}

	const outIds = Object.values(tp.args.out ?? {}).filter((v) => typeof v === 'number' && v >= 0);

	if (isFit) {
		// raw points + fitted curve as a line, plus a table of y and the fit.
		const cfg = FIT_DEMO[spec.name];
		const xRaw = ids[0];
		const yRaw = ids[1];
		const xOut = tp.args.out[entry.xOutKey];
		const yOut = tp.args.out[(entry.yOutKeyPrefix ?? '') + yRaw];
		const series = [{ x: xRaw, y: yRaw, label: 'Data', kind: 'points', colour: RAW_COLOUR }];
		if (xOut >= 0 && yOut >= 0) {
			series.push({ x: xOut, y: yOut, label: display, kind: 'line', colour: OUT_COLOUR });
		}
		scatterPlot(`${display}: data + fit`, series, cfg.axes);
		tablePlot(`${display}: values`, yOut >= 0 ? [yRaw, yOut] : [yRaw]);
	} else if (spec.name === 'MovingAnalysis') {
		// Raw signal (left axis) + the windowed period output as a second series on
		// the right axis (movex → x, peak_period → y).
		const yId = ids[1];
		const movex = tp.args.out.movex;
		const period = tp.args.out[`${yId}_peak_period`];
		const series = [
			{ x: ids[0], y: ids[1], label: 'Signal', kind: 'points', colour: RAW_COLOUR, yAxis: 'left' }
		];
		if (movex >= 0 && period >= 0) {
			series.push({
				x: movex,
				y: period,
				label: 'Moving period',
				kind: 'line',
				colour: OUT_COLOUR,
				yAxis: 'right'
			});
		}
		scatterPlot(`${display}: signal + moving period`, series, {
			x: 'time',
			y: 'signal',
			yRight: 'period (h)'
		});
		tablePlot(`${display}: result`, outIds.length ? outIds : ids);
	} else if (spec.name === 'RhythmicityAnalysis') {
		// Two scatterplots: the raw signal, and the analysis output (periodogram:
		// power vs period).
		const yId = ids[1];
		const period = tp.args.out[`${yId}_period`];
		const power = tp.args.out[`${yId}_power`];
		scatterPlot(
			`${display}: signal`,
			[{ x: ids[0], y: ids[1], label: 'Signal', kind: 'points', colour: RAW_COLOUR }],
			{ x: 'time', y: 'signal' }
		);
		if (period >= 0 && power >= 0) {
			scatterPlot(
				`${display}: periodogram`,
				[{ x: period, y: power, label: 'Power', kind: 'line', colour: OUT_COLOUR }],
				{ x: 'period (h)', y: 'power' }
			);
		}
	} else if (spec.name === 'NonparametricRA') {
		// The average 24 h activity profile (npcrax → x, npcray → y) as a line —
		// the classic NPCRA view — plus a table of the scalar metrics.
		const yId = ids[1];
		const profX = tp.args.out.npcrax;
		const profY = tp.args.out[`npcray_${yId}`];
		if (profX >= 0 && profY >= 0) {
			scatterPlot(
				`${display}: average day`,
				[{ x: profX, y: profY, label: 'Average profile', kind: 'line', colour: OUT_COLOUR }],
				{ x: 'hour of day', y: 'activity' }
			);
		}
		const metricIds = ['IS', 'IV', 'RA', 'M10', 'L5']
			.map((k) => tp.args.out[k])
			.filter((v) => typeof v === 'number' && v >= 0);
		tablePlot(`${display}: metrics`, metricIds.length ? metricIds : outIds);
	} else if (spec.name === 'GroupComparison') {
		const p = new Plot({ name: `${display}: groups`, type: 'boxplot' });
		p.plot.addData({ x: { refId: ids[0] }, y: { refId: ids[1] } });
		setAxisLabels(p, { x: 'Group', y: 'Value' });
		// Show the pairwise significance bars — the whole point of a group comparison.
		p.plot.showSigBars = true;
		pushObj(p);
	} else {
		tablePlot(`${display} result`, [...ids, ...outIds]);
	}

	prewarmWrapperNames();
	bakeLayoutFromGraph();
	return { tp };
}
