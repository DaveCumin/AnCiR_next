// @ts-nocheck
// Maps a live canvas node to the canonical plot for it, as a plain SPEC (not a
// Plot object). Consumed by the Quick-Plot button (plotDataFromSpec below).
// The registry entry carries the wiring hints (xOutKey / yOutKeyPrefix); the node
// carries the live wired column ids (tpObj.args.xIN / .yIN / .out).
import { core, appConsts } from '$lib/core/core.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';

export const RAW_COLOUR = '#234154'; // navy — input / raw
export const OUT_COLOUR = '#BE796B'; // terracotta — output / fitted

const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const colName = (id) => getColumnById(id)?.name ?? String(id);
const isRef = (id) => typeof id === 'number' && id >= 0;

/**
 * Nodes that fold their input onto a single period: the output X is a phase-within-one-day
 * axis, while the input X is elapsed time across the whole record. Same unit (hours),
 * different quantity — so the raw series must NOT be overlaid on the profile. In the shipped
 * demos the raw x spans [0..95] (AverageProfile) and [0..335] (NPCRA) against a profile on
 * [0.5..23.5], which drew the profile squashed into a corner of the raw record's axis and read
 * as though it described only the first day.
 *
 * Keyed by node name because this is a statement about what the plot MEANS, which is this
 * module's job (as with the GroupComparison / RayleighTest cases below); the registry's
 * xOutKey / yOutKeyPrefix stay generic wiring facts.
 */
const FOLDED_PROFILE = new Map([
	['AverageProfile', 'average profile'],
	['NonparametricRA', 'average profile']
]);

export function canonicalNodeViz(node) {
	if (!node) return null;
	if (node.type === 'tableprocess' && node.tpObj) return tpViz(node.tpObj);
	if (node.type === 'process' && node.processObj) return processViz(node.processObj);
	return null; // plots / data / groups / notes have no quick plot
}

function tpViz(tp) {
	const entry = appConsts.tableProcessMap?.get?.(tp.name);
	const out = tp.args?.out ?? {};
	const yINs = toArray(tp.args?.yIN);
	const xRaw = tp.args?.xIN;

	// Nodes whose output X is a different quantity from the input X. These return early even
	// when they can't build a spec (falling back to the table): dropping through to the fit
	// branch below would overlay the raw input on a foreign axis, which is the bug this
	// guards against — a Rhythmicity node with no outputs yet would plot the raw time series
	// under a "data + fit" title.
	if (tp.name === 'RhythmicityAnalysis') {
		// period vs power / magnitude, or lag vs correlation, per the analysis mode.
		return rhythmicityViz(tp, entry, out, yINs) ?? tableFallback(tp, yINs);
	}
	if (FOLDED_PROFILE.has(tp.name)) {
		return foldedProfileViz(tp, entry, out, yINs) ?? tableFallback(tp, yINs);
	}

	// FIT: the node declares a fitted-curve output (xOutKey + yOutKeyPrefix) on the INPUT's own
	// x axis, so raw points and the fitted line belong on one plot.
	if (entry?.xOutKey && entry?.yOutKeyPrefix && isRef(xRaw)) {
		const xOut = out[entry.xOutKey];
		const series = [];
		for (const yId of yINs) {
			if (!isRef(yId)) continue;
			series.push({ x: xRaw, y: yId, label: colName(yId), kind: 'points', colour: RAW_COLOUR });
			const yOut = out[entry.yOutKeyPrefix + yId];
			if (isRef(xOut) && isRef(yOut)) {
				series.push({ x: xOut, y: yOut, label: `${colName(yId)} fit`, kind: 'line', colour: OUT_COLOUR });
			}
		}
		if (series.length) return { type: 'scatterplot', title: `${tp.name}: data + fit`, series };
	}

	// GroupComparison: category x + value y → boxplot with pairwise sig bars.
	if (tp.name === 'GroupComparison') {
		const x = tp.args?.xIN;
		const y = yINs[0];
		if (isRef(x) && isRef(y)) {
			return { type: 'boxplot', title: `${tp.name}: groups`, box: { x, y }, showSigBars: true };
		}
	}

	// Correlation → the correlation heatmap. The heatmap is self-contained (it takes the raw
	// columns and computes the matrix itself), so wire it to this node's OWN input columns —
	// "show the heatmap of the columns being correlated".
	if (tp.name === 'Correlation') {
		const cols = yINs.filter(isRef);
		if (cols.length >= 2) {
			return { type: 'correlationheatmap', title: `${tp.name}: heatmap`, columns: cols };
		}
	}

	// CrossCorrelation → the correlogram: lag (x) vs correlation (y) as a line.
	if (tp.name === 'CrossCorrelation') {
		const xOut = out.lag;
		const yOut = out.correlation;
		if (isRef(xOut) && isRef(yOut)) {
			return {
				type: 'scatterplot',
				title: `${tp.name}: correlogram`,
				series: [{ x: xOut, y: yOut, label: 'cross-correlation', kind: 'line', colour: OUT_COLOUR }]
			};
		}
	}

	// DescribeData → a histogram of each described column.
	if (tp.name === 'DescribeData') {
		const cols = yINs.filter(isRef);
		if (cols.length) return { type: 'histogram', title: `${tp.name}: histograms`, columns: cols };
	}

	// Circular stats (Rayleigh) → the circular phase plot: each Y is a phase/angle
	// series on the clock; `x` is the node's optional time column (-1 when unwired).
	if (tp.name === 'RayleighTest') {
		const timeRef = isRef(tp.args?.timeIN) ? tp.args.timeIN : -1;
		const series = yINs.filter(isRef).map((yId) => ({ x: timeRef, y: yId, label: colName(yId) }));
		if (series.length) return { type: 'circularphase', title: `${tp.name}: circular phase`, series };
	}

	// Fallback: a table of the inputs + every numeric output column.
	return tableFallback(tp, yINs);
}

