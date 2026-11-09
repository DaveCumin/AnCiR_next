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

// A two-input plot stores its series positionally as x / y whatever its ports are called
// (src/lib/plots/portVsStorageFields.test.js), so the two vocabularies name the same inputs:
// scatterplot, boxplot, meansem and cwt call them x / y; actogram, periodogram, correlogram,
// fft and circularphase call them time / values. Either pair is accepted on every two-input
// plot (a cwt used to refuse {time, values} that a periodogram takes, and the reverse).
const TWO_INPUT_NAMES = [
	['x', 'y'],
	['time', 'values']
];

/** Other names a plot's inputs are accepted under: `{ alias: field }`. */
export function plotInputAliases(fields) {
	if (fields.length !== 2) return {};
	const out = {};
	for (const pair of TWO_INPUT_NAMES) {
		pair.forEach((name, i) => {
			if (!fields.includes(name)) out[name] = fields[i];
		});
	}
	return out;
}

/**
 * The caller's `{ field: ref }` keyed by the plot's own field names. Throws for a field the plot
 * does not have (it used to be ignored, so a misspelt field surfaced only as "missing input")
 * and for one input given under both its names.
 */
function canonicalInputs(type, fields, byField) {
	const aliases = plotInputAliases(fields);
	const out = {};
	const from = {};
	for (const [key, ref] of Object.entries(byField)) {
		const field = fields.includes(key) ? key : aliases[key];
		if (!field) {
			const also = Object.keys(aliases);
			throw new Error(
				`Plot "${type}" has no input "${key}". Its inputs are ${fields.join(', ') || '(none)'}` +
					`${also.length ? ` (also accepted: ${also.map((a) => `${a} for ${aliases[a]}`).join(', ')})` : ''}. ` +
					`Call list_capabilities for this plot's inputs.`
			);
		}
		if (field in out) {
			throw new Error(
				`Plot "${type}" input "${field}" was given twice, as "${from[field]}" and "${key}". Pass it once.`
			);
		}
		out[field] = ref;
		from[field] = key;
	}
	return out;
}

/**
 * The tool's `inputs` as `{ field: id }`, the many field as `id[]` when a list was given, each
 * column resolved by `resolve` (an id or a name; it throws for one that does not exist).
 * A positional array lists the fields in order; on a one-field plot it is that field's list.
 * A two-input plot also takes its inputs under the other pair of names (plotInputAliases).
 * Throws, naming the plot and field, for a field the plot does not have, for a list on a field
 * that takes one column, for too many positional entries, and for an unknown column in a list.
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
	} else byField = canonicalInputs(type, fields, inputs ?? {});

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
