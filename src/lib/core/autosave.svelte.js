// @ts-nocheck
// Autosave: a copy of the open session in this browser's storage, so a closed tab, a reload
// or a crash does not cost the work done since the last save.
//
// A DELIBERATE CHANGE OF POLICY (David, November 2026)
//
// The earlier privacy design kept whole sessions out of persistent browser storage: only the
// crash copy existed, in sessionStorage, gone with the tab (errorReporter.js). Losing work to
// a closed tab turned out to be the bigger everyday risk, so autosave now keeps sessions in
// IndexedDB, with these limits, which are what keep it compatible with that design's intent:
//
//   - never in ephemeral mode (localData.svelte.js), the shared or clinic machine setting;
//     turning it on deletes every copy
//   - a setting turns it off, and turning it off deletes every copy
//   - "Clear data stored in this browser" deletes every copy (localData's OWNED_DATABASES)
//   - a copy exists only while its session has UNSAVED changes: once the session is saved to
//     a file, or replaced by another, its copy is deleted (the file is the copy)
//   - at most MAX_COPIES copies from closed tabs, none older than MAX_AGE_MS
//
// A BROWSER PRIVATE WINDOW is not one of those limits (David, 2026-11-21). Autosave runs there
// as anywhere else, and the browser itself throws the window's storage away when it closes, so
// a copy protects against a crash or a reload inside the window and leaves nothing behind. An
// earlier version tried to detect private windows (a timing heuristic in Chromium) and turned
// autosave off in them; a wrong guess turned it off in a normal window with no way back, and
// the choice that matters on a shared machine is the app's own, ephemeral mode.
//
// WHEN IT WRITES
//
// DEBOUNCE_MS after the last change (unsavedChanges.onSessionChange), when the browser is idle
// (requestIdleCallback), and at once when the tab is hidden or the page is being left
// (visibilitychange, pagehide). A poll every POLL_MS catches changes no operation announces
// (an import changes the session's shape only). Writing serialises the whole session on the
// main thread, which is the one cost that grows with the session: the gap between writes
// grows with it (COST_MULTIPLIER times the last serialisation), so autosave never takes more
// than about 5% of the main thread however large the session is.
//
// SEVERAL TABS
//
// Each tab writes only to its own slot (autosaveSlot.js) and holds a Web Lock named after it
// for as long as it is open. The browser releases the lock when the tab closes or crashes, so
// "which copies belong to a tab that is still open" is a question the lock manager answers
// exactly: those are never offered for restore and never pruned. Restoring a copy adopts its
// slot (taking its lock), so the restored session goes on writing to the same copy.
// Web Locks: https://developer.mozilla.org/docs/Web/API/Web_Locks_API (Chrome 69, Firefox 96,
// Safari 15.4). Where it is missing, every copy but this tab's own is offered.
//
// AND THE CRASH COPY
//
// The sessionStorage crash copy (errorReporter.js) stays, as the fallback for every case in
// which autosave is off (ephemeral mode, the setting, a session too large), and
// because it is written at the moment of the error, which a debounced autosave may not have
// reached. It records this tab's slot; after a crash the toast offers it, and the start screen
// leaves out the autosaved copy of the same session so one session is not offered twice.

import { core, appConsts, outputCoreAsJson } from './core.svelte.js';
import { addNotification } from './notifications.svelte.js';
import { privacy, AUTOSAVE_PREF_KEY, EPHEMERAL_MODE_KEY } from './localData.svelte.js';
import {
	hasUnsavedChanges,
	markSessionUnsaved,
	onSessionChange,
	sessionChangeFingerprint
} from './unsavedChanges.svelte.js';
import { getAutosaveSlot, setAutosaveSlot } from './autosaveSlot.js';
import { getSaveHandle, saveTarget, setSaveTarget } from './saveTarget.svelte.js';
import { sessionNameForSave, sessionBaseName, UNNAMED_SESSION } from './sessionFiles.js';
import {
	clearCopies,
	deleteCopies,
	isQuotaError,
	listCopies,
	readCopy,
	slotsToPrune,
	writeCopy,
	AutosaveUnavailableError
} from './autosaveStore.js';

