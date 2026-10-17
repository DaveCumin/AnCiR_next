// Pure compact-node geometry + icon mapping. Imported by both WorkflowEditor
// (port anchoring / sizing) and CompactNode (rendering) so the rendered dot and
// the edge anchor agree. No Svelte/runtime state here — keep it unit-testable.

// The compact geometry lives in nodeRows.js with the detailed rows (one source for both).
export {
	COMPACT_W,
	COMPACT_PORT_H,
	COMPACT_V_PAD,
	compactNodeHeight,
	compactPortAnchorY
} from './nodeRows.js';

// Node kinds whose compact/detailed state is tracked via expandedNodeIds.
// Plots always show their chart (never compact); notes are plain text. Groups
// collapse too, but via their own persisted `collapsed` flag (handled in
// WorkflowEditor.isCompact), not this set.
export const SQUARED_KINDS = new Set(['data', 'process', 'tableprocess']);

// Column type to icon name: one shared map for the type selector and every node.
export { columnTypeIcon } from '$lib/utils/columnTypeIcon.js';
