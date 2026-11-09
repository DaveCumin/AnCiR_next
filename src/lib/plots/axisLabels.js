// The automatic title of an axis that shows wired columns (Scatterplot x / left y / right y,
// Boxplot and Mean +/- SEM x and y).
//
// Drawn while the axis's stored label is empty (Axis.svelte `defaultLabel`, the same mechanism
// as the Periodogram's per-method and the Histogram's Count/Density titles), so it follows a
// rewire or a rename and a typed label always wins. It is never saved: a session reopens with
// the label it was saved with, and an empty one still tracks its columns.
//
// The title is the columns' display name when they all show ONE column (every series on a
// shared x, or a single y). Several different columns on one axis get no title: the legend
// names the series, and "temp, temp2, temp3" is not an axis quantity.
import { displayNameOf } from '$lib/core/columnLabels.js';

/**
 * @param {Array<object|null|undefined>} columns  the wired column wrappers on this axis
 * @returns {string}
 */
export function defaultAxisLabel(columns) {
	let only = null;
	for (const col of columns ?? []) {
		const name = col ? displayNameOf(col) : '';
		if (!name) continue;
		if (only == null) only = name;
		else if (only !== name) return '';
	}
	return only ?? '';
}
