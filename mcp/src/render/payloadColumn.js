// The render page's copy of one payload column, and the plot's warnings (render/mount.js), kept
// apart so a test can pin them without a browser.
//
// The engine (engine/session.js renderPlotToFiles) sends each column's `getData()`: for a time
// column that is instants in epoch ms, already parsed from whatever text the session imported.
// The copy must therefore keep NO text format. It used to be given an ISO format, so its own
// getData() re-parsed each number as text and every time was NaN: an actogram of a time column
// drew only its axis, while the same data as numeric hours drew fine.
import { Column } from '$lib/core/Column.svelte';

/**
 * @param {{id:number, name?:string, type?:string, timeZone?:string}} c  a payload column
 *   (its values are stored separately, in core.rawData under `c.id`)
 * @returns {Column}
 */
export function payloadColumn(c) {
	const col = Column.fromJSON({
		id: c.id,
		name: c.name ?? `col_${c.id}`,
		type: c.type ?? 'number',
		data: c.id,
		// The clock the column was recorded on (row and axis labels), when the payload names one.
		...(c.type === 'time' && typeof c.timeZone === 'string' && c.timeZone !== ''
			? { timeZone: c.timeZone }
			: {}),
		processes: []
	});
	col.customName = c.name ?? `col_${c.id}`;
	return col;
}

/**
 * Every warning a plot shows in its controls: each `...Warnings` field (a list of strings) its
 * class defines (Boxplot categoryWarnings / violinWarnings / sigBarWarnings, ...), in order,
 * without repeats. Class fields of a Svelte state class are accessors on its prototype.
 * @param {object} inner  the plot's inner class (`plot.plot`)
 * @returns {string[]}
 */
export function plotWarnings(inner) {
	const out = [];
	for (let proto = Object.getPrototypeOf(inner ?? {}); proto && proto !== Object.prototype; ) {
		for (const key of Object.getOwnPropertyNames(proto)) {
			if (!key.endsWith('Warnings')) continue;
			let list;
			try {
				list = inner[key];
			} catch {
				continue;
			}
			if (!Array.isArray(list)) continue;
			for (const w of list) if (typeof w === 'string' && w && !out.includes(w)) out.push(w);
		}
		proto = Object.getPrototypeOf(proto);
	}
	return out;
}
