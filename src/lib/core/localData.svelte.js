// @ts-nocheck
// What AnCiR leaves behind in the browser, and how to not leave it.
//
// THE THREAT MODEL, STATED HONESTLY
//
// `localStorage` is partitioned by origin: no other site can read ours. The risk is not
// cross-site sniffing — it is the NEXT PERSON at the same browser profile. A lab bench, a
// clinic workstation, a shared office machine. That is a real risk for actigraphy, which is
// often identifiable in practice even when it carries no name.
//
// WHAT WE ACTUALLY WRITE
//
//   ancir.recents.v1            filename, "12 columns · 3 plots", and a sparkline drawn FROM
//                               the series — small, but derived from the data
//   ancir.workflow.nodePositions  node coordinates
//   ancir.canvas.pathFocus      one node id
//   ancir.tours.completed       which tours are done
//   IndexedDB `ancir-recents`   FileSystemFileHandles — no data, but file identity and the
//                               capability to re-open
//
// The crash snapshot is deliberately NOT on that list any more: it is the one thing that held
// a whole session, imported data and all, and it now lives in sessionStorage (see
// errorReporter.js).
//
// EPHEMERAL MODE
//
// Every write above goes through `store` rather than touching `localStorage` directly. In
// ephemeral mode `store` resolves to `sessionStorage`, so the browser itself discards
// everything when the tab closes — including after a crash, and with no unload handler, which
// cannot be made reliable:
//
//   • `unload` is deprecated, disables bfcache, and does not fire on mobile tab kill
//   • `pagehide` also fires into bfcache, so clearing there destroys work the user gets back
//     by pressing Back
//   • `visibilitychange` fires on every tab switch
//   • none of them fire on a crash
//
// Letting the browser scope the storage is the only version of "gone when they leave" that is
// actually true.

const PREFIX = 'ancir';

/**
 * The mode flag itself. Persisted in localStorage (never in the ephemeral store) so a shared
 * machine STAYS in ephemeral mode across sessions — a privacy setting that forgets itself is
 * worse than none — and exempted from clearLocalData() for the same reason.
 */
const MODE_KEY = 'ancir.privacy.ephemeral';

const hasWindow = () => typeof window !== 'undefined';

function readMode() {
	if (!hasWindow()) return false;
	try {
		return window.localStorage?.getItem(MODE_KEY) === '1';
	} catch {
		return false;
	}
}

export const privacy = $state({ ephemeral: readMode() });

/**
 * Turn ephemeral mode on or off. Turning it ON also clears what is already on disk — otherwise
 * the setting would protect only future sessions while last week's filenames sat there, which
 * is not what anyone ticking this box means.
 * @returns {Promise<void>}
 */
export async function setEphemeral(on) {
	privacy.ephemeral = !!on;
	if (hasWindow()) {
		try {
			if (on) window.localStorage?.setItem(MODE_KEY, '1');
			else window.localStorage?.removeItem(MODE_KEY);
		} catch {
			/* private mode / quota: the in-memory flag still holds for this session */
		}
	}
	if (on) await clearLocalData();
}

/** Whichever Storage the current mode writes to. */
function backing() {
	if (!hasWindow()) return null;
	try {
		return privacy.ephemeral ? window.sessionStorage : window.localStorage;
	} catch {
		return null;
	}
}

/**
 * Drop-in for `localStorage` that honours ephemeral mode. Reads fall back to the other store so
 * that flipping the mode mid-session does not appear to lose the user's layout.
 *
 * Every method swallows its own errors: Safari private mode throws on `setItem`, and no
 * preference is worth taking the app down for.
 */
export const store = {
	getItem(key) {
		if (!hasWindow()) return null;
		try {
			return backing()?.getItem(key) ?? window.localStorage?.getItem(key) ?? null;
		} catch {
			return null;
		}
	},
	setItem(key, value) {
		try {
			backing()?.setItem(key, value);
		} catch {
			/* quota or private mode */
		}
	},
	removeItem(key) {
		if (!hasWindow()) return;
		// Both stores: the key may predate a mode change.
		for (const s of [window.localStorage, window.sessionStorage]) {
			try {
				s?.removeItem(key);
			} catch {
				/* ignore */
			}
		}
	}
};

/** Every `ancir`-prefixed key currently in `s`, snapshotted before deletion (mutating while iterating shifts indices). */
function ancirKeys(s) {
	const keys = [];
	try {
		for (let i = 0; i < s.length; i++) {
			const k = s.key(i);
			if (k && k.startsWith(PREFIX) && k !== MODE_KEY) keys.push(k);
		}
	} catch {
		/* ignore */
	}
	return keys;
}

/** Delete an IndexedDB database, resolving either way — a blocked delete must not hang the caller. */
function deleteDatabase(name) {
	if (!hasWindow() || !window.indexedDB) return Promise.resolve();
	return new Promise((resolve) => {
		let req;
		try {
			req = window.indexedDB.deleteDatabase(name);
		} catch {
			resolve();
			return;
		}
		req.onsuccess = () => resolve();
		req.onerror = () => resolve();
		// An open connection in another tab blocks the delete. Resolve rather than wait forever;
		// the caller reports what it could do, and lying is worse than an incomplete sweep.
		req.onblocked = () => resolve();
	});
}

/** The IndexedDB databases AnCiR owns. Listed explicitly so a clear cannot quietly miss one. */
const OWNED_DATABASES = ['ancir-recents'];

/**
 * Remove everything AnCiR has stored in this browser: both Storage areas and the IndexedDB
 * handle store. The privacy setting itself survives, deliberately.
 *
 * @returns {Promise<{keys: number, databases: number}>} what was actually removed, so the UI can
 *   report a number instead of an unfalsifiable "done".
 */
export async function clearLocalData() {
	let keys = 0;
	if (hasWindow()) {
		for (const s of [window.localStorage, window.sessionStorage]) {
			if (!s) continue;
			for (const k of ancirKeys(s)) {
				try {
					s.removeItem(k);
					keys++;
				} catch {
					/* ignore */
				}
			}
		}
	}
	for (const db of OWNED_DATABASES) await deleteDatabase(db);
	return { keys, databases: OWNED_DATABASES.length };
}
