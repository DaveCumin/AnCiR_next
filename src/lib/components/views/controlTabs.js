// @ts-nocheck
// Which control-panel tab to show for the selected plot (UI-3).
//
// `appState.currentControlTab` is one global value, but each plot type has its
// own tabs (Actogram has Annotations, Scatterplot has Overlays, Tableplot's only
// tab is "Properties and Data"). A plot renders controls only for its own tab
// names, so moving the selection from an Actogram on Annotations to a periodogram
// used to leave a blank panel with no tab highlighted.
//
// Rule, applied whenever the selected plot changes (and whenever the tab is not
// one the plot has):
//   1. keep the current tab if the new plot has it (Data stays Data);
//   2. otherwise the tab last used on a plot of this type, if it still exists;
//   3. otherwise the plot's first tab.

/** Last tab chosen per plot type, for this page session. */
const lastTabByType = new Map();

/** Lower-cased tab ids for a list of control headers. */
export function tabIds(headers) {
	return (headers ?? []).map((h) => String(h).toLowerCase());
}

/**
 * @param {string} current the current (global) tab id
 * @param {string[]} headers the selected plot's control headers
 * @param {string | undefined} remembered the last tab used on this plot type
 * @returns {string} the tab id to show
 */
export function resolveControlTab(current, headers, remembered) {
	const ids = tabIds(headers);
	if (ids.length === 0) return current;
	if (ids.includes(current)) return current;
	if (remembered && ids.includes(remembered)) return remembered;
	return ids[0];
}

/** Remember the tab the user chose for a plot type. */
export function rememberControlTab(type, tab) {
	if (type) lastTabByType.set(type, tab);
}

/** The tab last chosen for a plot type, or undefined. */
export function rememberedControlTab(type) {
	return lastTabByType.get(type);
}

/** Test seam. */
export function forgetControlTabs() {
	lastTabByType.clear();
}

/**
 * The tab after `current` when moving by `step` (arrow keys), wrapping around.
 * @param {string[]} headers
 * @param {string} current
 * @param {number} step +1 or -1
 */
export function stepControlTab(headers, current, step) {
	const ids = tabIds(headers);
	if (ids.length === 0) return current;
	const i = ids.indexOf(current);
	return ids[((((i < 0 ? 0 : i) + step) % ids.length) + ids.length) % ids.length];
}
