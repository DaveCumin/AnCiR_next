// What a port says about itself, for every node card (WorkflowNode, TableProcessNode,
// GroupNode, CompactNode): its label, its hover/focus tooltip and its accessible name.
//
// A `*` after a port's label marks a port that takes one or more columns (port.dynamic: a
// plot's y port, where each column is its own series, or an analysis's many-in input). The
// tooltip says so, in the same words everywhere (UI-20).
//
// Pure module, no imports.

export const MANY_NOTE = 'The * means it takes one or more columns.';

/**
 * The port's visible label: its display name, else its name; a per-column port (col_<id>)
 * shows its column's name when `colName` knows it.
 * @param {{ name: string, display?: string }} port
 * @param {(id: number) => string | null | undefined} [colName]
 */
export function portLabel(port, colName) {
	const label = port?.display ?? port?.name ?? '';
	if (colName && typeof label === 'string' && label.startsWith('col_')) {
		const name = colName(Number(label.slice(4)));
		if (name) return name;
	}
	return label;
}

/**
 * Tooltip for a port dot.
 * @param {any} port
 * @param {'in' | 'out'} dir
 * @param {{ label?: string, nodeName?: string }} [opts] label overrides portLabel(port);
 *   nodeName leads the text (a compact square shows no labels of its own)
 */
export function portTooltip(port, dir, opts = {}) {
	const label = opts.label ?? portLabel(port);
	const star = port?.dynamic ? '*' : '';
	let text;
	if (dir === 'out' && port?.metric) {
		text = `Metric output: ${label} (one value per series)`;
	} else {
		const parts = [`${dir === 'out' ? 'Output' : 'Input'}: ${label}${star}`];
		if (dir === 'in' && port?.newSeries) {
			const what = port.dynamic ? 'Drop columns' : 'Drop a column';
			parts.push(`${what} here to start series ${port.series}.`);
		} else if (dir === 'in' && port?.newOverlay) {
			parts.push('Drop a column here to add a line to the plot.');
		}
		if (port?.dynamic) parts.push(MANY_NOTE);
		text = parts.length > 1 ? `${parts[0]}. ${parts.slice(1).join(' ')}` : parts[0];
	}
	return opts.nodeName ? `${opts.nodeName}. ${text}` : text;
}

/**
 * Accessible name for a port dot: node name, direction, port name and what kind of port it is.
 * @param {string} nodeName
 * @param {any} port
 * @param {'in' | 'out'} dir
 * @param {{ label?: string }} [opts]
 */
export function portAriaLabel(nodeName, port, dir, opts = {}) {
	const label = opts.label ?? portLabel(port);
	const kind = dir === 'out' ? (port?.metric ? 'metric output port' : 'output port') : 'input port';
	const notes = [];
	if (dir === 'out' && port?.metric) notes.push('one value per series');
	if (port?.dynamic) notes.push('takes one or more columns');
	if (dir === 'in' && port?.newSeries) notes.push(`starts series ${port.series}`);
	if (dir === 'in' && port?.newOverlay) notes.push('adds a line');
	return `${nodeName}: ${kind} ${label}${notes.length ? `, ${notes.join(', ')}` : ''}`;
}

/**
 * The dimmed hint a plot node shows in place of the header of its trailing empty slot (the
 * "Series N+1" pair, or the "Line" drop port), given that slot's first port. `short` is for a
 * node too narrow for `full`.
 * @param {any} port
 * @returns {{ full: string, short: string } | null}
 */
export function newSlotHint(port) {
	if (port?.newSeries) return { full: '+ Drop a column to add a series', short: '+ New series' };
	if (port?.newOverlay) return { full: '+ Drop a column to add a line', short: '+ New line' };
	return null;
}
