// @ts-nocheck

export const notifications = $state({ list: [] });

/**
 * @param {string} message
 * @param {'error'|'info'|'warning'} [type='error']
 * @param {number} [duration=5000] ms before auto-dismiss (0 = manual only)
 * @param {{ label: string, run: () => void, enabled?: () => boolean }} [action]
 *   optional action button (e.g. a toast-level Undo). `run` fires on click and the
 *   toast then dismisses itself. `enabled`, when given, is re-read reactively by the
 *   toast component; the button hides once it answers false — used to hide a stale
 *   Undo when later edits have buried the op it targeted.
 * @param {{ onDismiss?: () => void }} [opts]
 *   `onDismiss` runs when the user closes the toast with its ✕ (not when the action button
 *   is used, and not when it times out). Used where closing means "no thanks", e.g.
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
	notifications.list.push({ id, message, type, action, onDismiss });

	if (duration > 0) {
		setTimeout(() => removeNotification(id), duration);
	}
	return id;
}

/** The user closed the toast (its ✕): run its onDismiss, then remove it. */
export function dismissNotification(id) {
	const n = notifications.list.find((x) => x.id === id);
	try {
		n?.onDismiss?.();
	} finally {
		removeNotification(id);
	}
}

export function removeNotification(id) {
	const idx = notifications.list.findIndex((n) => n.id === id);
	if (idx !== -1) notifications.list.splice(idx, 1);
}
