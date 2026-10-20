// @ts-nocheck
// Wire-apply / disconnect for a plot series' COLOUR-BY port (`enc<id>_colour`, see
// components/plotbits/encodingHost.js). The editor's five wire paths (drag-connect, the
// right-click picker, shift-click clear, edge delete, edge reroute) come through here, as
// overlay ports go through overlayWiring.js. Nothing here records history: the editor wraps
// each call in recordPlotEdit, the same setPlotInner op series wiring uses.
//
// The colour column is a Column wrapper (`series.colourBy`), so its refId is written IN PLACE:
// replacing the wrapper with a plain object would sever its getData() (see the x/y wiring).
//
// Every function takes the plot's INNER data object and the port name, and is a no-op
// returning false when the port is not a colour port of that inner.

import { resolveEncodingPort } from '$lib/components/plotbits/encodingHost.js';

/** Whether `portName` is a live colour-by port of this inner. */
export function isEncodingPort(inner, portName) {
	return resolveEncodingPort(inner, portName) != null;
}

/** Drop a column on a colour port: it becomes the series' colour column (one column). */
export function applyEncodingWire(inner, portName, colId) {
	if (typeof colId !== 'number' || colId < 0) return false;
	const hit = resolveEncodingPort(inner, portName);
	if (!hit) return false;
	hit.datum.colourBy.refId = colId;
	return true;
}

/** Clear the wire on a colour port (shift-click disconnect). Colour by stays on. */
export function clearEncodingPort(inner, portName) {
	const hit = resolveEncodingPort(inner, portName);
	if (!hit) return false;
	hit.datum.colourBy.refId = -1;
	return true;
}

/** Remove the named wire (edge delete, picker un-tick); a foreign colId changes nothing. */
export function removeEncodingWire(inner, portName, colId) {
	const hit = resolveEncodingPort(inner, portName);
	if (!hit) return false;
	if (hit.datum.colourBy.refId === colId) hit.datum.colourBy.refId = -1;
	return true;
}

/** Swap the wire for another (edge reroute / splice); true only when `oldColId` was wired. */
export function rerouteEncodingWire(inner, portName, oldColId, newColId) {
	const hit = resolveEncodingPort(inner, portName);
	if (!hit || hit.datum.colourBy.refId !== oldColId) return false;
	hit.datum.colourBy.refId = newColId;
	return true;
}

/** What the right-click picker shows: `{ many: false, ids }`, or null for another port. */
export function encodingPortSelection(inner, portName) {
	const hit = resolveEncodingPort(inner, portName);
	if (!hit) return null;
	const ref = hit.datum.colourBy.refId;
	return { many: false, ids: typeof ref === 'number' && ref >= 0 ? [ref] : [] };
}
