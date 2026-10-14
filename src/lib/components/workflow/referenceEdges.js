// @ts-nocheck
// Synthetic "reference" edges on the workflow canvas (plan 2026-10-15 "fold Data View into
// Table", 2.5), and the quick-plot lookup that shares their notion of "spawned from".
//
// A plot can be linked to something it does not take wired columns from:
//   - a Table in "Plot's computed data" mode mirrors the plot named by its inner
//     `sourcePlotId`;
//   - a quick plot, a "View stats" / "View permutations" Table, or a residual plot was
//     spawned from the node named by the Plot's own `sourceNodeId`.
// Neither is a dataflow wire, so the editor derives a port-less dashed edge for each. They
// drive the topological layout (the linked plot lands just downstream of its source) and the
// rendered link. The two checks are independent: a plot may carry both, and a duplicate
// source is drawn once.
import { panelIdParts } from '$lib/core/plotRefs.js';
import { isPlotDataTable, isNodeResultsTable } from '$lib/plots/Tableplot/tableSource.js';

const edge = (fromId, toId) => ({ fromId, toId, type: 'reference', fromPort: null, toPort: null });

/** The canvas node a plot-sourced view links from: the plot, or for a facet panel that is
 *  not itself a canvas node, the panel's generator. Null when neither is on the canvas. */
function plotSourceNodeId(sourcePlotId, ids) {
	if (sourcePlotId == null) return null;
	const direct = `plot_${sourcePlotId}`;
	if (ids.has(direct)) return direct;
	const parts = panelIdParts(sourcePlotId);
	if (parts) {
		const gen = `plot_${parts.generatorId}`;
		if (ids.has(gen)) return gen;
	}
	return null;
}

/**
 * Reference edges for the canvas nodes `allNodes` (`{ id, type, plotObj }`). Pure.
 * @returns {{ fromId: string, toId: string, type: 'reference', fromPort: null, toPort: null }[]}
 */
export function referenceEdges(allNodes) {
	const ids = new Set((allNodes ?? []).map((n) => n.id));
	const out = [];
	for (const node of allNodes ?? []) {
		if (node?.type !== 'plot' || !node.plotObj) continue;
		const plot = node.plotObj;
		const froms = [];
		// 1. A view of another plot's computed data -> that plot.
		if (isPlotDataTable(plot)) {
			const from = plotSourceNodeId(plot.plot?.sourcePlotId, ids);
			if (from) froms.push(from);
		}
		// 2. Independently: whatever node the plot was spawned from.
		const src = plot.sourceNodeId;
		if (src && ids.has(src) && !froms.includes(src)) froms.push(src);
		for (const from of froms) {
			if (from !== node.id) out.push(edge(from, node.id));
		}
	}
	return out;
}

/**
 * The quick plot of a node: the first plot spawned from it that is not one of its result
 * tables. A "View stats" / "View permutations" Table also carries the node's id as
 * `sourceNodeId`, but it is not the node's canonical plot, so Quick plot must spawn that
 * rather than jump to the table.
 */
export function findQuickPlot(plots, nodeId) {
	return (plots ?? []).find((p) => p.sourceNodeId === nodeId && !isNodeResultsTable(p)) ?? null;
}
