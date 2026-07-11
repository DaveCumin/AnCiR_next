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

	// FIT: the node declares a fitted-curve output (xOutKey + yOutKeyPrefix).
	if (entry?.xOutKey && entry?.yOutKeyPrefix) {
		const xRaw = tp.args?.xIN;
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