/** The setting (declared in localData.svelte.js). Absent means on; '0' means turned off. */
export { AUTOSAVE_PREF_KEY };
export const DEBOUNCE_MS = 2000;
export const POLL_MS = 5000;
/** The gap between writes is at least this many times the last serialisation's cost. */
export const COST_MULTIPLIER = 20;
/**
 * A write that holds the main thread longer than this (serialising plus handing the string to
 * IndexedDB) is too slow to repeat while someone works: autosave then writes only when the tab
 * is hidden. Measured in Chromium on a 74-column session: 100,000 rows (87 MB of JSON) cost
 * about 280 ms to serialise and 190 ms to hand over; a year of 1-minute rows (455 MB) about
 * 1.5 s and 1.1 s.
 */
export const MAX_BLOCKING_MS = 1000;
/** Copies kept from tabs that are no longer open (David, 2026-11-21: was 5). */
export const MAX_COPIES = 2;
/** None older than this (David, 2026-11-21: was 30 days). */
export const MAX_AGE_DAYS = 14;
export const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const LOCK_PREFIX = 'ancir-autosave:';

const hasWindow = () => typeof window !== 'undefined';

function readPref() {
	if (!hasWindow()) return true;
	try {
		return window.localStorage?.getItem(AUTOSAVE_PREF_KEY) !== '0';
	} catch {
		return true;
	}
}

/**
 * What autosave is doing, for the Settings panel and the start screen.
 *
 * `storage` is 'ok' | 'unavailable' | 'too-large' (does not fit) | 'slow' (fits, but writing it
 * pauses the app, so it is written only while the tab is hidden). Whether autosave is actually
 * running is autosaveStatus(), which combines it with the setting and ephemeral mode.
 */
export const autosave = $state({
	enabled: readPref(),
	storage: 'ok',
	lastSavedAt: null,
	/** Copies from closed tabs that can be restored, newest first (metadata only). */
	offers: []
});

/**
 * One word for the UI:
 *   'on' | 'ephemeral' | 'off' (the setting) | 'unavailable' | 'too-large' | 'slow'
 *
 * Ephemeral mode comes first: it is the stronger reason (it overrides the setting), and the one
 * that has to be undone elsewhere for autosave to run again.
 */
export function autosaveStatus() {
	if (privacy.ephemeral) return 'ephemeral';
	if (!autosave.enabled) return 'off';
	if (autosave.storage === 'unavailable') return 'unavailable';
	if (autosave.storage === 'too-large') return 'too-large';
	if (autosave.storage === 'slow') return 'slow';
	return 'on';
}

/**
 * True when changes are written and copies are offered. ('too-large' still counts: a smaller
 * session resumes.)
 */
function writing() {
	return autosave.enabled && !privacy.ephemeral && autosave.storage !== 'unavailable';
}

// --- module state ---------------------------------------------------------------------------
let installed = false;
let timer = null;
let idleHandle = null;
let pollTimer = null;
let writeInFlight = null;
let rerun = false;
let lastFingerprint = null;
let haveOwnCopy = false;
let lastCostMs = 0;
let tooLargeNoticeShown = false;
/** Slots not to offer while the crash toast offers the same session. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- module bookkeeping read only inside functions; no template or effect depends on it
const hiddenSlots = new Set();
/** Lock releasers by slot. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- lock release callbacks, never rendered
const lockReleasers = new Map();
let removers = [];

// --- Web Locks ------------------------------------------------------------------------------
function locks() {
	return hasWindow() ? (window.navigator?.locks ?? null) : null;
}

/** Hold the lock for `slot` until released. Resolves true when held (or no Web Locks). */
function acquireLock(slot) {
	const lm = locks();
	if (!lm) return Promise.resolve(true);
	if (lockReleasers.has(slot)) return Promise.resolve(true);
	return new Promise((resolve) => {
		lm.request(`${LOCK_PREFIX}${slot}`, { ifAvailable: true }, (lock) => {
			if (!lock) {
				resolve(false);
				return undefined;
			}
			resolve(true);
			return new Promise((release) => lockReleasers.set(slot, release));
		}).catch(() => resolve(false));
	});
}

function releaseLock(slot) {
	lockReleasers.get(slot)?.();
	lockReleasers.delete(slot);
}

