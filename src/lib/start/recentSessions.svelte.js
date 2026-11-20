// @ts-nocheck
// Recent files for the start screen: session files the user saved or opened in this browser
// through a file handle, so each reopens in one click.
//
// WHAT IS LISTED (David, 2026-11-21, bringing back the list removed in v64.0)
//
// Only files AnCiR holds a FileSystemFileHandle for: saved through the save dialog
// (sessionSave.svelte.js) or opened through the start screen's file picker (startActions.js).
// That means Chromium browsers; Firefox and Safari give a page no handles, so they have no
// Recent list rather than a list of names that cannot be reopened. Examples are not recorded:
// they are on the start screen already. The index holds exactly what the list shows, so
// nothing accumulates where the user can neither see nor clear it (the v64.0 follow-up).
//
// STORAGE SPLIT (and a deliberate departure from "cache the payload"):
//
//   • localStorage (through localData's `store`): the INDEX only. A small array of
//     {id, name, fileName, ts, action, meta, thumb}. Synchronous, string-only, ~5 MB ceiling,
//     so it must never see a time series.
//   • IndexedDB `ancir-recents`: the FileSystemFileHandle for each entry. Handles are
//     structured-cloneable but NOT JSON-serialisable, which is exactly why they need IDB.
//
// We do NOT cache session payloads here (the autosaved copies are a separate, deliberate store:
// autosave.svelte.js). Keeping only a handle means the data stays in the user's own file and
// `clearRecents()` is trivially complete. In ephemeral mode nothing is recorded: a handle is
// file identity plus the capability to reopen it, which is what that mode exists to not keep.
//
// A browser never tells a page where a file is (no path, no folder name), so a row cannot say
// which folder its file is in. Two different files with the same name are told apart with
// FileSystemHandle.isSameEntry and kept as two rows.

import { store, privacy } from '$lib/core/localData.svelte.js';
import { sessionBaseName } from '$lib/core/sessionFiles.js';
import { thumbnailForWorkflow } from '$lib/start/thumbnails.js';

const INDEX_KEY = 'ancir.recents.v1';
const DB_NAME = 'ancir-recents';
const DB_VERSION = 1;
const STORE = 'handles';
export const MAX_RECENTS = 8;
const FILE_PREFIX = 'file::';

/** Reactive view of the index; components read this directly. */
export const recents = $state({ items: [] });

const hasWindow = () => typeof window !== 'undefined';

/** Does this browser give us re-openable file handles? */
export function supportsFileHandles() {
	return hasWindow() && typeof window.showOpenFilePicker === 'function';
}

/** "12 columns · 3 plots" for a row, from the session as it is now. */
export function sessionCounts(session) {
	const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
	return [
		plural(session?.data?.length ?? 0, 'column'),
		plural(session?.plots?.length ?? 0, 'plot')
	].join(' · ');
}

// --- localStorage index ------------------------------------------------------

/** A row the list can show: a file with a stored handle. Anything else is from older versions. */
const isFileEntry = (e) =>
	e && typeof e.id === 'string' && e.id.startsWith(FILE_PREFIX) && e.hasHandle === true;

/**
 * Read + normalise the index. Never throws: a corrupt or unavailable store means "no recents".
 * Entries an older version wrote (examples, files opened without a handle) are dropped from the
 * index, with their handles, the first time it is read.
 */
export function loadRecents() {
	if (!hasWindow()) return [];
	let parsed = [];
	try {
		parsed = JSON.parse(store.getItem(INDEX_KEY) ?? '[]');
	} catch {
		parsed = [];
	}
	const all = Array.isArray(parsed) ? parsed : [];
	const items = all
		.filter(isFileEntry)
		.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
		.slice(0, MAX_RECENTS);
	recents.items = items;
	if (items.length !== all.length) {
		persist(items);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local lookup inside one call, never stored or rendered
		const kept = new Set(items.map((e) => e.id));
		for (const e of all) {
			if (e && typeof e.id === 'string' && !kept.has(e.id)) void deleteHandle(e.id);
		}
	}
	return items;
}

function persist(items) {
	recents.items = items;
	if (!hasWindow()) return;
	try {
		if (items.length) store.setItem(INDEX_KEY, JSON.stringify(items));
		else store.removeItem(INDEX_KEY);
	} catch {
		// Quota or private-mode failure: the app must keep working without recents.
	}
}

/**
 * The id for a file's row. The same file keeps its row (so reopening refreshes it in place);
 * a DIFFERENT file with the same name (another folder) gets a row of its own.
 */
async function idForHandle(handle) {
	const base = `${FILE_PREFIX}${handle.name}`;
	const sameName = loadRecents().filter((e) => e.fileName === handle.name);
	for (const e of sameName) {
		const stored = await getHandle(e.id);
		if (!stored) continue;
		try {
			if (await handle.isSameEntry?.(stored)) return e.id;
		} catch {
			/* not comparable: treat as different */
		}
	}
	if (!sameName.some((e) => e.id === base)) return base;
	let n = 2;
	while (sameName.some((e) => e.id === `${base}::${n}`)) n++;
	return `${base}::${n}`;
}

