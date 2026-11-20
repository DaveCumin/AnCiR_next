// @ts-nocheck
// Saving the session to a file (UI-15): Save and Save as.
//
// WHERE THE BROWSER HAS A SAVE DIALOG (window.showSaveFilePicker: Chrome, Edge and other
// Chromium browsers; https://developer.mozilla.org/docs/Web/API/Window/showSaveFilePicker)
//
//   Save      the first time, the browser's own save dialog, suggesting
//             "<name> <YYYY-MM-DD>.ancir" (sessionFiles.js). The file handle it returns is kept
//             (saveTarget.svelte.js), and every later Save writes to that file with no dialog.
//             A session opened through the start screen's file picker saves back to its file.
//   Save as   always the dialog, starting in the current file's folder, and from then on Save
//             writes to the newly chosen file.
//
//   Cancelling the dialog does nothing: no message, no download.
//   Permission: a kept handle may need write permission again (after a reload, or for a file
//             that was opened for reading); the browser asks, and a refusal is reported and
//             saves nothing ("Save as" chooses another file).
//   A kept file that was moved, renamed or deleted: the dialog opens so the user can choose
//             where to save it.
//   Anything else that goes wrong (the dialog cannot open, the write fails): a clear message,
//             and the session is downloaded instead, so a failed save never loses the work.
//   Writes go through createWritable(), which writes a temporary file and swaps it in on
//             close, so a write that fails part way leaves the previous file intact
//             (https://developer.mozilla.org/docs/Web/API/FileSystemFileHandle/createWritable).
//
// ELSEWHERE (Firefox, Safari): Save downloads "<name> <YYYY-MM-DD>.ancir", exactly as before;
// Save as does the same.
//
// After any save, the session counts as saved (unsavedChanges), the crash copy and the
// autosaved copy are deleted (the file is the copy), and a dialog-saved file joins the recent
// sessions with its handle.
import { core, outputCoreAsJson } from './core.svelte.js';
import { addNotification, removeNotification } from './notifications.svelte.js';
import { markSessionSaved, sessionSavePoint } from './unsavedChanges.svelte.js';
import { clearCrashSnapshot } from './errorReporter.js';
import {
	SESSION_SAVE_EXTENSION,
	sessionBaseName,
	sessionNameForSave,
	sessionSaveFileName
} from './sessionFiles.js';
import { getSaveHandle, setSaveTarget, clearSaveTarget, saveTarget } from './saveTarget.svelte.js';
import { autosaveAfterSave } from './autosave.svelte.js';
import { downloadBlob } from '$lib/utils/downloadBlob.js';
import { recordRecentFile, sessionCounts } from '$lib/start/recentSessions.svelte.js';

/** For showSaveFilePicker({ types }). Saving always writes `.ancir`; opening accepts `.json` too. */
export const SESSION_SAVE_TYPES = [
	{ description: 'AnCiR session', accept: { 'application/json': [SESSION_SAVE_EXTENSION] } }
];

/** The save dialog remembers the folder it was last used in under this id. */
const PICKER_ID = 'ancir-session';

/** Does this browser have a save dialog the page can open? */
export function supportsSaveDialog() {
	return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
}

/** The name the dialog suggests: the current file's name with today's date, else the data's. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a timestamp read once to name a file, not reactive state
export function suggestedSaveName(date = new Date()) {
	const base = saveTarget.fileName
		? sessionBaseName(saveTarget.fileName)
		: sessionNameForSave(core);
	return sessionSaveFileName(base, date);
}

/** Errors meaning the kept file is no longer where it was, or no longer writable by us. */
function fileIsGone(err) {
	return err?.name === 'NotFoundError' || err?.name === 'NotAllowedError';
}

/** Write permission for a kept handle: 'granted', 'denied' or 'prompt' (refused to ask). */
async function writePermission(handle) {
	const opts = { mode: 'readwrite' };
	if (typeof handle.queryPermission !== 'function') return 'granted';
	let state = await handle.queryPermission(opts);
	if (state === 'prompt' && typeof handle.requestPermission === 'function') {
		state = await handle.requestPermission(opts);
	}
	return state;
}

async function writeFile(handle, json) {
	const writable = await handle.createWritable();
	try {
		await writable.write(new Blob([json], { type: 'application/json' }));
		await writable.close();
	} catch (err) {
		try {
			await writable.abort();
		} catch {
			/* already closed or errored */
		}
		throw err;
	}
}

/** Everything a successful save does besides writing. */
function afterSave(point, fileName) {
	// The open session is now in a file: nothing to warn about on close (ROB-5), and a crash copy
	// or autosaved copy kept from earlier is older than the file, so neither is offered back.
	markSessionSaved(point);
	clearCrashSnapshot();
	void autosaveAfterSave();
	// One "saved" message at a time: pressing Cmd/Ctrl+S repeatedly replaces it rather than
	// stacking identical toasts up the screen.
	if (lastSavedToast) removeNotification(lastSavedToast);
	lastSavedToast = addNotification(`Session saved as "${fileName}".`, 'info');
}

let lastSavedToast = null;