/** Slots whose lock some open tab (this one included) holds. */
async function liveSlots() {
	const lm = locks();
	if (!lm?.query) return new Set();
	try {
		const { held = [] } = await lm.query();
		return new Set(
			held
				.map((l) => l.name ?? '')
				.filter((n) => n.startsWith(LOCK_PREFIX))
				.map((n) => n.slice(LOCK_PREFIX.length))
		);
	} catch {
		return new Set();
	}
}

// --- what a copy is called --------------------------------------------------------------------
/** The name the start screen shows for the open session. */
export function currentSessionName() {
	if (saveTarget.fileName) return sessionBaseName(saveTarget.fileName);
	return (
		sessionNameForSave(core) ??
		(saveTarget.label ? sessionBaseName(saveTarget.label) : null) ??
		UNNAMED_SESSION
	);
}

function currentSummary() {
	return {
		columns: core.data?.length ?? 0,
		analyses: core.tableProcesses?.length ?? 0,
		plots: core.plots?.length ?? 0
	};
}

/** "4 columns, 2 analyses, 1 plot" from a copy's summary. */
export function describeSummary(summary) {
	const parts = [];
	const count = (n, one, many) => {
		if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
	};
	count(summary?.columns ?? 0, 'column', 'columns');
	count(summary?.analyses ?? 0, 'analysis', 'analyses');
	count(summary?.plots ?? 0, 'plot', 'plots');
	return parts.join(', ') || 'empty';
}

// --- writing ----------------------------------------------------------------------------------
function cancelScheduled() {
	if (timer) clearTimeout(timer);
	timer = null;
	if (idleHandle != null && hasWindow() && typeof window.cancelIdleCallback === 'function') {
		window.cancelIdleCallback(idleHandle);
	}
	idleHandle = null;
}

/**
 * How long after a change to write: the debounce, stretched to COST_MULTIPLIER times what the
 * last serialisation cost, so a session that takes 200 ms to serialise is written at most
 * every 4 s (about 5% of the main thread).
 */
export function autosaveDelay(lastSerialiseMs) {
	return Math.max(DEBOUNCE_MS, COST_MULTIPLIER * (lastSerialiseMs || 0));
}

/** Write after the debounce (stretched for big sessions) once the browser is idle. */
export function scheduleAutosave() {
	// A slow session is written only when the tab is hidden (initAutosave's handlers).
	if (!writing() || autosave.storage === 'slow') return;
	cancelScheduled();
	const delay = autosaveDelay(lastCostMs);
	timer = setTimeout(() => {
		timer = null;
		if (hasWindow() && typeof window.requestIdleCallback === 'function') {
			// The timeout keeps a constantly busy page (a running analysis) from postponing the
			// copy for ever.
			idleHandle = window.requestIdleCallback(
				() => {
					idleHandle = null;
					void flushAutosave();
				},
				{ timeout: DEBOUNCE_MS }
			);
		} else {
			void flushAutosave();
		}
	}, delay);
}

function showTooLargeNotice() {
	if (tooLargeNoticeShown) return;
	tooLargeNoticeShown = true;
	addNotification(
		'This session is too large to autosave in this browser, so changes are not being kept ' +
			'here. Save it to a file to keep it safe.',
		'warning',
		15000
	);
}

function showSlowNotice() {
	if (tooLargeNoticeShown) return;
	tooLargeNoticeShown = true;
	addNotification(
		'This session is large, so to keep AnCiR responsive it is now autosaved only when you ' +
			'switch away from this tab. Save it to a file to keep it safe.',
		'info',
		12000
	);
}

/**
 * Bring this tab's copy up to date now: write it when the session has unsaved changes that
 * are not in the copy yet, delete it when the session has none. Safe to call at any time.
 * @param {{ background?: boolean }} [opts]  true when the tab is being hidden or left, the
 *   only time a slow session is written
 * @returns {Promise<void>}
 */
export function flushAutosave({ background = false } = {}) {
	cancelScheduled();
	if (!writing()) return Promise.resolve();
	if (writeInFlight) {
		rerun = true;
		return writeInFlight;
	}
	writeInFlight = runFlush(background).finally(() => {
		writeInFlight = null;
		if (rerun) {
			rerun = false;
			scheduleAutosave();
		}
	});
	return writeInFlight;
}

