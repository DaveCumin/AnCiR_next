// @ts-nocheck
// "Does closing this tab lose anything?" and the beforeunload guard that asks (ROB-5).
//
// AnCiR has no autosave, so closing or reloading the tab with work open lost it without a
// word. The browser's own "Leave site? Changes you made may not be saved." prompt is the one
// reliable last chance, and it only makes sense when there IS something unsaved: a prompt on
// every close (an untouched demo, a session just opened or just saved) teaches people to
// click through it.
//
// WHAT COUNTS AS UNSAVED
//
// The app has no single "dirty" flag, so this tracks the two ways a session changes:
//
//   1. Every graph operation, user edit, undo and redo. All of them go through applyOp or
//      recordGraphMutation, whose state-change hook fires even while the history is muted
//      (operations.js addStateChangeHook). Each one bumps a revision counter.
//   2. Things that are not operations, chiefly importing data (pushObj straight into core).
//      These change the session's SHAPE: how many columns, analyses, plots, notes and
//      groups it has, and the highest column id (which also moves when a column is replaced).
//   3. User edits that are neither: moving, resizing or collapsing a node on the workflow
//      canvas (core.nodeLayout), a group card or a note. Their callers call
//      markSessionEdited() where the USER's gesture ends. Not from an effect that watches the
//      layout: the canvas also rewrites core.nodeLayout by itself while a session loads
//      (adopting the saved layout, placing nodes the file has no position for, pushing apart
//      overlaps), and none of that may count, or every opened example would ask.
//
// The session is "saved" at the revision and shape recorded by markSessionSaved(), which the
// session save (exportJson) and a successful session load (importJson) call. Anything since
// then is unsaved. An empty session never is.
//
// It is a proxy, and errs towards asking: a change that is undone again still counts, and a
// computed node rewriting its own outputs after a load counts once the load has finished. It
// never misses a recorded edit. It can miss a change that is neither an operation, nor a
// change of shape, nor marked by its caller (point 3); a load is one, and marks the session
// saved anyway.
import { addStateChangeHook } from './operations.js';
import { core } from './core.svelte.js';
import { sessionHasContent } from './sessionLoad.svelte.js';

let revision = 0;
let savedRevision = 0;
let savedShape = null;
let installed = false;

/** A cheap fingerprint of the session's structure. */
export function sessionShape() {
	let maxColumnId = -1;
	for (const c of core.data ?? [])
		if (typeof c?.id === 'number' && c.id > maxColumnId) maxColumnId = c.id;
	return [
		core.data?.length ?? 0,
		core.tableProcesses?.length ?? 0,
		core.plots?.length ?? 0,
		core.notes?.length ?? 0,
		core.groups?.length ?? 0,
		core.orphanProcesses?.length ?? 0,
		maxColumnId
	].join('|');
}

/** Start counting changes. Idempotent; the hook is app-lifetime, like the op history's. */
export function initUnsavedChanges() {
	if (installed) return;
	installed = true;
	addStateChangeHook(() => {
		revision++;
	});
	markSessionSaved();
}

/** The open session now matches what was last saved or loaded. */
export function markSessionSaved() {
	savedRevision = revision;
	savedShape = sessionShape();
}

/**
 * The user changed something that is neither an operation nor a change of shape (a node
 * moved, resized or collapsed). Call it once, when the gesture ends; see point 3 above.
 */
export function markSessionEdited() {
	revision++;
}

/**
 * The open session exists nowhere else, whatever it was loaded from. Used after restoring the
 * crash copy: the load marks it saved, but the only other copy (the crash snapshot) is
 * deleted once restored, so closing the tab would lose it.
 */
export function markSessionUnsaved() {
	savedShape = null;
}

/** True when closing the tab now would lose work. */
export function hasUnsavedChanges() {
	if (!sessionHasContent()) return false;
	if (savedShape == null) return true;
	return revision !== savedRevision || sessionShape() !== savedShape;
}

/**
 * Ask before the tab closes or reloads with unsaved work. Returns the remover.
 *
 * The prompt's wording is the browser's own (no page can set it any more). Calling
 * preventDefault is the standard way to ask; returnValue is set too for the browsers that
 * still look at it.
 */
export function installUnloadGuard(target = typeof window !== 'undefined' ? window : null) {
	if (!target) return () => {};
	const onBeforeUnload = (e) => {
		if (!hasUnsavedChanges()) return undefined;
		e.preventDefault();
		e.returnValue = '';
		return '';
	};
	target.addEventListener('beforeunload', onBeforeUnload);
	return () => target.removeEventListener('beforeunload', onBeforeUnload);
}

/** Test seam. */
export function _bumpRevisionForTest() {
	revision++;
}
