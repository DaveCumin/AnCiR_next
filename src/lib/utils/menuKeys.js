// The keyboard contract of a menu button's menu (WAI-ARIA APG "Menu Button"): the Help menu in
// the navbar. Opening it from the keyboard puts focus on its first item; ArrowDown/ArrowUp move
// between the items (wrapping), Home/End go to the ends, Escape closes it and gives focus back to
// its button, and Tab closes it and lets focus move on as usual.
//
// Pure: the caller owns the open state and the elements.

/**
 * What a keydown inside an open menu does.
 * @param {{ key: string }} e
 * @returns {null | 'next' | 'prev' | 'first' | 'last' | 'close' | 'leave'}
 *   'close' (Escape): close and focus the button; 'leave' (Tab): close, let focus move on.
 */
export function menuKeyAction(e) {
	switch (e.key) {
		case 'ArrowDown':
			return 'next';
		case 'ArrowUp':
			return 'prev';
		case 'Home':
			return 'first';
		case 'End':
			return 'last';
		case 'Escape':
			return 'close';
		case 'Tab':
			return 'leave';
		default:
			return null;
	}
}

/**
 * The index to focus for `action`, among `count` items with `current` focused (-1: none).
 * @param {'next' | 'prev' | 'first' | 'last'} action
 * @param {number} current
 * @param {number} count
 */
export function menuIndex(action, current, count) {
	if (count <= 0) return -1;
	if (action === 'first') return 0;
	if (action === 'last') return count - 1;
	if (action === 'next') return current < 0 ? 0 : (current + 1) % count;
	return current < 0 ? count - 1 : (current - 1 + count) % count;
}

/** The menu's items, in order. */
export const menuItems = (menu) => [...(menu?.querySelectorAll('[role^="menuitem"]') ?? [])];
