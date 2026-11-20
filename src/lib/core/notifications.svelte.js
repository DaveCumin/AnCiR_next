// @ts-nocheck
import { announce } from '$lib/utils/announce.js';

export const notifications = $state({ list: [] });

// ─── Timing (WCAG 2.2.1 Timing Adjustable, 2.2.2 Pause, Stop, Hide) ────────────────────────
// A toast with a working action (Undo, Restore session) stays until it is used or closed: a
// timer that takes the action away before a keyboard or screen reader user can reach it is
// exactly what 2.2.1 forbids. Every other toast times out, but its clock stops while the
// pointer is over a toast or focus is inside one, and runs on (with the time it had left) once
// both have gone. An action that goes stale (an Undo buried by later edits answers
// `enabled() === false`) makes its toast an ordinary one, which then times out as usual.
//
// Kept outside the $state list on purpose: timer handles and deadlines are bookkeeping that
// nothing renders, and a $state proxy around them would only cost.
/** id -> { duration, remaining, deadline, handle } */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- timer bookkeeping that nothing renders (see above)
const timing = new Map();
/** Toast ids under the pointer / holding focus. Per id, so a toast removed while hovered or
 *  focused (no pointerleave or focusout ever arrives for it) cannot hold the clocks forever. */
const held = { hover: new Set(), focus: new Set() };
const isHeld = () => held.hover.size > 0 || held.focus.size > 0;

// More than this many toasts at once and the oldest ones that would time out anyway go first,
// so a burst cannot stack toasts up the screen. Toasts with a working action and toasts the
// caller made manual-only (duration 0) are never dropped: they carry something to act on.
export const MAX_TOASTS = 4;

/** Whether a toast's action is there to be used (its button is showing). */
export function isActionable(n) {
	if (!n?.action) return false;
	try {
		return n.action.enabled?.() ?? true;
	} catch {
		return false;
	}
}

function arm(id) {
	const t = timing.get(id);
	if (!t || t.handle != null || !(t.remaining > 0)) return;
	t.deadline = Date.now() + t.remaining;
	t.handle = setTimeout(() => removeNotification(id), t.remaining);
}

function disarm(id) {
	const t = timing.get(id);
	if (!t || t.handle == null) return;
	clearTimeout(t.handle);
	t.handle = null;
	t.remaining = Math.max(0, t.deadline - Date.now());
}

/** Whether toast `id` is counting down right now (for tests and the e2e). */
export function isCountingDown(id) {
	return timing.get(id)?.handle != null;
}

/**
 * @param {string} message
 * @param {'error'|'info'|'warning'} [type='error']
 * @param {number} [duration=5000] ms before auto-dismiss (0 = manual only). For a toast with
 *   an action this applies only once the action has gone stale (see `enabled`): while the
 *   action works the toast stays until it is used or closed.
 * @param {{ label: string, run: () => void, enabled?: () => boolean }} [action]
 *   optional action button (e.g. a toast-level Undo). `run` fires on click and the
 *   toast then dismisses itself. `enabled`, when given, is re-read reactively by the
 *   toast component; the button hides once it answers false — used to hide a stale
 *   Undo when later edits have buried the op it targeted.
 * @param {{ onDismiss?: () => void }} [opts]
 *   `onDismiss` runs when the user closes the toast with its close button (not when the action
 *   button is used, and not when it times out). Used where closing means "no thanks", e.g.
 *   discarding the crash copy the restore offer is about.
 * @returns {string} the notification id (usable with removeNotification)
 */
export function addNotification(
	message,
	type = 'error',
	duration = 5000,
	action = null,
	{ onDismiss = null } = {}
) {
	const id = crypto.randomUUID();
	const n = { id, message, type, action, onDismiss };
	notifications.list.push(n);
	// A toast on screen says nothing to a screen reader: read it through the app's live
	// regions (an error interrupts, the rest wait), naming its button and the key that reaches
	// it when it has one. Read once, here; the toast itself is not a live region.
	const actionNote = action?.label
		? ` ${action.label} is in the notification; press ${toastKeyLabel()} to reach it.`
		: '';
	announce(`${message}${actionNote}`, { assertive: type === 'error' });

	timing.set(id, { duration, remaining: duration, deadline: 0, handle: null });
	if (duration > 0 && !isActionable(n) && !isHeld()) arm(id);
	trimToasts();
	return id;
}

