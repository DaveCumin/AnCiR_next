// @ts-nocheck
// Recently-opened sessions for the start screen.
//
// STORAGE SPLIT (and a deliberate departure from "cache the payload"):
//
//   • localStorage — the INDEX only. A small array of {id, name, ts, meta, workflow, thumb}.
//     Synchronous, string-only, ~5 MB ceiling, so it must never see a time series.
//   • IndexedDB    — the FileSystemFileHandle for each entry, where the browser has the File
//     System Access API. Handles are structured-cloneable but NOT JSON-serialisable, which is
//     exactly why they need IDB rather than localStorage.
//
// We do NOT cache session payloads. The brief allowed for it, but caching every opened session
// would silently create a second copy of potentially identifiable actigraphy inside the browser
// profile — the very risk the "clear list" control then exists to undo. Keeping only a handle
// means the data stays in the user's own file, `clearRecents()` is trivially complete, and the
// index stays a few kB. Where there is no handle (Firefox/Safari today) the row degrades to
// "re-select file", which is honest about what the browser will actually let us do.

const INDEX_KEY = 'ancir.recents.v1';
const DB_NAME = 'ancir-recents';
const DB_VERSION = 1;
const STORE = 'handles';
export const MAX_RECENTS = 8;

/** Reactive view of the index; components read this directly. */
export const recents = $state({ items: [] });

const hasWindow = () => typeof window !== 'undefined';

/** Does this browser give us re-openable file handles? */
export function supportsFileHandles() {
	return hasWindow() && typeof window.showOpenFilePicker === 'function';
}

// --- localStorage index ------------------------------------------------------

/** Read + normalise the index. Never throws: a corrupt or unavailable store means "no recents". */
export function loadRecents() {
	if (!hasWindow()) return [];
	let parsed = [];
	try {
		parsed = JSON.parse(window.localStorage.getItem(INDEX_KEY) ?? '[]');
	} catch {
		parsed = [];
	}
	const items = (Array.isArray(parsed) ? parsed : [])
		.filter((e) => e && typeof e.id === 'string')
		.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
		.slice(0, MAX_RECENTS);
	recents.items = items;
	return items;
}

function persist(items) {
	recents.items = items;
	if (!hasWindow()) return;
	try {
		window.localStorage.setItem(INDEX_KEY, JSON.stringify(items));
	} catch {
		// Quota or private-mode failure: the app must keep working without recents.
	}
}

/**
 * Record (or refresh) a recently-opened session. Most-recent-first, capped at MAX_RECENTS, and
 * evicting the oldest — including its stored handle, so IDB can't outlive the index.
 *
 * @param {{id?:string, name:string, meta?:string, workflow?:string, thumb?:string, handle?:any}} entry
 */
export async function recordRecent(entry) {
	const id = entry.id ?? `${entry.name ?? 'session'}::${entry.workflow ?? ''}`;
	const next = {
		id,
		name: entry.name ?? 'Untitled session',
		ts: Date.now(),
		meta: entry.meta ?? '',
		workflow: entry.workflow ?? '',
		thumb: entry.thumb ?? '',
		// Set for bundled examples only. They are re-fetchable by url, so those rows reopen in one
		// click in every browser, with no file handle and no picker involved.
		url: entry.url ?? ''
	};
	const kept = loadRecents().filter((e) => e.id !== id);
	const items = [next, ...kept];
	const evicted = items.slice(MAX_RECENTS);
	persist(items.slice(0, MAX_RECENTS));

	if (entry.handle) await putHandle(id, entry.handle);
	for (const e of evicted) await deleteHandle(e.id); // don't leak handles for dropped rows
	return next;
}

/** Remove a single entry (the per-row dismiss) and its handle. */
export async function removeRecent(id) {
	persist(loadRecents().filter((e) => e.id !== id));
	await deleteHandle(id);
}

/**
 * Clear the whole list. This must actually remove what it claims to: the index AND every stored
 * handle. Callers are expected to confirm with the user first.
 */
export async function clearRecents() {
	persist([]);
	if (hasWindow()) {
		try {
			window.localStorage.removeItem(INDEX_KEY);
		} catch {
			/* ignore */
		}
	}
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
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => resolve(null);
		req.onblocked = () => resolve(null);
	});
}

function tx(db, mode, fn) {
	return new Promise((resolve) => {
		try {
			const t = db.transaction(STORE, mode);
			const store = t.objectStore(STORE);
			const req = fn(store);
			t.oncomplete = () => resolve(req?.result ?? null);
			t.onerror = () => resolve(null);
			t.onabort = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
}

async function putHandle(id, handle) {
	const db = await openDb();
	if (!db) return;
	await tx(db, 'readwrite', (s) => s.put({ handle }, id));
	db.close?.();
}

export async function getHandle(id) {
	const db = await openDb();
	if (!db) return null;
	const rec = await tx(db, 'readonly', (s) => s.get(id));
	db.close?.();
	return rec?.handle ?? null;
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
 * Try to reopen a recent in a single action. Must be called from a user gesture (a click), because
 * re-granting file permission requires one.
 *
 * @returns {Promise<{status:'ok', file:File} | {status:'reselect', reason:string}>}
 *   'reselect' means the caller should open the file picker instead and then re-record the entry
 *   under the SAME id, so the row is rehydrated rather than duplicated.
 */
export async function openRecent(id) {
	const handle = await getHandle(id);
	if (!handle) return { status: 'reselect', reason: 'no-handle' };
	try {
		let perm = await handle.queryPermission?.({ mode: 'read' });
		if (perm !== 'granted') perm = await handle.requestPermission?.({ mode: 'read' });
		if (perm !== 'granted') return { status: 'reselect', reason: 'permission-denied' };
		const file = await handle.getFile();
		// The handle rides along so the caller can re-record it without a second IDB read.
		return { status: 'ok', file, handle };
	} catch {
		// The file was moved, renamed or deleted since we stored the handle.
		return { status: 'reselect', reason: 'unavailable' };
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
