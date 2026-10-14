// @ts-nocheck
// One-way migration of legacy Data View plots to Tables (plan 2026-10-15 "fold Data View into
// Table", 2.7; released with the Data View removal in v82.0).
//
// Before v81.15 "View data" on a plot and "View stats" / "View permutations" on an analysis
// node spawned a `dataview` plot. A Table now does both jobs (plots/Tableplot/tableSource.js),
// and the Data View type is gone, so a saved Data View is rewritten as the Table that the same
// button opens today:
//
//   - reactive (a plot's computed data) -> a "Plot's computed data" Table on the same
//     `sourcePlotId` (a plot id or a facet panel id). The `staticHeaders` / `staticRows` copy
//     every reactive view saved is dropped: the Table re-reads its source.
//   - static (a node's result table) -> a "Node results" Table on the Plot's own
//     `sourceNodeId`, with the saved rows as its snapshot (shown until the node recomputes).
//     The result table is identified from the saved HEADERS first and the default TITLE
//     second, among the tables the source node's type publishes. When neither identifies it,
//     or the view has no source node, or the node is not in the file, the Table keeps the rows
//     as a frozen snapshot (`resultKey: null`) and the user is told, once per table.
//
// The Plot wrapper is kept as it was (id, name, position, size, style, metricOut,
// sourceNodeId), so the canvas layout (`nodeLayout` is keyed `plot_<id>`), the dashed
// reference edge and anything else naming the plot by id survive.
//
// Pure: parsed session JSON in, `{ json, warnings }` out. The input is never mutated (a deep
// copy when there is work to do, the SAME object when there is none). Idempotent: the output
// has no `dataview` plots. No `core`, no Svelte, no registry: it runs in `importJson` before
// any plot is built. `migrateDataViewPlot` is the per-plot rewrite, also applied to a plot
// pasted from a tab running an older build (core/nodeClipboard.js clearPlotInputs).

const deepCopy = (v) => JSON.parse(JSON.stringify(v));

/**
 * The result tables each analysis node type publishes (core/nodeResultTables, the
 * `useNodeResultTables` call in each node), with each table's default title. Keyed by the
 * table process `name` saved in `tableProcesses`.
 */
const permutations = (label) => ({ title: `${label}: permutations` });
export const NODE_RESULT_TABLES = Object.freeze({
	Cosinor: { stats: { title: 'Cosinor stats' }, permutations: permutations('Cosinor') },
	DoubleLogistic: {
		stats: { title: 'Double logistic stats' },
		permutations: permutations('Double logistic')
	},
	RectangularWave: {
		stats: { title: 'Rectangular wave stats' },
		permutations: permutations('Rectangular wave')
	},
	FitFunction: { stats: { title: 'Fit function stats' } },
	TrendFit: { stats: { title: 'Trend fit stats' } },
	RhythmicityAnalysis: { stats: { title: 'Rhythmicity stats' } },
	GroupComparison: {
		stats: { title: 'Group comparison stats' },
		summary: { title: 'Group summary' },
		posthoc: { title: 'Group post-hoc' }
	}
});

/**
 * Which result table a set of headers came from, or null. The permutations, group summary and
 * post-hoc tables have fixed headers; every stats table starts with `column` and its other
 * headers vary with the node's options (model, phase reference, permutation test), so a
 * `column`-first table that is none of the others is the node's stats table.
 */
function keyFromHeaders(headers, published) {
	if (!Array.isArray(headers) || headers.length === 0) return null;
	const has = (h) => headers.includes(h);
	if (has('permuted_statistic') && has('observed_statistic')) {
		return 'permutations' in published ? 'permutations' : null;
	}
	if (has('group_a') && has('group_b')) return 'posthoc' in published ? 'posthoc' : null;
	if (has('group') && has('mean') && has('sd')) return 'summary' in published ? 'summary' : null;
	if (headers[0] === 'column') return 'stats' in published ? 'stats' : null;
	return null;
}

function keyFromTitle(name, published) {
	for (const [key, t] of Object.entries(published)) if (t.title === name) return key;
	return null;
}

