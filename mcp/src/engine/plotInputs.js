// Plot inputs that take a LIST of columns (add_plot / render_plot), read from the plot's own
// registry fields (`defaultDataInputs`) the way the workflow canvas builds its ports
// (core/ProcessNode.svelte.js):
//   · a single-input plot (histogram, correlationheatmap, pairsplot, qqplot) has one many-in
//     `data` port: each column is its own series;
//   · a two-input plot has a shared x and a many-in y (`ys`): each column is a series on that x.
// So the many input is the only field of a one-field plot, else the second. Every other field
// holds one column. A single column on the many input is a list of one, so every call that
// worked before wires exactly as before.
//
// Pure (no engine imports): the engine resolves names with it, and the render page
// (render/mount.js) expands the resolved payload into series with it.

/** The input field that takes one or more columns, or null (a plot with no fields: tableplot). */
export function manyInputField(fields) {
	if (fields.length === 1) return fields[0];
	if (fields.length === 2) return fields[1];
	return null;
}

/**
 * The tool's `inputs` as `{ field: id }`, the many field as `id[]` when a list was given, each
 * column resolved by `resolve` (an id or a name; it throws for one that does not exist).
 * A positional array lists the fields in order; on a one-field plot it is that field's list.
 * Unknown fields are ignored, as they always were. Throws, naming the plot and field, for a
 * list on a field that takes one column, for too many positional entries, and for an unknown
 * column in a list.
 */
export function resolvePlotInputs(type, fields, inputs, resolve) {
	const many = manyInputField(fields);
	let byField;
	if (Array.isArray(inputs)) {
		if (fields.length === 1) byField = { [fields[0]]: inputs };
		else {
			if (inputs.length > fields.length) {
				throw new Error(
					`Plot "${type}" takes ${fields.length} positional inputs (${fields.join(', ')}), got ${inputs.length}. Pass a list of columns as the "${many}" entry, e.g. {${fields.map((f) => (f === many ? `${f}: [...]` : `${f}: ...`)).join(', ')}}.`
				);
			}
			byField = Object.fromEntries(fields.map((f, i) => [f, inputs[i]]));
		}
	} else byField = inputs ?? {};

	const out = {};
	for (const f of fields) {
		const ref = byField[f];
		if (ref == null) continue;
		const named = (r) => {
			try {
				return resolve(r);
			} catch (e) {
				throw new Error(`Plot "${type}" input "${f}": ${e.message}`);
			}
		};
		if (Array.isArray(ref)) {
			if (f !== many) {
				throw new Error(
					`Plot "${type}" input "${f}" takes one column, not a list${many ? `; only "${many}" takes a list (one series per column)` : ''}.`
				);
			}
			if (ref.length === 0) continue; // an empty list wires nothing, like a missing field
			out[f] = ref.map(named);
		} else out[f] = named(ref);
	}
	return out;
}

/** Every column id the resolved inputs reference, in order (a list flattened). */
export function plotInputIds(resolved) {
	return Object.values(resolved).flat();
}

/** The resolved inputs with every id mapped through `fn` (lists kept as lists). */
export function mapPlotInputIds(resolved, fn) {
	return Object.fromEntries(
		Object.entries(resolved).map(([f, v]) => [f, Array.isArray(v) ? v.map(fn) : fn(v)])
	);
}

/**
 * The `addData` arguments for the resolved inputs: one series per column on the many field,
 * each carrying the other fields' single columns (`{ field: { refId } }`). No many column
 * wired: one series of whatever is wired, or none when nothing is.
 */
export function plotSeriesDataIns(fields, resolved) {
	const many = manyInputField(fields);
	const shared = {};
	for (const f of fields) {
		if (f !== many && resolved[f] != null) shared[f] = { refId: resolved[f] };
	}
	const list = many == null || resolved[many] == null ? [] : [resolved[many]].flat();
	if (list.length === 0) return Object.keys(shared).length ? [shared] : [];
	return list.map((id) => ({ ...shared, [many]: { refId: id } }));
}

/**
 * Throw when the plot kept fewer series than it was given columns: a plot that draws one
 * series replaces it on each new column (cwt), so a list would silently lose all but the last.
 */
export function assertSeriesKept(type, fields, dataIns, seriesCount) {
	if (dataIns.length > 1 && seriesCount < dataIns.length) {
		throw new Error(
			`Plot "${type}" draws one series, so its "${manyInputField(fields)}" input takes one column, not a list of ${dataIns.length}.`
		);
	}
}
