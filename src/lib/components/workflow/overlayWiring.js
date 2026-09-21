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

import {
	resolveOverlayPort,
	isNewLinePort,
	supportsOverlays
} from '$lib/core/ProcessNode.svelte.js';

/**
 * Drop a column on an overlay port: the channel takes it as its ONE wire,
 * replacing any previous wire and clearing typed values (every channel is
 * single since 2026-09-18, a line's `at` included: a second column on a Line
 * is a second Line, dropped on the trailing port below). Returns true when the
 * port was an overlay port.
 *
 * The trailing `ovnew_line` drop port (NEW_LINE_PORT) is the exception: it has
 * no overlay behind it, so a drop CREATES a Line overlay in the default form
 * (vertical) via the plot class's `addOverlay` and wires the column into its
 * `at`. Both happen inside the caller's single recordPlotEdit, so one undo
 * removes the overlay and the wire together. Every drop makes a new overlay.
 */
export function applyOverlayWire(inner, portName, colId) {
	if (typeof colId !== 'number' || colId < 0) return false;
	if (isNewLinePort(portName)) {
		if (!supportsOverlays(inner) || typeof inner.addOverlay !== 'function') return false;
		inner.addOverlay('line').addWire('at', colId);
		return true;
	}
	const ov = resolveOverlayPort(inner, portName);
	if (!ov) return false;
	ov.overlay.setWire(ov.key, colId);
	return true;
}

/** Clear the wire on an overlay port (shift-click disconnect). */
export function clearOverlayPort(inner, portName) {
	const ov = resolveOverlayPort(inner, portName);
	if (!ov) return false;
	for (const refId of [...ov.overlay.wiredRefIds(ov.key)]) ov.overlay.removeWire(ov.key, refId);
	return true;
}

/** Remove the named wire from an overlay port (edge delete, picker un-tick); a foreign colId changes nothing. */
export function removeOverlayWire(inner, portName, colId) {
	const ov = resolveOverlayPort(inner, portName);
	if (!ov) return false;
	ov.overlay.removeWire(ov.key, colId);
	return true;
}

/**
 * Swap the wire on an overlay port for another (edge reroute / splice).
 * Returns true only when `oldColId` was actually wired there.
 */
export function rerouteOverlayWire(inner, portName, oldColId, newColId) {
	const ov = resolveOverlayPort(inner, portName);
	if (!ov) return false;
	if (!ov.overlay.wiredRefIds(ov.key).includes(oldColId)) return false;
	ov.overlay.setWire(ov.key, newColId);
	return true;
}

/**
 * What the right-click picker shows for an overlay port: `{ many: false, ids }`
 * with the wired column (every channel is single; the `ovnew_line` drop port
 * is single and empty), or null when the port is not an overlay port.
 */
export function overlayPortSelection(inner, portName) {
	// The trailing drop port never holds a wire: a single choice creates the
	// overlay and closes the picker (many would keep it open while showing ticks
	// the port does not actually carry).
	if (isNewLinePort(portName)) return supportsOverlays(inner) ? { many: false, ids: [] } : null;
	const ov = resolveOverlayPort(inner, portName);
	if (!ov) return null;
	const ids = ov.overlay.wiredRefIds(ov.key).filter((n) => typeof n === 'number' && n >= 0);
	return { many: false, ids };
}