/** The table process type behind a canvas node id (`tableprocess_<id>`), from the file. */
function sourceNodeType(json, nodeId) {
	const m = /^tableprocess_(.+)$/.exec(String(nodeId ?? ''));
	if (!m) return null;
	const tp = (json?.tableProcesses ?? []).find((t) => String(t?.id) === m[1]);
	return tp ? (tp.name ?? null) : null;
}

/** A `{ headers, rows }` from a Data View's saved static copy, or null when it has no headers. */
function savedRows(inner) {
	const headers = Array.isArray(inner?.staticHeaders) ? inner.staticHeaders : [];
	if (headers.length === 0) return null;
	return { headers, rows: Array.isArray(inner?.staticRows) ? inner.staticRows : [] };
}

// The Table inner every migrated view gets besides its source fields: what Tableplot.toJSON
// writes for a fresh Table (columns are never wired outside Columns mode).
const tableBase = (inner) => ({
	columnRefs: [],
	showCol: [],
	colWidths: {},
	colCurrent: 1,
	showColNumber: false,
	decimalPlaces: Number.isFinite(inner?.decimalPlaces) ? inner.decimalPlaces : 2
});

/**
 * Rewrite one saved plot. Anything that is not a Data View comes back as the same object.
 * @param {object} plot  a saved Plot (wrapper with `type` and inner `plot`)
 * @param {object} [session]  the parsed session it belongs to (to find the source node's type)
 * @returns {{ plot: object, warning: string|null }}
 */
export function migrateDataViewPlot(plot, session = null) {
	if (plot?.type !== 'dataview') return { plot, warning: null };
	const inner = plot.plot ?? {};
	const name = plot.name ?? `plot ${plot.id}`;
	const out = { ...deepCopy(plot), type: 'tableplot' };

	if ((inner.sourceType ?? 'reactive') !== 'static') {
		out.plot = { source: 'plot', sourcePlotId: inner.sourcePlotId ?? null, ...tableBase(inner) };
		return { plot: out, warning: null };
	}

	const snapshot = savedRows(inner);
	const nodeId = plot.sourceNodeId ?? null;
	const nodeType = nodeId != null ? sourceNodeType(session, nodeId) : null;
	const published = nodeType ? NODE_RESULT_TABLES[nodeType] : null;
	const resultKey = published
		? (keyFromHeaders(snapshot?.headers, published) ?? keyFromTitle(plot.name, published))
		: null;
	out.plot = { source: 'node', resultKey, snapshot: deepCopy(snapshot), ...tableBase(inner) };
	if (resultKey != null) return { plot: out, warning: null };

	const why =
		nodeId == null
			? 'it does not record which node it came from'
			: !nodeType
				? 'the node it came from is no longer in the session'
				: 'its columns do not match any table that node publishes';
	return {
		plot: out,
		warning: `Data View '${name}' is now a Table showing the rows it had when saved; it no longer updates, because ${why}`
	};
}

/**
 * Migrate every Data View in a parsed session: `plots`, and `unrestoredPlots` (plots an earlier
 * load could not rebuild, which importJson retries).
 * @param {object} jsonData parsed session JSON
 * @returns {{ json: object, warnings: string[] }} `json` is the input itself when there was
 *   nothing to migrate; one warning per Data View that became a frozen snapshot.
 */
export function migrateDataViews(jsonData) {
	const lists = ['plots', 'unrestoredPlots'];
	const hasView = (k) =>
		Array.isArray(jsonData?.[k]) && jsonData[k].some((p) => p?.type === 'dataview');
	if (!lists.some(hasView)) return { json: jsonData, warnings: [] };
	const json = deepCopy(jsonData);
	const warnings = [];
	for (const k of lists) {
		if (!Array.isArray(json[k])) continue;
		json[k] = json[k].map((p) => {
			const { plot, warning } = migrateDataViewPlot(p, json);
			if (warning) warnings.push(warning);
			return plot;
		});
	}
	return { json, warnings };
}
