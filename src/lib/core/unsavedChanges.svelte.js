// @ts-nocheck
// "Does closing this tab lose anything?" and the beforeunload guard that asks (ROB-5).
//
// Closing or reloading the tab with work open used to lose it without a word. The browser's
// own "Leave site? Changes you made may not be saved." prompt is the one reliable last chance,
// and it only makes sense when there IS something unsaved: a prompt on every close (an
// untouched demo, a session just opened or just saved) teaches people to click through it.
// Autosave (autosave.svelte.js) does not replace the prompt: it is off in ephemeral mode,
// when turned off, and when a session is too big for browser storage, and a copy in the
// browser is not a file the user has.
//
// The same definition of "unsaved" drives autosave: a copy is kept exactly while the
// session has unsaved changes, and removed once it is saved or replaced.
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
/** Called after every counted change (see onSessionChange). */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- listener registry, never rendered
const changeListeners = new Set();

function bump() {
	revision++;
	for (const fn of changeListeners) {
		try {
			fn();
		} catch (err) {
			console.error('A session-change listener failed:', err);
		}
	}
}

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
	addStateChangeHook(bump);
	markSessionSaved();
}

/**
 * Where the session is now, to be passed to markSessionSaved once a save that started now has
 * finished. A save to a file is asynchronous (the browser's save dialog, then the write), and
 * an edit made while it runs is not in the file, so it must still count as unsaved.
 * @returns {{ revision: number, shape: string }}
 */
export function sessionSavePoint() {
	return { revision, shape: sessionShape() };
}

/**
 * The open session now matches what was last saved or loaded.
 * @param {{ revision: number, shape: string }} [point]  from sessionSavePoint(), when the save
 *   started earlier than now; omitted means "as it is now".
 */
export function markSessionSaved(point) {
	savedRevision = point ? point.revision : revision;
	savedShape = point ? point.shape : sessionShape();
}

/**
 * A cheap fingerprint of "what has changed": the revision counter and the session's shape.
 * Autosave compares it with the one it last wrote, so it rewrites only when something did.
 */
export function sessionChangeFingerprint() {
	return `${revision}#${sessionShape()}`;
}

/**
 * Run `fn` after every recorded change (operations, undo/redo and markSessionEdited). Changes of
 * shape alone (an import) are not announced; a caller that needs them polls
 * sessionChangeFingerprint(). Returns the remover.
 */
export function onSessionChange(fn) {
	changeListeners.add(fn);
	return () => changeListeners.delete(fn);
}

/**
 * The user changed something that is neither an operation nor a change of shape (a node
 * moved, resized or collapsed). Call it once, when the gesture ends; see point 3 above.
 */
export function markSessionEdited() {
	bump();
}

/**
 * The open session exists nowhere else, whatever it was loaded from. Used after restoring the
 * crash copy: the load marks it saved, but the only other copy (the crash snapshot) is
 * deleted once restored, so closing the tab would lose it.
 */
export function markSessionUnsaved() {
	savedShape = null;
	// Announced like an edit, so autosave keeps the only copy promptly.
	bump();
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
	bump();
}