/**
 * Record (or refresh) a file the user just saved or opened, with its handle. Most recent
 * first, capped at MAX_RECENTS, evicting the oldest along with its stored handle.
 *
 * Records nothing in ephemeral mode, without a handle, or when the handle cannot be stored:
 * a row that cannot reopen its file is not worth showing.
 *
 * @param {FileSystemFileHandle} handle
 * @param {{ action: 'saved'|'opened', meta?: string }} info
 * @returns {Promise<object|null>} the entry, or null when nothing was recorded
 */
export async function recordRecentFile(handle, { action, meta = '' }) {
	if (privacy.ephemeral || !handle?.name || !hasWindow()) return null;
	const id = await idForHandle(handle);
	if (!(await putHandle(id, handle))) return null;
	const name = sessionBaseName(handle.name);
	const next = {
		id,
		name,
		fileName: handle.name,
		ts: Date.now(),
		action: action === 'saved' ? 'saved' : 'opened',
		meta,
		thumb: thumbnailForWorkflow(name),
		hasHandle: true
	};
	const items = [next, ...loadRecents().filter((e) => e.id !== id)];
	const evicted = items.slice(MAX_RECENTS);
	persist(items.slice(0, MAX_RECENTS));
	for (const e of evicted) await deleteHandle(e.id); // don't leak handles for dropped rows
	return next;
}

/** Remove a single entry (the row's remove button) and its handle. */
export async function removeRecent(id) {
	persist(loadRecents().filter((e) => e.id !== id));
	await deleteHandle(id);
}

/** Clear the whole list: the index AND every stored handle. */
export async function clearRecents() {
	persist([]);
	await clearHandles();
}

// --- IndexedDB (handles only) -----------------------------------------------

function openDb() {
	if (!hasWindow() || !window.indexedDB) return Promise.resolve(null);
	return new Promise((resolve) => {
		let req;
		try {
			req = window.indexedDB.open(DB_NAME, DB_VERSION);
		} catch {
			resolve(null);
			return;
		}
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
		};
		req.onsuccess = () => {
			const db = req.result;
			// "Clear data stored in this browser" deletes this database: let it.
			db.onversionchange = () => db.close();
			resolve(db);
		};
		req.onerror = () => resolve(null);
		req.onblocked = () => resolve(null);
	});
}

/** Resolves { ok, result }: ok is false when the transaction did not complete. */
function tx(db, mode, fn) {
	return new Promise((resolve) => {
		try {
			const t = db.transaction(STORE, mode);
			const req = fn(t.objectStore(STORE));
			t.oncomplete = () => resolve({ ok: true, result: req?.result ?? null });
			t.onerror = () => resolve({ ok: false, result: null });
			t.onabort = () => resolve({ ok: false, result: null });
		} catch {
			resolve({ ok: false, result: null });
		}
	});
}

/** @returns {Promise<boolean>} whether the handle was stored */
async function putHandle(id, handle) {
	const db = await openDb();
	if (!db) return false;
	const { ok } = await tx(db, 'readwrite', (s) => s.put({ handle }, id));
	db.close?.();
	return ok;
}

export async function getHandle(id) {
	const db = await openDb();
	if (!db) return null;
	const { result } = await tx(db, 'readonly', (s) => s.get(id));
	db.close?.();
	return result?.handle ?? null;
}

async function deleteHandle(id) {
	const db = await openDb();
	if (!db) return;
	await tx(db, 'readwrite', (s) => s.delete(id));
	db.close?.();
}

async function clearHandles() {
	const db = await openDb();
	if (!db) return;
	await tx(db, 'readwrite', (s) => s.clear());
	db.close?.();
}

// --- reopening ---------------------------------------------------------------

/**
 * Reopen a recent file in a single action. Must be called from a user gesture (a click),
 * because the browser asks for permission to read the file again only in response to one.
 *
 * @returns {Promise<
 *   | {status:'ok', file:File, handle:FileSystemFileHandle}
 *   | {status:'missing'}       the file was moved, renamed or deleted
 *   | {status:'denied'}        the user (or the browser) refused permission to read it
 *   | {status:'no-handle'}     nothing stored for this row any more
 *   | {status:'error', error}  anything else
 * >}
 */
export async function openRecent(id) {
	const handle = await getHandle(id);
	if (!handle) return { status: 'no-handle' };
	try {
		let perm = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
		if (perm !== 'granted') perm = await handle.requestPermission?.({ mode: 'read' });
		if (perm !== 'granted') return { status: 'denied' };
		const file = await handle.getFile();
		// The handle rides along so the caller can make it the save target and re-record it.
		return { status: 'ok', file, handle };
	} catch (error) {
		if (error?.name === 'NotFoundError') return { status: 'missing' };
		if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
			return { status: 'denied' };
		}
		return { status: 'error', error };
	}
}

/** Human "2 hours ago" style stamp for the row. */
export function relativeTime(ts, now = Date.now()) {
	const s = Math.max(0, Math.round((now - (ts ?? 0)) / 1000));
	if (s < 60) return 'just now';
	const m = Math.round(s / 60);
	if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
	const d = Math.round(h / 24);
	if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
	const mo = Math.round(d / 30);
	return `${mo} month${mo === 1 ? '' : 's'} ago`;
}