async function runFlush(background) {
	const slot = getAutosaveSlot();
	const fingerprint = sessionChangeFingerprint();
	if (!hasUnsavedChanges()) {
		lastFingerprint = fingerprint;
		if (haveOwnCopy) await removeOwnCopy();
		return;
	}
	if (fingerprint === lastFingerprint) return;
	if (autosave.storage === 'slow' && !background) return;
	let json;
	const t0 = performance.now();
	try {
		json = outputCoreAsJson();
	} catch (err) {
		lastCostMs = performance.now() - t0;
		if (isQuotaError(err)) {
			autosave.storage = 'too-large';
			lastFingerprint = fingerprint;
			showTooLargeNotice();
			return;
		}
		// A session that will not serialise is the save's problem to report, not autosave's:
		// a rejected promise here would reach the crash reporter from a background timer.
		lastFingerprint = fingerprint;
		console.error('Autosave could not serialise the session:', err);
		return;
	}
	const serialiseMs = performance.now() - t0;
	lastCostMs = serialiseMs;
	const savedAt = Date.now();
	let blockingMs = 0;
	try {
		({ blockingMs } = await writeCopy({
			slot,
			savedAt,
			name: currentSessionName(),
			summary: currentSummary(),
			json,
			fileName: saveTarget.fileName,
			handle: getSaveHandle(),
			version: appConsts.version
		}));
	} catch (err) {
		lastFingerprint = fingerprint; // do not retry the same state over and over
		if (isQuotaError(err)) {
			autosave.storage = 'too-large';
			showTooLargeNotice();
			return;
		}
		if (err instanceof AutosaveUnavailableError) {
			autosave.storage = 'unavailable';
			return;
		}
		console.error('Autosave could not write its copy:', err);
		return;
	}
	lastFingerprint = fingerprint;
	haveOwnCopy = true;
	autosave.lastSavedAt = savedAt;
	lastCostMs = serialiseMs + (blockingMs ?? 0);
	if (lastCostMs > MAX_BLOCKING_MS) {
		// Kept, but writing it again every few seconds would pause the app each time.
		if (autosave.storage !== 'slow') {
			autosave.storage = 'slow';
			showSlowNotice();
		}
	} else if (autosave.storage === 'too-large' || autosave.storage === 'slow') {
		// It fits, and quickly, so a session that was too large or slow before has shrunk.
		autosave.storage = 'ok';
	}
}

async function removeOwnCopy() {
	try {
		await deleteCopies([getAutosaveSlot()]);
		haveOwnCopy = false;
		autosave.lastSavedAt = null;
	} catch {
		/* the copy goes with the next clear or prune */
	}
}

/**
 * The session was saved to a file: its copy here is redundant, and keeping a second copy of
 * someone's data that they did not ask for is exactly what autosave must not do.
 */
export async function autosaveAfterSave() {
	cancelScheduled();
	lastFingerprint = sessionChangeFingerprint();
	if (haveOwnCopy || writing()) await removeOwnCopy();
}

/**
 * Another session replaced the open one (a load, or New session), after the user agreed to
 * discard unsaved work or there was none: the old session's copy goes, and a session that was
 * too large no longer stops autosave.
 */
export async function autosaveSessionReplaced() {
	cancelScheduled();
	lastFingerprint = sessionChangeFingerprint();
	lastCostMs = 0;
	if (autosave.storage === 'too-large' || autosave.storage === 'slow') autosave.storage = 'ok';
	tooLargeNoticeShown = false;
	if (haveOwnCopy) await removeOwnCopy();
}

