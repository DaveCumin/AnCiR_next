// @ts-nocheck
// Reactive state for the one-time "New here?" coach mark on the navbar's ? button.
//
// The start screen already owns the FIRST moment, so the hint appears only when
// that screen closes (the user's first real action — dismissing it, or loading an
// example/session from it), after a short delay so it doesn't flash mid-transition.
// New users only (utils/firstRun.js), one showing per session, and any engagement
// — the X, opening Help, starting a tour — ends it permanently.

import { wasNewAtSessionStart, hasEngaged, markEngaged } from '$lib/utils/firstRun.js';

export const HINT_DELAY_MS = 500;

/** Read by Navbar: `visible` drives the halo + callout on the ? button. */
export const helpHint = $state({ visible: false });

let shownThisSession = false;
let timer = null;

/**
 * Call when the start screen closes. Shows the coach mark HINT_DELAY_MS later —
 * for new users only, at most once per session. Re-checks newness when the timer
 * fires, because the user may have engaged during the delay (e.g. started a tour
 * from the start screen's own tour band, which must suppress the hint).
 */
export function queueHelpHint() {
	if (shownThisSession || helpHint.visible || timer != null) return;
	// Judged against the SESSION-START snapshot: the first action that closed the
	// start screen (e.g. opening an example) has already written recents by now,
	// which must not make a brand-new user look like a returning one.
	if (!wasNewAtSessionStart()) return;
	timer = setTimeout(() => {
		timer = null;
		if (shownThisSession || hasEngaged()) return;
		shownThisSession = true;
		helpHint.visible = true;
	}, HINT_DELAY_MS);
}

/**
 * Any engagement ends the affordance permanently: the callout's X, its "Take a
 * tour" button, opening the Help menu, or starting a tour (tourRunner calls this).
 * Safe to call at any time — it also cancels a pending showing.
 */
export function dismissHelpHint() {
	if (timer != null) {
		clearTimeout(timer);
		timer = null;
	}
	shownThisSession = true;
	if (helpHint.visible) helpHint.visible = false;
	markEngaged();
}

/** Test-only: reset the module's session-scoped memory. */
export function _resetHelpHintForTests() {
	if (timer != null) clearTimeout(timer);
	timer = null;
	shownThisSession = false;
	helpHint.visible = false;
}