/** The folded curve alone, on its phase-within-one-period axis. Null when not yet computed. */
function foldedProfileViz(tp, entry, out, yINs) {
	if (!entry?.xOutKey || !entry?.yOutKeyPrefix) return null;
	const xOut = out[entry.xOutKey];
	if (!isRef(xOut)) return null;
	const series = [];
	for (const yId of yINs) {
		const yOut = out[entry.yOutKeyPrefix + yId];
		if (isRef(yOut)) {
			series.push({ x: xOut, y: yOut, label: colName(yId), kind: 'line', colour: OUT_COLOUR });
		}
	}
	if (!series.length) return null;
	return { type: 'scatterplot', title: `${tp.name}: ${FOLDED_PROFILE.get(tp.name)}`, series };
}

/**
 * RhythmicityAnalysis: the spectrum/correlogram the node actually computed.
 *
 * A standalone node emits one pair of array columns PER Y, named `<yId>_<key>` — the keys
 * depending on the analysis mode (periodogram → period/power, fft → period/magnitude,
 * correlogram → lag/correlation). `getPrimaryKeys` on the registry definition is the single
 * source of that mapping; without it we can't know which output is the X, so fall through to
 * the table rather than guess.
 *
 * Returns null when nothing has been computed yet, letting the caller use the table fallback
 * instead of emitting an empty scatter.
 */
function rhythmicityViz(tp, entry, out, yINs) {
	const primary = entry?.definition?.getPrimaryKeys?.(tp.args ?? {});
	if (!primary?.x || !primary?.y) return null;

	const series = [];
	for (const yId of yINs) {
		const xOut = out[`${yId}_${primary.x}`];
		const yOut = out[`${yId}_${primary.y}`];
		if (isRef(xOut) && isRef(yOut)) {
			series.push({ x: xOut, y: yOut, label: colName(yId), kind: 'line', colour: OUT_COLOUR });
		}
	}
	if (!series.length) return null;
	return { type: 'scatterplot', title: `${tp.name}: ${primary.y} vs ${primary.x}`, series };
}

function tableFallback(tp, yINs) {
	const outIds = Object.values(tp.args?.out ?? {}).filter(isRef);
	const refs = [...new Set([tp.args?.xIN, ...yINs, ...outIds].filter(isRef))];
	if (!refs.length) return null;
	return { type: 'tableplot', title: `${tp.name}: values`, columnRefs: refs };
}

function processViz(proc) {
	const inId = toArray(proc.args?.inIN)[0];
	const result = core.data.find((c) => c.producerNodeId === `process_${proc.id}`);
	const refs = [inId, result?.id].filter(isRef);
	if (!refs.length) return null;
	return { type: 'tableplot', title: `${proc.name}: values`, columnRefs: refs };
}

function scatterInner(series) {
	return {
		data: series.map((s) => ({
			x: { refId: s.x },
			y: { refId: s.y },
			label: s.label,
			yAxis: s.yAxis || 'left',
			line: { colour: s.colour, draw: s.kind === 'line', strokeWidth: s.kind === 'line' ? 2.5 : 2, stroke: 'solid' },
			points: { colour: s.colour, draw: s.kind !== 'line', radius: 3, shape: 'circle' }
		}))
	};
}

export function plotDataFromSpec(spec, { x, y, width = 420, height = 300, sourceNodeId = null }) {
	if (!spec) return null;
	let inner;
	if (spec.type === 'scatterplot') inner = scatterInner(spec.series);
	else if (spec.type === 'boxplot') inner = { data: [{ x: { refId: spec.box.x }, y: { refId: spec.box.y } }], showSigBars: !!spec.showSigBars };
	else if (spec.type === 'circularphase') inner = { data: spec.series.map((s) => ({ x: { refId: s.x }, y: { refId: s.y }, label: s.label })) };
	else if (spec.type === 'tableplot') inner = { columnRefs: [...spec.columnRefs], showCol: spec.columnRefs.map(() => true) };
	else if (spec.type === 'correlationheatmap')
		inner = { data: spec.columns.map((id) => ({ column: { refId: id } })) };
	else if (spec.type === 'histogram') inner = { data: spec.columns.map((id) => ({ column: { refId: id } })) };
	else return null;
	return { name: spec.title, type: spec.type, x, y, width, height, sourceNodeId, plot: inner };
}
