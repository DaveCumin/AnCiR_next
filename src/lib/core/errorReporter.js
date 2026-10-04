// @ts-nocheck
// What happens when something throws.
//
// Until now: nothing. An error anywhere — a plot with a field its class didn't default, an
// analysis fed a column of the wrong type — unmounted the component tree and left a blank
// canvas with the stack in a console the user never opens. The work looked lost, and nobody
// found out unless the user said so.
//
// So three things, in this order of importance:
//   1. TELL the user, truthfully: what happened, and where their work is.
//   2. KEEP a copy of the session locally, because the one thing we must not do is lose it.
//      The copy is offered back on the next load of the page (crashRecovery.js), which is
//      what makes "a copy was kept" a promise rather than a comfort (ROB-5).
//   3. REPORT it, so a crash nobody mentions still gets fixed.
//
// Containment itself is `<svelte:boundary>` at the call sites (ErrorBoundary.svelte) — this
// module is what a boundary (or a stray window error) hands the error to. Only a boundary
// can say the error was CONTAINED; a window or promise error may have left anything half
// done, and the toast says so (ROB-12).

import { addNotification } from './notifications.svelte.js';
import { core, appConsts, outputCoreAsJson } from './core.svelte.js';
import { NL_URL, NL_CONFIGURED } from '$lib/utils/nlSession.js';

/** Where a crashed session is parked. One slot: the latest crash is the one being debugged. */
export const CRASH_SNAPSHOT_KEY = 'ancir:last-crash-session';

/**
 * sessionStorage, NOT localStorage — and this is a privacy decision, not a technical one.
 *
 * This slot holds a WHOLE session: every imported column, which for actigraphy is often
 * identifiable in practice. In localStorage it outlived the tab, the browser restart and the
 * user, sitting in the profile of whatever shared lab machine the crash happened on, with
 * nothing in the app that ever deleted it.
 *
 * sessionStorage gives up nothing that matters here. It is scoped to the tab and cleared by the
 * BROWSER when that tab closes — no unload handler, which could not be made reliable anyway —
 * and a tab restored after a crash keeps its sessionStorage, which is the only case this
 * snapshot exists for.
 */
function snapshotStore() {
	if (typeof window === 'undefined') return null;
	try {
		return window.sessionStorage ?? null;
	} catch {
		return null;
	}
}

// A broken render doesn't throw once — an effect retries, the boundary re-runs, and the same
// error arrives dozens of times a second. Without this the user gets a wall of toasts and the
// Worker gets a stampede, both describing one bug.
const seen = new Map(); // fingerprint -> timestamp
const REPEAT_WINDOW_MS = 30_000;
let installed = false;

/** Identify an error by what it IS, not when it happened, so repeats collapse. */
const fingerprintOf = (message, stack) =>
	`${message}\n${(stack ?? '').split('\n').slice(0, 3).join('\n')}`;

function isRepeat(key) {
	const now = Date.now();
	// Opportunistic sweep — this map only ever holds a handful of distinct crashes.
	for (const [k, t] of seen) if (now - t > REPEAT_WINDOW_MS) seen.delete(k);
	if (seen.has(key)) return true;
	seen.set(key, now);
	return false;
}

/**
 * Park a copy of the session so a crash can't cost the user their work.
 *
 * Local storage rather than the network: it's THEIR data, it may be unpublished, and this is a
 * recovery aid, not telemetry. Quota is the interesting failure — a session carrying real
 * imported data can exceed it — so a failed save is reported honestly rather than pretended.
 * See snapshotStore() above for why that local store is the tab-scoped one.
 *
 * @returns {boolean} whether a copy was actually written
 */
export function saveCrashSnapshot() {
	const s = snapshotStore();
	if (!s) return false;
	// Nothing to keep: an empty app has no work to lose, and offering to "restore" it would
	// be noise.
	if (!sessionHasWork()) return false;
	try {
		s.setItem(
			CRASH_SNAPSHOT_KEY,
			JSON.stringify({ savedAt: new Date().toISOString(), session: JSON.parse(outputCoreAsJson()) })
		);
		return true;
	} catch {
		// Quota exceeded, private mode, or a session that won't serialise. Losing the snapshot is
		// bad; throwing FROM the crash handler would be worse.
		return false;
	}
}

/** True when the open session holds anything a crash could cost the user. */
function sessionHasWork() {
	return (
		(core?.data?.length ?? 0) > 0 ||
		(core?.tableProcesses?.length ?? 0) > 0 ||
		(core?.plots?.length ?? 0) > 0 ||
		(core?.notes?.length ?? 0) > 0
	);
}

/** The saved session from the last crash, or null. */
export function readCrashSnapshot() {
	const s = snapshotStore();
	if (!s) return null;
	try {
		return JSON.parse(s.getItem(CRASH_SNAPSHOT_KEY) ?? 'null');
	} catch {
		return null;
	}
}

/**
 * Read the snapshot and delete it in the same breath, for the recovery path.
 *
 * A recovered session is IN the app; leaving the copy behind means a second, invisible copy of
 * the user's data persisting for no further benefit. Read-and-forget is the only access a
 * recovery flow should need.
 */
export function takeCrashSnapshot() {
	const snap = readCrashSnapshot();
	clearCrashSnapshot();
	return snap;
}

export function clearCrashSnapshot() {
	try {
		snapshotStore()?.removeItem(CRASH_SNAPSHOT_KEY);
		// Also sweep the old localStorage slot: sessions crashed before this change left a full
		// copy there that nothing else will ever delete.
		if (typeof window !== 'undefined') window.localStorage?.removeItem(CRASH_SNAPSHOT_KEY);
	} catch {
		/* nothing to do */
	}
}