/** Drop the oldest toasts that would time out anyway while there are more than MAX_TOASTS. */
function trimToasts() {
	let excess = notifications.list.length - MAX_TOASTS;
	for (let i = 0; excess > 0 && i < notifications.list.length; ) {
		const n = notifications.list[i];
		if ((timing.get(n.id)?.duration ?? 0) > 0 && !isActionable(n)) {
			removeNotification(n.id);
			excess--;
		} else i++;
	}
}

/**
 * The toast component reports whether a toast's action is (still) usable: a working action
 * stops the clock, a stale one starts it. Reading `enabled()` needs the component's reactivity
 * (it consults $state such as the undo stack), hence the call from there.
 */
export function setActionable(id, actionable) {
	const t = timing.get(id);
	if (!t) return;
	t.actionable = actionable;
	if (actionable) {
		disarm(id);
		t.remaining = t.duration; // a fresh full spell once it goes stale again
	} else if (t.duration > 0 && !isHeld()) arm(id);
}

/**
 * Pointer over / focus inside toast `id` (`on` true) or no longer (`on` false). While anything
 * holds, every toast's clock is stopped (so nothing slides around under the pointer either).
 * @param {'hover'|'focus'} kind
 */
export function holdNotification(id, kind, on) {
	const wasHeld = isHeld();
	if (on) held[kind].add(id);
	else held[kind].delete(id);
	const nowHeld = isHeld();
	if (!wasHeld && nowHeld) for (const key of timing.keys()) disarm(key);
	if (wasHeld && !nowHeld) resumeAll();
}

function resumeAll() {
	for (const n of notifications.list) {
		const t = timing.get(n.id);
		if (t && t.duration > 0 && !t.actionable && !isActionable(n)) arm(n.id);
	}
}

/** The user closed the toast (its close button): run its onDismiss, then remove it. */
export function dismissNotification(id) {
	const n = notifications.list.find((x) => x.id === id);
	try {
		n?.onDismiss?.();
	} finally {
		removeNotification(id);
	}
}

export function removeNotification(id) {
	const t = timing.get(id);
	if (t?.handle != null) clearTimeout(t.handle);
	timing.delete(id);
	const wasHeld = isHeld();
	held.hover.delete(id);
	held.focus.delete(id);
	const idx = notifications.list.findIndex((n) => n.id === id);
	if (idx !== -1) notifications.list.splice(idx, 1);
	if (wasHeld && !isHeld()) resumeAll();
}

// ─── The key that reaches the newest toast ─────────────────────────────────────────────────
// Alt+T (Option+T on a Mac; matched on event.code, since Option+T types "†") or F8. A toast
// never takes focus when it appears (it would pull a user out of whatever they are typing,
// WCAG 3.2.2, and the ARIA APG alert pattern says an alert must not move focus), so this is
// how a keyboard user gets to its button. F8 is what Radix's toast viewport uses; Alt+T is the
// one a Mac keyboard can press without Fn. AltGr (Windows) reports Ctrl+Alt, so the !ctrlKey
// test already leaves AltGr+T to the keyboard layout; Option on a Mac reads as AltGraph in some
// browsers, which is why that modifier is not checked.
export function isToastKey(e) {
	if (e.key === 'F8' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) return true;
	return e.code === 'KeyT' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
}

export const TOAST_KEYSHORTCUTS = 'Alt+T F8';

function isMac() {
	if (typeof navigator === 'undefined') return false;
	return /MAC/i.test(navigator.platform || '') || /MAC/i.test(navigator.userAgent || '');
}

/** "Option+T" on a Mac, "Alt+T" elsewhere: what the announcement tells the user to press. */
export function toastKeyLabel() {
	return isMac() ? 'Option+T' : 'Alt+T';
}
