// @ts-nocheck
// Chained wires: when the user wires a consumer input FROM a plot's
// passthrough output port (see emitPlotNode in ProcessNode.svelte.js), the
// underlying ref is still the plain column — but we record the "via" here so:
//   1. the edge DRAWS from the plot node (plot → consumer), matching the
//      gesture, instead of jumping back to the column's original source; and
//   2. when the via-plot's own input for that channel is rewired, chained
//      consumers FOLLOW it (their refs are rewritten to the plot's new
//      column), so the picture "consumer reads what this plot shows" stays
//      true.
//
// Entries live in `core.chainRefs` (persisted with the session):
//   { toId, toPort, viaPlotId, colId, channel: 'x'|'y'|null, series }
// reconcileChainRefs() is the single consistency authority, driven by a
// deferred $effect in +page.svelte:
//   - via-plot or consumer gone            → drop entry
//   - consumer no longer refs colId there  → chain broken by the consumer
//     (manual rewire, undo) → drop entry (never fight the user/undo)
//   - via-plot still uses colId            → in sync, keep
//   - via-plot rewired that channel        → follow when unambiguous
//     (x: the series' new x; y: the series' sole remaining y), else drop
import { core } from './core.svelte.js';
import { getColumnById } from './Column.svelte';
import { groupPlotData } from './ProcessNode.svelte.js';

/** True while `plot` still shows `colId` on any input channel. */
export function plotUsesColumn(plot, colId) {
	if (colId == null || colId < 0) return false;
	if ((plot?.plot?.columnRefs ?? []).includes(colId)) return true;
	for (const dp of plot?.plot?.data ?? []) {
		if (
			dp?.x?.refId === colId ||
			dp?.y?.refId === colId ||
			dp?.z?.refId === colId ||
			dp?.column?.refId === colId
		) {
			return true;
		}
	}
	return false;
}

/** Record (or refresh) a chain entry. Called by the editor's wire-apply. */
export function recordChainRef({ toId, toPort, viaPlotId, colId, channel = null, series = null }) {
	if (toId === `plot_${viaPlotId}`) return; // no self-chains
	const rest = (core.chainRefs ?? []).filter(
		(e) => !(e.toId === toId && e.toPort === toPort && e.colId === colId)
	);
	core.chainRefs = [...rest, { toId, toPort, viaPlotId, colId, channel, series }];
}

function findConsumer(toId) {
	const plotMatch = toId.match(/^plot_(\d+)$/);
	if (plotMatch) {
		const p = (core.plots ?? []).find((pp) => pp.id === Number(plotMatch[1]));
		return p ? { kind: 'plot', obj: p } : null;
	}
	const tpMatch = toId.match(/^tableprocess_(\d+)$/);
	if (tpMatch) {
		const t = (core.tableProcesses ?? []).find((tp) => tp.id === Number(tpMatch[1]));
		return t ? { kind: 'tp', obj: t } : null;
	}
	return null;
}

/** Column ids currently wired into the consumer's port. */
function consumerPortCols(consumer, toPort) {
	if (consumer.kind === 'tp') {
		const raw = consumer.obj.args?.[toPort];
		if (Array.isArray(raw)) return raw.filter((n) => typeof n === 'number' && n >= 0);
		return typeof raw === 'number' && raw >= 0 ? [raw] : [];
	}
	const inner = consumer.obj.plot;
	if (toPort === 'series') return (inner?.columnRefs ?? []).filter((n) => n >= 0);
	if (toPort === 'data') {
		return (inner?.data ?? [])
			.map((dp) => dp?.column?.refId ?? dp?.data?.refId)
			.filter((n) => typeof n === 'number' && n >= 0);
	}
	const m = toPort?.match(/^(x|ys)(\d+)$/);
	if (m) {
		const group = groupPlotData(inner?.data ?? [])[Number(m[2]) - 1];
		if (!group) return [];
		if (m[1] === 'x') return (group.xRefId ?? -1) >= 0 ? [group.xRefId] : [];
		return group.dataPoints
			.map((dp) => dp?.y?.refId)
			.filter((n) => typeof n === 'number' && n >= 0);
	}
	return [];
}

/** The via-plot's replacement column for a rewired channel, or null if ambiguous. */
function followColumn(viaPlot, entry) {
	if (entry.channel !== 'x' && entry.channel !== 'y') return null;
	const groups = groupPlotData(viaPlot.plot?.data ?? []);
	const group = groups[(entry.series ?? 1) - 1];
	if (!group) return null;
	if (entry.channel === 'x') {
		const next = group.xRefId;
		return typeof next === 'number' && next >= 0 && getColumnById(next) ? next : null;
	}
	const ys = [
		...new Set(
			group.dataPoints.map((dp) => dp?.y?.refId).filter((n) => typeof n === 'number' && n >= 0)
		)
	];
	// Only follow when the replacement is unambiguous.
	return ys.length === 1 && getColumnById(ys[0]) ? ys[0] : null;
}

/** Rewrite oldCol → nextCol on the consumer's port (direct, like other reconciles). */
function rewireConsumer(consumer, toPort, oldCol, nextCol) {
	if (consumer.kind === 'tp') {
		const args = consumer.obj.args;
		if (args[toPort] === oldCol) args[toPort] = nextCol;
		else if (Array.isArray(args[toPort])) {
			args[toPort] = args[toPort].map((id) => (id === oldCol ? nextCol : id));
		}
		return;
	}
	const inner = consumer.obj.plot;
	if (toPort === 'series') {
		if (Array.isArray(inner?.columnRefs)) {
			inner.columnRefs = inner.columnRefs.map((id) => (id === oldCol ? nextCol : id));
		}
		return;
	}
	const m = toPort?.match(/^(x|ys)(\d+)$/);
	if (m) {
		const group = groupPlotData(inner?.data ?? [])[Number(m[2]) - 1];
		for (const dp of group?.dataPoints ?? []) {
			if (m[1] === 'x' && dp?.x?.refId === oldCol) dp.x.refId = nextCol;
			if (m[1] === 'ys' && dp?.y?.refId === oldCol) dp.y.refId = nextCol;
		}
		return;
	}
	for (const dp of inner?.data ?? []) {
		if (dp?.column?.refId === oldCol) dp.column.refId = nextCol;
	}
}

/**
 * Bring core.chainRefs and chained consumers back into a consistent state.
 * Idempotent; safe to call repeatedly (the +page effect defers it out of the
 * reactive flush).
 */
export function reconcileChainRefs() {
	const refs = core.chainRefs ?? [];
	if (refs.length === 0) return;
	const keep = [];
	let changed = false;

	for (const entry of refs) {
		const viaPlot = (core.plots ?? []).find(
			(p) => p.id === entry.viaPlotId && p.facetParent == null
		);
		const consumer = findConsumer(entry.toId);
		if (!viaPlot || !consumer) {
			changed = true;
			continue;
		}
		if (!consumerPortCols(consumer, entry.toPort).includes(entry.colId)) {
			// Consumer moved off this column (manual rewire / undo): chain broken.
			changed = true;
			continue;
		}
		if (plotUsesColumn(viaPlot, entry.colId)) {
			keep.push(entry);
			continue;
		}
		// Via-plot rewired the channel — follow when the replacement is clear.
		const next = followColumn(viaPlot, entry);
		if (next != null && next !== entry.colId) {
			rewireConsumer(consumer, entry.toPort, entry.colId, next);
			keep.push({ ...entry, colId: next });
		}
		changed = true;
	}

	if (changed) core.chainRefs = keep;
}