// --- copies from closed tabs ------------------------------------------------------------------
/** Re-read the copies that can be offered for restore, pruning old ones on the way. */
export async function refreshAutosaveOffers() {
	// Copies are deleted whenever the setting or ephemeral mode turns autosave off, so there is
	// nothing to list then.
	if (!writing()) {
		autosave.offers = [];
		return autosave.offers;
	}
	let metas;
	try {
		metas = await listCopies();
	} catch (err) {
		if (err instanceof AutosaveUnavailableError) autosave.storage = 'unavailable';
		autosave.offers = [];
		return autosave.offers;
	}
	const live = await liveSlots();
	const own = getAutosaveSlot();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local lookup inside one call, never stored or rendered
	const protectedSlots = new Set([...live, own]);
	const drop = slotsToPrune(metas, {
		now: Date.now(),
		maxCopies: MAX_COPIES,
		maxAgeMs: MAX_AGE_MS,
		protectedSlots
	});
	if (drop.length) {
		try {
			await deleteCopies(drop);
		} catch {
			/* pruned next time */
		}
	}
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local lookup inside one call, never stored or rendered
	const dropped = new Set(drop);
	autosave.offers = metas.filter(
		(m) => !dropped.has(m.slot) && !protectedSlots.has(m.slot) && !hiddenSlots.has(m.slot)
	);
	return autosave.offers;
}

/** Leave this slot out of the offers (the crash toast is offering the same session). */
export function hideAutosaveOffer(slot) {
	if (!slot) return;
	hiddenSlots.add(slot);
	autosave.offers = autosave.offers.filter((m) => m.slot !== slot);
}

/** Delete one copy (the start screen's Discard). */
export async function discardAutosave(slot) {
	hiddenSlots.delete(slot);
	autosave.offers = autosave.offers.filter((m) => m.slot !== slot);
	try {
		await deleteCopies([slot]);
	} catch {
		/* already gone, or storage unavailable: nothing left to discard */
	}
}

/**
 * From now on this tab writes to `slot` (after restoring the session whose copy it holds), so
 * the restored session keeps ONE copy. When another open tab holds that slot, this tab keeps
 * its own and the other tab's copy is left alone.
 * @returns {Promise<boolean>} whether the slot was adopted
 */
export async function adoptAutosaveSlot(slot) {
	if (!slot || slot === getAutosaveSlot()) return true;
	if (!(await acquireLock(slot))) return false;
	const previous = getAutosaveSlot();
	if (haveOwnCopy) {
		try {
			await deleteCopies([previous]);
		} catch {
			/* pruned later */
		}
	}
	releaseLock(previous);
	setAutosaveSlot(slot);
	hiddenSlots.delete(slot);
	haveOwnCopy = true;
	lastFingerprint = null;
	autosave.offers = autosave.offers.filter((m) => m.slot !== slot);
	return true;
}

/**
 * Restore an autosaved copy into the app.
 *
 * @param {string} slot
 * @param {{ load: (session: object) => Promise<any>,
 *           confirmReplace?: (what: string) => Promise<boolean> }} deps
 *   `load` is importJson (the app's one safe loader: validated, all or nothing).
 * @returns {Promise<boolean>} false when the user cancelled
 */
export async function restoreAutosave(slot, { load, confirmReplace = async () => true }) {
	const copy = await readCopy(slot);
	if (!copy) {
		autosave.offers = autosave.offers.filter((m) => m.slot !== slot);
		throw new Error('That autosaved copy is no longer stored in this browser.');
	}
	const session = JSON.parse(copy.json);
	if (!(await confirmReplace(`the autosaved copy of "${copy.meta.name}"`))) return false;
	await load(session);
	// importJson marked the session saved and dropped any file target: neither is true of a copy.
	if (copy.handle) setSaveTarget(copy.handle);
	await adoptAutosaveSlot(slot);
	// Its only copy is the one in this browser, so closing the tab must ask, and autosave keeps
	// writing to the adopted slot.
	markSessionUnsaved();
	autosave.lastSavedAt = copy.meta.savedAt;
	return true;
}

// --- the setting ------------------------------------------------------------------------------
/**
 * Delete every autosaved copy, from every tab. Tabs that are still open write a new copy at
 * their next change (when autosave is on).
 * @returns {Promise<number>} how many copies were deleted
 */
export async function clearAutosavedCopies() {
	let n = 0;
	try {
		n = await clearCopies();
	} catch {
		n = 0;
	}
	haveOwnCopy = false;
	lastFingerprint = null;
	autosave.lastSavedAt = null;
	autosave.offers = [];
	return n;
}

