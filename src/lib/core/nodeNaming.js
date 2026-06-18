// @ts-nocheck
// Single source of truth for reading/writing the user-facing *name* of a
// canvas node, used by both the node header (WorkflowNode / TableProcessNode /
// GroupNode) and the side control panel (CanvasNodeControls) so the two views
// stay byte-for-byte identical and reactive.
//
// Two write modes:
//   - live   (commit = false): write the raw text on every keystroke so both
//                               views update immediately as the user types.
//   - commit (commit = true):  normalise on blur/Enter — trim and fall back to
//                               the type's default when the field is left empty.
import { getColumnById } from './Column.svelte';

// Node types whose name the user can rename inline.
const EDITABLE_TYPES = new Set([
	'data',
	'process',
	'tableprocess',
	'plot',
	'group',
	'composite'
]);

export function isNodeNameEditable(node) {
	return !!node && EDITABLE_TYPES.has(node.type);
}

// Current display name for the node, resolved from the live underlying object
// (column / process / tp / plot / group / composite) rather than the cached
// node.label, so edits reflect without waiting for a graph rebuild.
export function getNodeName(node) {
	if (!node) return '';
	switch (node.type) {
		case 'data': {
			const col = node.refId != null ? getColumnById(node.refId) : null;
			return col?.name ?? node.label;
		}
		case 'process':
			return node.processObj?.displayName || node.processObj?.name || node.label;
		case 'tableprocess':
			return node.tpObj?.displayName || node.tpObj?.name || node.label;
		case 'plot':
			return node.plotObj?.name ?? node.label;
		case 'group':
			return node.groupObj?.name ?? node.label;
		case 'composite':
			return node.compositeObj?.name ?? node.label;
		default:
			return node.label;
	}
}

// Write the node's name. `commit` toggles normalisation (see file header).
export function setNodeName(node, next, { commit = false } = {}) {
	if (!node) return;
	const raw = next ?? '';
	const trimmed = raw.trim();
	switch (node.type) {
		case 'data': {
			const col = node.refId != null ? getColumnById(node.refId) : null;
			if (!col) return;
			// On commit an empty field restores the auto-derived name (customName = null).
			if (commit) col.customName = trimmed === '' ? null : trimmed;
			else col.customName = raw;
			return;
		}
		case 'process': {
			const p = node.processObj;
			if (!p) return;
			p.displayName = commit && trimmed === '' ? p.name : raw;
			return;
		}
		case 'tableprocess': {
			const tp = node.tpObj;
			if (!tp) return;
			tp.displayName = commit && trimmed === '' ? tp.name : raw;
			return;
		}
		case 'plot': {
			const plot = node.plotObj;
			if (!plot) return;
			if (commit && trimmed === '') return; // keep last good name
			plot.name = raw;
			return;
		}
		case 'group': {
			const g = node.groupObj;
			if (!g) return;
			g.name = commit && trimmed === '' ? 'Group' : raw;
			return;
		}
		case 'composite': {
			const comp = node.compositeObj;
			if (!comp) return;
			comp.name = commit && trimmed === '' ? 'Composite' : raw;
			return;
		}
	}
}
