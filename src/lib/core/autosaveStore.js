// @ts-nocheck
// Where autosaved sessions are kept: IndexedDB database `ancir-autosave` (autosave.svelte.js
// decides WHEN to write; this module only reads and writes).
//
// Two object stores, both keyed by slot id (autosaveSlot.js):
//
//   meta      { slot, savedAt, name, summary, chars, fileName, version }
//             small, so the start screen can list the copies without reading any of them
//   sessions  { slot, json, handle }
//             the session itself as the JSON string the app saves to a file, plus the
//             FileSystemFileHandle of the file it saves to (when there is one), so a restored
//             session keeps saving to the same file
//
// IndexedDB rather than localStorage: a session with real recordings runs to tens of megabytes,
// far past localStorage's ~5 MB, and localStorage writes block the main thread. The JSON is
// stored as one string: a string is copied into the database without the structured-clone walk
// a nested object would need.
//
// Every operation opens the database, does its work and closes it again, so this tab never
// holds a connection that would block "Clear data stored in this browser" (which deletes the
// database) in this or another tab.

export const AUTOSAVE_DB = 'ancir-autosave';
const DB_VERSION = 1;
const META = 'meta';
const SESSIONS = 'sessions';

/** Thrown when the browser gives no usable IndexedDB (some file:// pages, blocked storage). */
export class AutosaveUnavailableError extends Error {
	constructor(cause) {
		super('Browser storage is not available here.');
		this.name = 'AutosaveUnavailableError';
		this.cause = cause;
	}
}

/** True for the errors that mean "the copy does not fit in the browser's storage". */
export function isQuotaError(err) {
	const name = err?.name ?? '';
	return (
		name === 'QuotaExceededError' ||
		name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
		// A session too big to become one JavaScript string ("Invalid string length").
		err instanceof RangeError
	);
}

function idbFactory(idb) {
	if (idb) return idb;
	if (typeof indexedDB !== 'undefined') return indexedDB;
	return null;
}

function openDb(idb) {
	const factory = idbFactory(idb);
	if (!factory) return Promise.reject(new AutosaveUnavailableError());
	return new Promise((resolve, reject) => {
		let req;
		try {
			req = factory.open(AUTOSAVE_DB, DB_VERSION);
		} catch (err) {
			reject(new AutosaveUnavailableError(err));
			return;
		}
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'slot' });
			if (!db.objectStoreNames.contains(SESSIONS)) {
				db.createObjectStore(SESSIONS, { keyPath: 'slot' });
			}
		};
		req.onsuccess = () => {
			const db = req.result;
			// Another tab deleting the database (Clear data) must not wait on this connection.
			db.onversionchange = () => db.close();
			resolve(db);
		};
		req.onerror = (e) => {
			e?.preventDefault?.();
			reject(new AutosaveUnavailableError(req.error));
		};
		req.onblocked = () => reject(new AutosaveUnavailableError(new Error('blocked')));
	});
}

/** Resolve when the transaction commits; reject with its error when it aborts. */
function done(tx) {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = (e) => {
			e?.preventDefault?.();
		};
		tx.onabort = () => reject(tx.error ?? new Error('The autosave transaction was aborted.'));
	});
}

function request(req) {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = (e) => {
			e?.preventDefault?.();
			reject(req.error);
		};
	});
}

async function withDb(idb, fn) {
	const db = await openDb(idb);
	try {
		return await fn(db);
	} finally {
		db.close();
	}
}

/**
 * Write (or overwrite) one slot's copy, both stores in one transaction, so a copy is never
 * listed without its session or the other way round.
 *
 * Resolves `{ blockingMs }`: how long the put() calls held the main thread. The browser copies
 * the value (here, the session string) synchronously inside put(), so for a large session this
 * is as much of a pause as serialising it; autosave counts both (autosave.svelte.js).
 * @param {{ slot: string, savedAt: number, name: string, summary: object, json: string,
 *           fileName?: string|null, handle?: any, version?: string }} copy
 */
