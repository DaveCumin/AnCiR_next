// @ts-nocheck
// sessionLoad.svelte.js: the guard rails every "open a session" entry point shares.
//
// importJson (Setting.svelte) is the one function that builds a session into `core`. It used to
// empty `core` first and parse second, so dropping a data file, `{}`, `[]` or a session with one
// broken node destroyed the open work with no way back (review ROB-1). The pieces here let it,
// and the entry points in front of it, refuse early and ask first:
//
//   sessionShapeProblem  what is wrong with a parsed JSON value as a SESSION (null = nothing).
//                        importJson throws NotASessionError on it before touching anything.
//   sessionHasContent    whether replacing the current session would lose anything.
//   confirmReplaceSession  ask (in the app's own AreYouSure dialog) before replacing work.
//   snapshotSession / restoreSession  the rollback importJson uses when a build fails half way.
//   compareAppVersions   'β.78.1' style version ordering, for the newer-file warning (ROB-22).
import { core, appState } from './core.svelte.js';
import { looksLikeSession } from '$lib/utils/fileTypeSniff.js';

/** Thrown by importJson when the value is not a session at all (nothing was changed). */
export class NotASessionError extends Error {
	constructor(reason) {
		super(`This file is not an AnCiR session (${reason}).`);
		this.name = 'NotASessionError';
		this.reason = reason;
	}
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Why a parsed JSON value cannot be loaded as a session, or null when it can.
 *
 * Structural only: it rejects what can never be a session (an array, a primitive, columnar or
 * row data, `{}`) and fields of the wrong TYPE, which is what used to crash importJson after it
 * had already emptied the session. A field that is merely absent is fine (older sessions lack
 * most of them). Whatever slips past this and still throws mid-build is caught by importJson's
 * rollback, so this is the cheap first line, not the only one.
 */
export function sessionShapeProblem(json) {
	if (Array.isArray(json)) return 'it is a JSON array, not a session object';
	if (!isPlainObject(json)) return 'it is not a JSON object';
	const hasData = Array.isArray(json.data);
	const hasRaw = isPlainObject(json.rawData);
	const hasTables = Array.isArray(json.tables);
	if (!hasData && !hasRaw && !hasTables) {
		return 'it has no "data" list of columns';
	}
	if ('data' in json && !hasData) return '"data" is not a list';
	if (hasData && json.data.some((c) => !isPlainObject(c))) {
		return '"data" holds values, not column records';
	}
	if ('rawData' in json && json.rawData != null && !hasRaw) return '"rawData" is not an object';
	for (const key of ['tableProcesses', 'plots', 'groups', 'notes', 'composites', 'tables']) {
		if (key in json && json[key] != null) {
			if (!Array.isArray(json[key])) return `"${key}" is not a list`;
			if (json[key].some((e) => !isPlainObject(e))) return `"${key}" holds a non-object entry`;
		}
	}
	return null;
}

/**
 * The test the canvas drop uses to decide between "load as a session" and "hand it to the data
 * importer". It deliberately reuses the Import modal's own predicate, so the two routes can never
 * disagree and bounce a file between them.
 */
export function isSessionJson(json) {
	return looksLikeSession(json);
}

/** True when the open session holds anything that replacing it would lose. */
export function sessionHasContent() {
	return (
		(core.data?.length ?? 0) > 0 ||
		(core.tableProcesses?.length ?? 0) > 0 ||
		(core.plots?.length ?? 0) > 0 ||
		(core.notes?.length ?? 0) > 0 ||
		(core.groups?.length ?? 0) > 0 ||
		(core.orphanProcesses?.length ?? 0) > 0 ||
		(core.unrestoredPlots?.length ?? 0) > 0
	);
}

export const REPLACE_LABEL = 'Replace session';
const CANCEL_LABEL = 'Cancel';

/**
 * Ask before a load replaces the open session. Resolves true straight away when there is nothing
 * to lose, so loading into an empty app (first visit, a deep link on page load) never asks.
 *
 * Uses the app's AreYouSure dialog. A dialog closed WITHOUT a choice (Escape, which closes the
 * native dialog without running the button callback) resolves false, so a cancelled confirm can
 * never leave a load waiting forever.
 *
 * @param {string} [what] how the incoming session is described, e.g. `"rest-activity.json"`.
 * @returns {Promise<boolean>}
 */
export function confirmReplaceSession(what) {
	if (!sessionHasContent()) return Promise.resolve(true);
	return new Promise((resolve) => {
		let settled = false;
		let stopWatching = null;
		const done = (answer) => {
			if (settled) return;
			settled = true;
			// Disposed on a microtask: done() can run inside the watcher's own effect.
			queueMicrotask(() => stopWatching?.());
			resolve(answer);
		};
		// Short: AreYouSure is a small dialog. "discarded" also gives the confirm button the
		// destructive style.
		appState.AYStext = `Open ${what ?? 'this session'}? Unsaved changes will be discarded.`;
		appState.AYSoptions = [REPLACE_LABEL, CANCEL_LABEL];
		appState.AYScallback = (choice) => done(choice === REPLACE_LABEL);
		appState.showAYSModal = true;
		let seenOpen = false;
		stopWatching = $effect.root(() => {
			$effect(() => {
				const open = appState.showAYSModal;
				if (open) seenOpen = true;
				// The buttons run their callback BEFORE closing, so a choice always wins this race.
				else if (seenOpen) done(false);
			});
		});
	});
}

/**
 * Shallow snapshot of everything importJson replaces. Shallow on purpose: the old Column /
 * TableProcess / Plot instances are kept by identity, so restoring them brings back the live
 * session exactly, not a re-serialised copy of it.
 */
export function snapshotSession() {
	const coreSnap = {};
	for (const key of Object.keys(core)) coreSnap[key] = core[key];
	const appSnap = {};
	for (const key of Object.keys(appState)) {
		if (key === 'loadingState') continue;
		appSnap[key] = appState[key];
	}
	return { core: coreSnap, appState: appSnap };
}

/** Put back a snapshotSession(), dropping any core key the failed load added. */
export function restoreSession(snap) {
	for (const key of Object.keys(core)) {
		if (!(key in snap.core)) delete core[key];
	}
	for (const [key, value] of Object.entries(snap.core)) core[key] = value;
	for (const [key, value] of Object.entries(snap.appState)) {
		if (appState[key] !== value) appState[key] = value;
	}
}

/** Numeric parts of a version string: 'β.78.1' -> [78, 1]; null when there are none. */
function versionParts(v) {
	if (typeof v !== 'string' && typeof v !== 'number') return null;
	const parts = String(v).match(/\d+/g);
	return parts ? parts.map(Number) : null;
}

/**
 * Order two app versions by their numeric parts. Returns 1 when a is newer, -1 when older,
 * 0 when equal OR when either cannot be read (an unreadable version is not a reason to warn).
 */
export function compareAppVersions(a, b) {
	const pa = versionParts(a);
	const pb = versionParts(b);
	if (!pa || !pb) return 0;
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const x = pa[i] ?? 0;
		const y = pb[i] ?? 0;
		if (x !== y) return x > y ? 1 : -1;
	}
	return 0;
}