/**
 * True when the app is running on a developer's machine (dev server OR `vite preview`), not a
 * real deployment. Host-based rather than `import.meta.env.DEV`, because a production BUILD served
 * from `vite preview` is still localhost and still ours — and it's the same host either way.
 */
function isLocalHost() {
	if (typeof location === 'undefined') return false; // SSR / no DOM ⇒ not a user's browser
	const h = location.hostname;
	return (
		h === 'localhost' ||
		h === '127.0.0.1' ||
		h === '::1' ||
		h === '[::1]' ||
		h === '' ||
		h.endsWith('.local')
	);
}

/** Fire-and-forget to the Worker's /report. Never throws, never blocks, never waits. */
function report(fields) {
	if (!NL_CONFIGURED) return; // no AI service configured ⇒ nowhere to send it
	// Only real users' crashes belong in the shared log. On localhost the reporter would otherwise
	// flood it with transient HMR-time ReferenceErrors from half-saved refactors — which is exactly
	// what buried the single genuine production report under 20+ dev ones. The user-facing half of a
	// crash (the toast, the local session snapshot) is in reportError, not here, so it still happens.
	if (isLocalHost()) return;
	try {
		const body = JSON.stringify(fields);
		// keepalive so a report survives the user closing the tab straight after the crash —
		// exactly when they're most likely to close it.
		fetch(`${NL_URL}/report`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body,
			keepalive: true
		}).catch(() => {});
	} catch {
		/* reporting must never itself break anything */
	}
}

/**
 * The crash toast, worded for what is actually true (ROB-5, ROB-12).
 *
 *  - Only an error caught by a boundary was CONTAINED: an on-screen piece ('render') shows
 *    an error box; a hidden compute instance ('background') has no box to show, so the
 *    toast says its outputs may be stale. A window or promise error was caught by nobody;
 *    whatever it interrupted may be half done.
 *  - "A copy was kept" only when the snapshot was written, and it says where (this tab) and
 *    how to get it back (reload; the app offers it, see crashRecovery.js).
 *
 * Exported for the tests.
 */
export function crashToastText({ source, context, saved, hadWork = true, message }) {
	const where = context ? ` while ${context}` : '';
	let what;
	if (source === 'render') {
		what =
			`Something went wrong${where}. It was contained: that part shows an error box with ` +
			'a Try again button, and the rest of your session is still open. ';
	} else if (source === 'background') {
		// A hidden compute instance (NodeComputeHost): contained, but there is no box to see.
		what =
			`Something went wrong${where}. It was contained to that calculation, which is not ` +
			'on screen: its outputs may be out of date until you open it. The rest of your ' +
			'session is still open. ';
	} else {
		what =
			`Something went wrong${where}. Part of the app may not have finished what it was ` +
			'doing, so check your results. ';
	}
	let keep = '';
	if (saved) {
		keep =
			'A copy of your session was kept in this browser tab: if the app stops responding, ' +
			'reload the page and AnCiR will offer to restore it. ';
	} else if (hadWork) {
		keep = 'No copy could be kept in this browser, so save your session now to be safe. ';
	}
	return `${what}${keep}Undo may reverse it.\n${message}`;
}

/**
 * Handle one error: tell the user, keep their session, report it.
 *
 * @param {unknown} error
 * @param {{source?: string, context?: string, silent?: boolean}} [opts]
 *   source  — 'render' | 'background' | 'window' | 'promise'
 *   context — what the app was doing ('ai-edit'), when it knows
 */
export function reportError(error, { source = 'unknown', context } = {}) {
	const message = error?.message ?? String(error ?? 'Unknown error');
	const stack = error?.stack;
	const key = fingerprintOf(message, stack);

	// Always log locally — this is the one place a developer looks, and it must not be throttled
	// away or hidden behind a toast.
	console.error(`[AnCiR ${source} error]`, error);

	if (isRepeat(key)) return;

	const hadWork = sessionHasWork();
	const saved = saveCrashSnapshot();

	// Lead with what the user needs to know: what broke, how far it reached, and where their
	// work is. The message itself goes last — it's for whoever they forward it to.
	addNotification(crashToastText({ source, context, saved, hadWork, message }), 'error', 15000);

	report({
		message,
		stack,
		source,
		context,
		version: appConsts?.version,
		url: typeof location !== 'undefined' ? location.href : undefined,
		sessionShape: {
			columns: core?.data?.length ?? 0,
			analyses: core?.tableProcesses?.length ?? 0,
			plots: core?.plots?.length ?? 0
		},
		// If this session came from the AI, its id ties the crash to the prompt that built it.
		generatedBy: core?.generatedBy ?? undefined
	});
}

/**
 * Catch what no boundary can: errors from event handlers, timers, and rejected promises.
 *
 * A `<svelte:boundary>` only sees errors thrown during render/effects of its own subtree. These
 * two listeners are the backstop for everything else. Idempotent.
 */
export function installErrorReporter() {
	if (installed || typeof window === 'undefined') return;
	installed = true;

	// One-time sweep of the pre-sessionStorage slot. Anyone who crashed before this change has a
	// whole session — imported data included — sitting in localStorage that nothing would ever
	// remove. Moving the snapshot only helps future crashes; the old copies have to be collected.
	try {
		window.localStorage?.removeItem(CRASH_SNAPSHOT_KEY);
	} catch {
		/* private mode */
	}

	window.addEventListener('error', (e) => {
		// Resource load failures (a missing image) also fire 'error' but carry no `error` object
		// and aren't application crashes.
		if (!e.error) return;
		reportError(e.error, { source: 'window' });
	});

	window.addEventListener('unhandledrejection', (e) => {
		reportError(e.reason, { source: 'promise' });
	});
}
