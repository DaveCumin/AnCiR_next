// @ts-nocheck
// What happens when something throws.
//
// Until now: nothing. An error anywhere — a plot with a field its class didn't default, an
// analysis fed a column of the wrong type — unmounted the component tree and left a blank
// canvas with the stack in a console the user never opens. The work looked lost, and nobody
// found out unless the user said so.
//
// So three things, in this order of importance:
//   1. TELL the user, and say their work is still there. A blank canvas reads as data loss.
//   2. KEEP a copy of the session locally, because the one thing we must not do is lose it.
//   3. REPORT it, so a crash nobody mentions still gets fixed.
//
// Containment itself is `<svelte:boundary>` at the call sites — this module is what a boundary
// (or a stray window error) hands the error to.

import { addNotification } from './notifications.svelte.js';
import { core, appConsts, outputCoreAsJson } from './core.svelte.js';
import { NL_URL, NL_CONFIGURED } from '$lib/utils/nlSession.js';

/** Where a crashed session is parked. One slot: the latest crash is the one being debugged. */
export const CRASH_SNAPSHOT_KEY = 'ancir:last-crash-session';

// A broken render doesn't throw once — an effect retries, the boundary re-runs, and the same
// error arrives dozens of times a second. Without this the user gets a wall of toasts and the
// Worker gets a stampede, both describing one bug.
const seen = new Map(); // fingerprint -> timestamp
const REPEAT_WINDOW_MS = 30_000;
let installed = false;

/** Identify an error by what it IS, not when it happened, so repeats collapse. */
const fingerprintOf = (message, stack) => `${message}\n${(stack ?? '').split('\n').slice(0, 3).join('\n')}`;

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
 * localStorage rather than the network: it's THEIR data, it may be unpublished, and this is a
 * recovery aid, not telemetry. Quota is the interesting failure — a session carrying real
 * imported data can exceed it — so a failed save is reported honestly rather than pretended.
 *
 * @returns {boolean} whether a copy was actually written
 */
export function saveCrashSnapshot() {
	if (typeof localStorage === 'undefined') return false;
	try {
		localStorage.setItem(
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

/** The saved session from the last crash, or null. */
export function readCrashSnapshot() {
	if (typeof localStorage === 'undefined') return null;
	try {
		return JSON.parse(localStorage.getItem(CRASH_SNAPSHOT_KEY) ?? 'null');
	} catch {
		return null;
	}
}

export function clearCrashSnapshot() {
	try {
		localStorage?.removeItem(CRASH_SNAPSHOT_KEY);
	} catch {
		/* nothing to do */
	}
}

/** Fire-and-forget to the Worker's /report. Never throws, never blocks, never waits. */
function report(fields) {
	if (!NL_CONFIGURED) return; // no AI service configured ⇒ nowhere to send it
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
 * Handle one error: tell the user, keep their session, report it.
 *
 * @param {unknown} error
 * @param {{source?: string, context?: string, silent?: boolean}} [opts]
 *   source  — 'render' | 'window' | 'promise'
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

	const saved = saveCrashSnapshot();

	// Lead with what the user needs to know: it broke, and their session is safe. The message
	// itself goes last — it's for whoever they forward it to.
	addNotification(
		`Something went wrong${context ? ` while ${context}` : ''} and was contained. ` +
			(saved
				? 'A copy of your session was saved in this browser. '
				: 'Your session is still open — save it now to be safe. ') +
			`Undo may reverse it.\n${message}`,
		'error',
		15000
	);

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
