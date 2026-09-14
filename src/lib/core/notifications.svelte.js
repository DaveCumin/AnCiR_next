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
 * @returns {string} the notification id (usable with removeNotification)
 */
export function addNotification(message, type = 'error', duration = 5000, action = null) {
	const id = crypto.randomUUID();
	notifications.list.push({ id, message, type, action });

	if (duration > 0) {
		setTimeout(() => removeNotification(id), duration);
	}
	return id;
}

export function removeNotification(id) {
	const idx = notifications.list.findIndex((n) => n.id === id);
	if (idx !== -1) notifications.list.splice(idx, 1);
}