export function writeCopy(copy, idb) {
	const meta = {
		slot: copy.slot,
		savedAt: copy.savedAt,
		name: copy.name,
		summary: copy.summary ?? {},
		chars: copy.json.length,
		fileName: copy.fileName ?? null,
		version: copy.version ?? null
	};
	return withDb(idb, async (db) => {
		let blockingMs = 0;
		const put = async (withHandle) => {
			const tx = db.transaction([META, SESSIONS], 'readwrite');
			const finished = done(tx);
			const t0 = performance.now();
			try {
				tx.objectStore(META).put(meta);
				tx.objectStore(SESSIONS).put({
					slot: copy.slot,
					json: copy.json,
					...(withHandle && copy.handle ? { handle: copy.handle } : {})
				});
			} catch (err) {
				// A put that throws leaves the transaction open; abort it so `finished` settles.
				try {
					tx.abort();
				} catch {
					/* already finished */
				}
				await finished.catch(() => {});
				throw err;
			} finally {
				blockingMs += performance.now() - t0;
			}
			await finished;
		};
		try {
			await put(true);
		} catch (err) {
			// A handle the browser cannot store (DataCloneError) must not cost the copy itself.
			if (copy.handle && err?.name === 'DataCloneError') await put(false);
			else throw err;
		}
		return { blockingMs };
	});
}

/** Every copy's metadata, newest first. */
export function listCopies(idb) {
	return withDb(idb, async (db) => {
		const tx = db.transaction(META, 'readonly');
		const all = await request(tx.objectStore(META).getAll());
		return (all ?? []).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
	});
}

/** One copy in full ({ meta, json, handle }), or null when it is gone. */
export function readCopy(slot, idb) {
	return withDb(idb, async (db) => {
		const tx = db.transaction([META, SESSIONS], 'readonly');
		const [meta, body] = await Promise.all([
			request(tx.objectStore(META).get(slot)),
			request(tx.objectStore(SESSIONS).get(slot))
		]);
		if (!meta || !body || typeof body.json !== 'string') return null;
		return { meta, json: body.json, handle: body.handle ?? null };
	});
}

/** Remove the copies in these slots. */
export function deleteCopies(slots, idb) {
	const list = [...new Set(slots)].filter(Boolean);
	if (list.length === 0) return Promise.resolve();
	return withDb(idb, async (db) => {
		const tx = db.transaction([META, SESSIONS], 'readwrite');
		const finished = done(tx);
		for (const s of list) {
			tx.objectStore(META).delete(s);
			tx.objectStore(SESSIONS).delete(s);
		}
		await finished;
	});
}

/** Remove every copy. @returns {Promise<number>} how many there were. */
export function clearCopies(idb) {
	return withDb(idb, async (db) => {
		const tx = db.transaction([META, SESSIONS], 'readwrite');
		const finished = done(tx);
		const count = await request(tx.objectStore(META).count());
		tx.objectStore(META).clear();
		tx.objectStore(SESSIONS).clear();
		await finished;
		return count;
	});
}

/**
 * Which copies to drop, newest first in `metas`: anything older than `maxAgeMs`, and beyond the
 * `maxCopies` newest. Copies in `protectedSlots` (this tab's, and those of other open tabs) are
 * never dropped and do not count towards the limit, so a busy tab cannot push out the copy of
 * a tab that is still open.
 * @returns {string[]} the slots to delete
 */
export function slotsToPrune(metas, { now, maxCopies, maxAgeMs, protectedSlots = new Set() }) {
	const drop = [];
	let kept = 0;
	for (const m of metas) {
		if (protectedSlots.has(m.slot)) continue;
		if (now - (m.savedAt ?? 0) > maxAgeMs || kept >= maxCopies) drop.push(m.slot);
		else kept++;
	}
	return drop;
}
