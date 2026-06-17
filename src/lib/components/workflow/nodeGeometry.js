// Pure compact-node geometry + icon mapping. Imported by both WorkflowEditor
// (port anchoring / sizing) and CompactNode (rendering) so the rendered dot and
// the edge anchor agree. No Svelte/runtime state here — keep it unit-testable.

export const COMPACT_W = 56; // px — compact square width (fixed)
export const COMPACT_PORT_H = 18; // px — vertical step per port in compact mode
export const COMPACT_V_PAD = 12; // px — total vertical padding around the port stack

// Node kinds whose compact/detailed state is tracked via expandedNodeIds.
// Plots always show their chart (never compact); notes are plain text. Groups
// collapse too, but via their own persisted `collapsed` flag (handled in
// WorkflowEditor.isCompact), not this set.
export const SQUARED_KINDS = new Set(['data', 'process', 'tableprocess']);

/** Compact body height: a square unless one side has enough ports to need more. */
export function compactNodeHeight(nInputs = 0, nOutputs = 0) {
	const sideMax = Math.max(nInputs, nOutputs, 1);
	return Math.max(COMPACT_W, sideMax * COMPACT_PORT_H + COMPACT_V_PAD);
}

/** Center-Y of port `slot` of `sideCount` ports, as a vertically centered stack. */
export function compactPortAnchorY(slot, sideCount, height) {
	const count = Math.max(1, sideCount);
	const stack = count * COMPACT_PORT_H;
	const topPad = (height - stack) / 2;
	return topPad + slot * COMPACT_PORT_H + COMPACT_PORT_H / 2;
}

// Column-type → icon name. Mirrors TableProcessNode's TYPE_ICON, plus 'category'
// (which TypeSelector renders with the 'list' glyph).
export const COLUMN_TYPE_ICON = {
	number: 'math',
	category: 'list',
	time: 'clock',
	bin: 'table'
};

export function columnTypeIcon(type) {
	return COLUMN_TYPE_ICON[type] ?? 'math';
}
