// @ts-nocheck

export const notifications = $state({ list: [] });

/**
 * @param {string} message
 * @param {'error'|'info'|'warning'} [type='error']
 * @param {number} [duration=5000] ms before auto-dismiss (0 = manual only)
 */
export function addNotification(message, type = 'error', duration = 5000) {
	const id = crypto.randomUUID();
	notifications.list.push({ id, message, type });

	if (duration > 0) {
		setTimeout(() => removeNotification(id), duration);
	}
}

export function removeNotification(id) {
	const idx = notifications.list.findIndex((n) => n.id === id);
	if (idx !== -1) notifications.list.splice(idx, 1);
}
