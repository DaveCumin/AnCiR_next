// @ts-nocheck
// Single source of truth for reading and renaming the user-facing *name* of a canvas node,
// used by every rename editor (the node header in WorkflowNode / TableProcessNode / GroupNode,
// the side control panel CanvasNodeControls, the Data panel's node rows, the plot title on the
// workspace and the plot's control banner) so they stay identical and reactive.
//
// A rename is ONE operation, applied when the edit is committed (Enter or blur), never per
// keystroke: an undo step that counts as an unsaved change. Nothing is written while typing,
// so Escape (which commits nothing) leaves the name as it was. Columns go through
// columnLabels.commitColumnRename; every other node through commitNodeRename, which applies a
// renameNode op (operations.js). An empty field gives the node its default name back: what a
// new node of its kind is called (nodeDefaultName).
//
// nodeNaming.guard.test.js fails on a new editor that writes a node's name directly.
import { getColumnById } from './Column.svelte';
import { commitColumnRename } from './columnLabels.js';
import { appConsts } from './core.svelte.js';
import { applyOp } from './operations.js';

// Node types whose name the user can rename inline.
const EDITABLE_TYPES = new Set(['data', 'process', 'tableprocess', 'plot', 'group', 'composite']);

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

/**
 * The name a node of this kind gets when it has none: what a new one is called. A plot's is its
 * type's display name and id (Plot's constructor), an analysis or column process's its
 * registry display name, a group's "Group", a composite's "Composite".
 */
export function nodeDefaultName(target, obj) {
	switch (target) {
		case 'plot':
			return `${obj?.typeDisplayName || obj?.type || 'Plot'}_${obj?.id}`;
		case 'tableprocess':
			return appConsts.tableProcessMap?.get(obj?.name)?.displayName || obj?.name || '';
		case 'process':
			return appConsts.processMap?.get(obj?.name)?.displayName || obj?.name || '';
		case 'group':
			return 'Group';
		case 'composite':
			return 'Composite';
	}
	return '';
}

/**
 * Commit a node rename typed into one of the editors: ONE renameNode operation (an undo step,
 * and the session counts as edited). Trimmed; an empty field restores the default name. Call
 * it once, when the edit is committed. Returns the inverse op, or null when nothing changed.
 *
 * @param {'plot'|'tableprocess'|'process'|'group'|'composite'} target
 * @param {object} obj the plot, table process, process, group or composite
 * @param {string} next the text in the field
 */
export function commitNodeRename(target, obj, next) {
	if (!obj) return null;
	const trimmed = (next ?? '').trim();
	const name = trimmed === '' ? nodeDefaultName(target, obj) : trimmed;
	if (!name) return null;
	return applyOp({ kind: 'renameNode', target, id: obj.id, name });
}

// The kind and object behind a canvas node, for commitNodeRename.
function renameTargetOf(node) {
	switch (node?.type) {
		case 'process':
			return ['process', node.processObj];
		case 'tableprocess':
			return ['tableprocess', node.tpObj];
		case 'plot':
			return ['plot', node.plotObj];
		case 'group':
			return ['group', node.groupObj];
		case 'composite':
			return ['composite', node.compositeObj];
	}
	return [null, null];
}

/**
 * Rename a canvas node from an editor. Only a committed edit (`commit: true`, on Enter or blur)
 * writes, as one operation; a live call while typing writes nothing, so Escape needs no undo of
 * its own. A data node's column goes through commitColumnRename.
 */
export function setNodeName(node, next, { commit = false } = {}) {
	if (!node || !commit) return;
	if (node.type === 'data') {
		const col = node.refId != null ? getColumnById(node.refId) : null;
		// An empty field restores the auto-derived name (customName = null); see
		// columnLabels.commitColumnRename.
		if (col) commitColumnRename(col, next ?? '');
		return;
	}
	const [target, obj] = renameTargetOf(node);
	if (target) commitNodeRename(target, obj, next);
}
