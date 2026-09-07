// @ts-nocheck
// First-run detection for the one-time "New here?" help hint (the coach mark on the
// navbar's ? button, shown the first time the start screen dismisses).
//
// A user counts as NEW only when the browser holds no evidence of prior use:
//   • they have never engaged with the hint / Help / a tour (ENGAGED_KEY unset), AND
//   • the recents index is empty (they have never opened a session or example), AND
//   • no tour has ever been completed.
//
// All storage goes through `store` (localData.svelte.js) so ephemeral mode is
// respected, and every read/write is additionally wrapped in try/catch: in private
// browsing or a locked-down profile the storage accessor itself can throw, and the
// safe answer there is "treat them as new but never crash".

import { store } from '$lib/core/localData.svelte.js';

/** '1' once the user has dismissed the hint, opened Help, or started a tour. */
export const ENGAGED_KEY = 'ancir.firstRun.engaged';
/** The start screen's recents index (recentSessions.svelte.js). Read-only here. */
const RECENTS_KEY = 'ancir.recents.v1';
/** Completed tours (tourRunner.svelte.js). Read-only here. */
const TOURS_KEY = 'ancir.tours.completed';

/** Read a JSON array under `key`; anything unreadable or malformed is []. */
function readJsonArray(key) {
	try {
		const parsed = JSON.parse(store.getItem(key) ?? '[]');
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

/** Has the user ever engaged (dismissed the hint, opened Help, or started a tour)? */
export function hasEngaged() {
	try {
		return store.getItem(ENGAGED_KEY) === '1';
	} catch {
		return false;
	}
}

/**
 * No evidence of prior use anywhere. The dedicated flag is checked first, but the
 * recents index and completed tours also count as evidence so an EXISTING user who
 * predates this feature is never treated as new.
 */
export function isNewUser() {
	if (hasEngaged()) return false;
	if (readJsonArray(RECENTS_KEY).length > 0) return false;
	if (readJsonArray(TOURS_KEY).length > 0) return false;
	return true;
}

let sessionVerdict = null;

/**
 * `isNewUser()`, evaluated ONCE and frozen for the rest of the page load.
 *
 * The freshness must be judged BEFORE the user's first action, because the first
 * action itself creates evidence: opening an example writes the recents index, so
 * by the time the start screen has closed a brand-new user already looks like a
 * returning one. +page primes this at mount; later callers get the mount-time
 * verdict. (Engagement is separate — check hasEngaged() for that.)
 */
export function wasNewAtSessionStart() {
	if (sessionVerdict === null) sessionVerdict = isNewUser();
	return sessionVerdict;
}

/** Test-only: forget the cached session verdict. */
export function _resetFirstRunForTests() {
	sessionVerdict = null;
}

/**
 * Flip the flag, permanently. Idempotent, and a no-op write is skipped so the
 * common paths (every Help-menu open, every tour start) don't touch storage after
 * the first time.
 */
export function markEngaged() {
	try {
		if (store.getItem(ENGAGED_KEY) !== '1') store.setItem(ENGAGED_KEY, '1');
	} catch {
		/* private mode / quota — the hint may show again next visit, which is safe */
	}
}