/** Turn autosave on or off for this browser. Off deletes every copy. */
export async function setAutosaveEnabled(on) {
	autosave.enabled = !!on;
	if (hasWindow()) {
		try {
			if (on) window.localStorage?.removeItem(AUTOSAVE_PREF_KEY);
			else window.localStorage?.setItem(AUTOSAVE_PREF_KEY, '0');
		} catch {
			/* the in-memory setting still holds for this page */
		}
	}
	if (!on) {
		cancelScheduled();
		return clearAutosavedCopies();
	}
	await startWriting();
	return 0;
}

// --- start-up ---------------------------------------------------------------------------------
/**
 * This tab's lock first, so the listing cannot mistake this tab's own slot for a closed one;
 * then the offers, then a first write if the session already has unsaved changes. The lock is
 * taken even while autosave is off, so turning it on later needs nothing more.
 */
async function startWriting() {
	await acquireLock(getAutosaveSlot());
	await refreshAutosaveOffers();
	if (!writing()) return;
	lastFingerprint = null;
	scheduleAutosave();
}

/** Autosave was turned off, here or in another tab: stop, and forget the copy. */
function stopWriting() {
	cancelScheduled();
	haveOwnCopy = false;
	autosave.lastSavedAt = null;
	autosave.offers = [];
}

/**
 * Start autosave for this page. Idempotent.
 * @returns {Promise<void>} settles once the offers are listed
 */
export function initAutosave() {
	if (installed || !hasWindow()) return Promise.resolve();
	installed = true;

	removers.push(onSessionChange(() => scheduleAutosave()));
	pollTimer = setInterval(() => {
		if (writing() && sessionChangeFingerprint() !== lastFingerprint && !timer && !idleHandle) {
			scheduleAutosave();
		}
	}, POLL_MS);
	removers.push(() => clearInterval(pollTimer));

	// Leaving the page: write now. Best effort; the browser may end the page before IndexedDB
	// commits, which is why the debounced writes above exist at all.
	const now = () => void flushAutosave({ background: true });
	const onVisibility = () => {
		if (document.visibilityState === 'hidden') now();
	};
	document.addEventListener('visibilitychange', onVisibility);
	window.addEventListener('pagehide', now);
	removers.push(() => document.removeEventListener('visibilitychange', onVisibility));
	removers.push(() => window.removeEventListener('pagehide', now));

	// The setting, or ephemeral mode, changed in another tab. That tab has already deleted the
	// copies; this one must stop writing new ones (a copy written here after the other tab's
	// clear would outlive the choice), and start again when the setting comes back on.
	const onStorage = (e) => {
		if (e.key === AUTOSAVE_PREF_KEY) {
			autosave.enabled = e.newValue !== '0';
			if (!autosave.enabled) stopWriting();
			else void startWriting();
		} else if (e.key === EPHEMERAL_MODE_KEY) {
			privacy.ephemeral = e.newValue === '1';
			if (privacy.ephemeral) stopWriting();
			else void startWriting();
		}
	};
	window.addEventListener('storage', onStorage);
	removers.push(() => window.removeEventListener('storage', onStorage));

	return startWriting();
}

/**
 * Ephemeral mode was just turned on or off in this tab (Settings calls this after
 * setEphemeral). On: nothing more is written, and every copy is deleted, after any write that
 * was already under way so it cannot land after the clear. Off: autosave starts again, subject
 * to its own setting.
 * @returns {Promise<number>} how many copies were deleted
 */
export async function autosaveEphemeralChanged() {
	if (!privacy.ephemeral) {
		await startWriting();
		return 0;
	}
	stopWriting();
	if (writeInFlight) await writeInFlight.catch(() => {});
	return clearAutosavedCopies();
}

/** Test seam: forget everything this module holds. */
export function _resetAutosaveForTest() {
	for (const r of removers) r();
	removers = [];
	cancelScheduled();
	for (const slot of [...lockReleasers.keys()]) releaseLock(slot);
	installed = false;
	writeInFlight = null;
	rerun = false;
	lastFingerprint = null;
	haveOwnCopy = false;
	lastCostMs = 0;
	tooLargeNoticeShown = false;
	hiddenSlots.clear();
	autosave.enabled = readPref();
	autosave.storage = 'ok';
	autosave.lastSavedAt = null;
	autosave.offers = [];
}
