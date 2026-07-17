// @ts-nocheck
// Read/write a nested value by a descriptor path.
//
// The paths come from plots/sharedControls.js and address a plot WRAPPER:
//   'width'                → plot.width
//   'plot.paddingIN.top'   → plot.plot.paddingIN.top
//   'plot.xlimsIN[0]'      → plot.plot.xlimsIN[0]
//
// Extracted from ControlDisplay so the AI edit path can write the same paths the shared-options
// panel writes, through the same code. They're plain object helpers with no UI in them; leaving
// them in a .svelte file only meant a util couldn't reach them without importing a component.

/** Any run of characters that isn't `.`, `[` or `]`. */
const splitPath = (path) => path.match(/[^.[\]]+/g) ?? [];

export function getByPath(obj, path) {
	if (!obj || !path) return undefined;
	let cur = obj;
	for (const seg of splitPath(path)) {
		if (cur == null) return undefined;
		cur = cur[seg];
	}
	return cur;
}

export function setByPath(obj, path, val) {
	if (!obj || !path) return;
	const segments = splitPath(path);
	let cur = obj;
	for (let i = 0; i < segments.length - 1; i++) {
		if (cur == null) return;
		cur = cur[segments[i]];
	}
	if (cur != null) cur[segments[segments.length - 1]] = val;
}
