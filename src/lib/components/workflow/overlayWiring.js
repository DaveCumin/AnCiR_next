// @ts-nocheck
// Wire-apply / disconnect for a plot's OVERLAY ports (`ov<id>_<key>`, see
// ProcessNode.svelte.js). WorkflowEditor's five wire paths (drag-connect, the
// right-click picker, shift-click clear, edge delete, edge reroute) all come
// through here so the overlay channel is written by exactly one thing: the
// OverlayClass API (setWire / addWire / removeWire). Nothing here touches the
// channel object directly, and nothing here records history: the editor wraps
// each call in recordPlotEdit, the same setPlotInner op series wiring uses.
//
// Every function takes the plot's INNER data object (`plotObj.plot`) and the
// port name, and is a no-op returning false when the port is not an overlay
// port of that inner (unknown overlay, or a channel the current form lacks).

import { resolveOverlayPort } from '$lib/core/ProcessNode.svelte.js';

/**
 * Drop a column on an overlay port: a single channel takes it as its one wire
 * (replacing any previous wire and clearing typed values), a dynamic channel
 * (a line's `at`) appends it. Returns true when the port was an overlay port.
 */
export function applyOverlayWire(inner, portName, colId) {
	const ov = resolveOverlayPort(inner, portName);
	if (!ov || typeof colId !== 'number' || colId < 0) return false;
	if (ov.spec.dynamic) ov.overlay.addWire(ov.key, colId);
	else ov.overlay.setWire(ov.key, colId);
	return true;
}

/** Clear every wire on an overlay port (shift-click disconnect). */
export function clearOverlayPort(inner, portName) {
	const ov = resolveOverlayPort(inner, portName);
	if (!ov) return false;
	for (const refId of [...ov.overlay.wiredRefIds(ov.key)]) ov.overlay.removeWire(ov.key, refId);
	return true;
}

/** Remove ONE wire from an overlay port (edge delete, picker un-tick). */
export function removeOverlayWire(inner, portName, colId) {
	const ov = resolveOverlayPort(inner, portName);
	if (!ov) return false;
	ov.overlay.removeWire(ov.key, colId);
	return true;
}

/**
 * Swap one wire on an overlay port for another, keeping its position among a
 * dynamic channel's other wires (edge reroute / splice). Returns true only when
 * `oldColId` was actually wired there.
 */
export function rerouteOverlayWire(inner, portName, oldColId, newColId) {
	const ov = resolveOverlayPort(inner, portName);
	if (!ov) return false;
	const ids = ov.overlay.wiredRefIds(ov.key);
	if (!ids.includes(oldColId)) return false;
	for (const id of ids) ov.overlay.removeWire(ov.key, id);
	for (const id of ids) ov.overlay.addWire(ov.key, id === oldColId ? newColId : id);
	return true;
}

/**
 * What the right-click picker shows for an overlay port: `{ many, ids }` (many
 * only for a dynamic channel), or null when the port is not an overlay port.
 */
export function overlayPortSelection(inner, portName) {
	const ov = resolveOverlayPort(inner, portName);
	if (!ov) return null;
	const ids = ov.overlay.wiredRefIds(ov.key).filter((n) => typeof n === 'number' && n >= 0);
	return { many: !!ov.spec.dynamic, ids };
}
