// @ts-nocheck
// Wire-apply / disconnect for a plot series' ENCODING ports (`enc<id>_colour` for Colour by,
// `enc<id>_size` for Size by; see components/plotbits/encodingHost.js). The editor's five wire paths (drag-connect, the
// right-click picker, shift-click clear, edge delete, edge reroute) come through here, as
// overlay ports go through overlayWiring.js. Nothing here records history: the editor wraps
// each call in recordPlotEdit, the same setPlotInner op series wiring uses.
//
// The column is a Column wrapper (`series.colourBy` / `series.sizeBy`, resolveEncodingPort's
// `column`), so its refId is written IN PLACE:
// replacing the wrapper with a plain object would sever its getData() (see the x/y wiring).
//
// Every function takes the plot's INNER data object and the port name, and is a no-op
// returning false when the port is not an encoding port of that inner.

import { resolveEncodingPort } from '$lib/components/plotbits/encodingHost.js';

/** Whether `portName` is a live encoding port of this inner. */
export function isEncodingPort(inner, portName) {
	return resolveEncodingPort(inner, portName) != null;
}

/** Drop a column on an encoding port: it becomes the series' colour or size column. */
export function applyEncodingWire(inner, portName, colId) {
	if (typeof colId !== 'number' || colId < 0) return false;
	const hit = resolveEncodingPort(inner, portName);
	if (!hit) return false;
	hit.column.refId = colId;
	return true;
}

/** Clear the wire on an encoding port (shift-click disconnect). The encoding stays on. */
export function clearEncodingPort(inner, portName) {
	const hit = resolveEncodingPort(inner, portName);
	if (!hit) return false;
	hit.column.refId = -1;
	return true;
}

/** Remove the named wire (edge delete, picker un-tick); a foreign colId changes nothing. */
export function removeEncodingWire(inner, portName, colId) {
	const hit = resolveEncodingPort(inner, portName);
	if (!hit) return false;
	if (hit.column.refId === colId) hit.column.refId = -1;
	return true;
}

/** Swap the wire for another (edge reroute / splice); true only when `oldColId` was wired. */
export function rerouteEncodingWire(inner, portName, oldColId, newColId) {
	const hit = resolveEncodingPort(inner, portName);
	if (!hit || hit.column.refId !== oldColId) return false;
	hit.column.refId = newColId;
	return true;
}

/** What the right-click picker shows: `{ many: false, ids }`, or null for another port. */
export function encodingPortSelection(inner, portName) {
	const hit = resolveEncodingPort(inner, portName);
	if (!hit) return null;
	const ref = hit.column.refId;
	return { many: false, ids: typeof ref === 'number' && ref >= 0 ? [ref] : [] };
}
