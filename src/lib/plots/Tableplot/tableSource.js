// @ts-nocheck
// Where a Table's rows come from (plan 2026-10-15 "fold Data View into Table", 2.1).
//
//   'columns'  wired columns (columnRefs), editable; the default and every Table saved
//              before sources existed (no `source` field)
//   'plot'     another plot's computed data (its getDownloadData), read-only
//   'node'     one of an analysis node's result tables (core/nodeResultTables), read-only;
//              the node is the Plot's own `sourceNodeId`
//
// Pure (no core, no Svelte) so the canvas graph, the editor and the tests share one answer.

export const TABLE_SOURCES = Object.freeze(['columns', 'plot', 'node']);

export const TABLE_SOURCE_LABELS = Object.freeze({
	columns: 'Columns',
	plot: "Plot's computed data",
	node: 'Node results'
});

/** The source mode of a Table's inner object; anything unknown or absent is 'columns'. */
export function tableSourceOf(inner) {
	const s = inner?.source;
	return TABLE_SOURCES.includes(s) ? s : 'columns';
}

/** A Table that takes wired columns (so has the `series` input port). False for other plots. */
export function tableTakesColumns(plot) {
	return plot?.type === 'tableplot' && tableSourceOf(plot.plot) === 'columns';
}

/** A Table showing one of a node's result tables ("View stats", "View permutations"). */
export function isNodeResultsTable(plot) {
	return plot?.type === 'tableplot' && tableSourceOf(plot.plot) === 'node';
}

/** A Table mirroring another plot's computed data ("View data"). */
export function isPlotDataTable(plot) {
	return plot?.type === 'tableplot' && tableSourceOf(plot.plot) === 'plot';
}

/** A usable `{ headers, rows }` (both arrays, at least one header), or null. */
export function normaliseRowTable(t) {
	if (!t || typeof t !== 'object') return null;
	if (!Array.isArray(t.headers) || t.headers.length === 0) return null;
	return { headers: [...t.headers], rows: Array.isArray(t.rows) ? t.rows : [] };
}

/**
 * The source fields of a saved Table inner, validated. A wrong shape loads as the safe
 * value (no source plot, no result key, no snapshot) rather than throwing.
 */
export function normaliseTableSource(json) {
	const source = tableSourceOf(json);
	const pid = json?.sourcePlotId;
	return {
		source,
		sourcePlotId: typeof pid === 'number' || typeof pid === 'string' ? pid : null,
		resultKey: typeof json?.resultKey === 'string' ? json.resultKey : null,
		snapshot: normaliseRowTable(json?.snapshot)
	};
}
