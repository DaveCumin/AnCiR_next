// @ts-nocheck
// The file the open session saves to (UI-15).
//
// Where the browser has the File System Access API (Chromium), Save opens the browser's own
// save dialog once and keeps the FileSystemFileHandle it returns; every later Save writes to
// that file without asking. A session opened from a file through the start screen's picker
// adopts that file's handle the same way, which is what Save means in a desktop program.
//
// Held here, apart from the save logic (sessionSave.svelte.js), because the session loader,
// New session and autosave all need to set or read it, and none of them should import the
// save machinery to do so.
//
// The handle is a live capability, so it lives in a plain variable (never proxied by $state,
// never serialised into a session). Only its NAME is reactive, for the page title and the Save
// button's tooltip.

let handle = null;

/**
 * `fileName` is the file's name ("study 2026-11-20.ancir"), or null when there is no file yet.
 * `label` is what the session was opened as (an example's title, or the name of a file opened
 * without a handle), so an autosaved copy of it can be called something better than
 * "AnCiR session". Neither is saved in the session.
 */
export const saveTarget = $state({ fileName: null, label: null });

/** The FileSystemFileHandle Save writes to, or null. */
export function getSaveHandle() {
	return handle;
}

/** From now on, Save writes to this file. */
export function setSaveTarget(fileHandle) {
	handle = fileHandle ?? null;
	saveTarget.fileName = fileHandle?.name ?? null;
}

/** The open session is no longer that file (a different session was loaded, or a new one). */
export function clearSaveTarget() {
	handle = null;
	saveTarget.fileName = null;
	saveTarget.label = null;
}

/** What the session just loaded was opened as: an example's title or a file's name. */
export function setSessionLabel(label) {
	saveTarget.label = typeof label === 'string' && label.trim() ? label.trim() : null;
}