/** The download route: browsers without a save dialog, and the fallback when it fails. */
function download(json, fileName, point) {
	downloadBlob(fileName, new Blob([json], { type: 'application/json' }));
	afterSave(point, fileName);
	return { status: 'downloaded', fileName };
}

function fallBackToDownload(json, fileName, point, err, what) {
	console.error(`Saving through the save dialog failed (${what}):`, err);
	const result = download(json, fileName, point);
	addNotification(
		`Could not ${what}: ${err?.message ?? err}\n\nThe session was downloaded as "${fileName}" ` +
			'instead, so nothing is lost. Check your downloads folder.',
		'warning',
		15000
	);
	return { ...result, status: 'fallback' };
}

/** Open the save dialog. Resolves a handle, or null when the user cancelled. */
async function pickFile(suggestedName, startIn) {
	try {
		return await window.showSaveFilePicker({
			suggestedName,
			types: SESSION_SAVE_TYPES,
			id: PICKER_ID,
			...(startIn ? { startIn } : {})
		});
	} catch (err) {
		if (err?.name === 'AbortError') return null;
		throw err;
	}
}

async function saveThroughDialog({ json, point, saveAs }) {
	const fileName = suggestedSaveName();
	const kept = getSaveHandle();
	let handle = saveAs ? null : kept;

	if (handle) {
		let permission;
		try {
			permission = await writePermission(handle);
		} catch (err) {
			permission = fileIsGone(err) ? 'gone' : 'error';
		}
		if (permission === 'denied') {
			addNotification(
				`AnCiR was not given permission to write to "${handle.name}", so the session was not ` +
					'saved. Use Save as to choose another file.',
				'warning',
				10000
			);
			return { status: 'denied' };
		}
		if (permission !== 'granted') handle = null;
	}

	let chosenNow = false;
	if (!handle) {
		try {
			// Save as starts in the current file's folder. A kept file that has gone cannot be a
			// starting point; the dialog then opens where it was last used (PICKER_ID).
			handle = await pickFile(fileName, saveAs && kept ? kept : undefined);
		} catch (err) {
			return fallBackToDownload(json, fileName, point, err, 'open the save dialog');
		}
		if (!handle) return { status: 'cancelled' };
		chosenNow = true;
	}

	try {
		await writeFile(handle, json);
	} catch (err) {
		if (!chosenNow && fileIsGone(err)) {
			// The kept file was moved, renamed or deleted since the last save: ask where to save.
			clearSaveTarget();
			let again;
			try {
				again = await pickFile(fileName, undefined);
			} catch (pickErr) {
				return fallBackToDownload(json, fileName, point, pickErr, `save to "${handle.name}"`);
			}
			if (!again) {
				addNotification(
					`"${handle.name}" could not be found (it may have been moved, renamed or deleted), ` +
						'and the session was not saved.',
					'warning',
					10000
				);
				return { status: 'cancelled' };
			}
			handle = again;
			try {
				await writeFile(handle, json);
			} catch (err2) {
				return fallBackToDownload(json, fileName, point, err2, `write "${handle.name}"`);
			}
		} else {
			return fallBackToDownload(json, fileName, point, err, `write "${handle.name}"`);
		}
	}

	setSaveTarget(handle);
	afterSave(point, handle.name);
	// The saved file joins the start screen's recent files with its handle, as an opened file
	// does (the same file keeps one row), so it reopens in one click.
	recordRecentFile(handle, { action: 'saved', meta: sessionCounts(core) }).catch(() => {});
	return { status: 'saved', fileName: handle.name };
}

let inFlight = null;

/**
 * Save the open session (Save; with `saveAs`, Save as).
 *
 * In a browser without a save dialog this runs synchronously up to and including the
 * download; the returned promise is already settled.
 *
 * @param {{ saveAs?: boolean }} [opts]
 * @returns {Promise<{ status: 'saved'|'downloaded'|'fallback'|'cancelled'|'denied'|'error'|'busy', fileName?: string }>}
 */
export function saveSession({ saveAs = false } = {}) {
	// A second Save while the dialog is still open must not open another one.
	if (inFlight) return Promise.resolve({ status: 'busy' });
	let json;
	try {
		// outputCoreAsJson builds this with JSON.stringify, so it is valid JSON by construction.
		json = outputCoreAsJson();
		if (typeof json !== 'string' || !json) {
			throw new Error('Invalid or empty JSON string returned by outputCoreAsJson');
		}
	} catch (error) {
		console.error('Failed to save the session:', error?.message ?? error);
		addNotification('Could not save the session: ' + (error?.message ?? error));
		return Promise.resolve({ status: 'error' });
	}
	// The file holds the session as it is NOW; edits made while the dialog is open are not in
	// it, so they must still count as unsaved afterwards.
	const point = sessionSavePoint();

	if (!supportsSaveDialog()) {
		return Promise.resolve(download(json, suggestedSaveName(), point));
	}
	inFlight = saveThroughDialog({ json, point, saveAs })
		.catch((err) => fallBackToDownload(json, suggestedSaveName(), point, err, 'save the session'))
		.finally(() => {
			inFlight = null;
		});
	return inFlight;
}
