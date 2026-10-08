// focusTrap: the keyboard contract of an overlay that declares itself modal (aria-modal) but is
// not a native <dialog> (review UI-6). Native dialogs opened with showModal() get all of this
// from the browser, which is why Modal.svelte needs none of it; the start screen and the tour
// picker are plain elements, so they owe it themselves:
//
//   - focus moves in when the overlay opens: the first actionable element, or `initialFocus`,
//     or the overlay itself (`focusContainer`, or when it has nothing actionable yet);
//   - Tab and Shift+Tab wrap at the ends instead of walking out to the page underneath;
//   - Escape calls `onEscape`, when given (leave it out where closing is not allowed or is
//     handled elsewhere), and goes no further, so an overlay underneath does not also close;
//   - focus returns to whatever had it before when the overlay closes, or to `fallbackFocus()`
//     when that element has left the page (a menu item whose menu closed).
//
// Used as a Svelte attachment: `<div role="dialog" aria-modal="true" {@attach focusTrap({...})}>`.
// `enabled` pauses the trap while a child dialog stacked on top owns the keyboard.

const TABBABLE = [
	'a[href]',
	'area[href]',
	'button:not([disabled])',
	'input:not([disabled]):not([type="hidden"])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'iframe',
	'[contenteditable="true"]',
	'[tabindex]'
].join(',');

/** Whether `el` can take focus from the keyboard right now. Layout-free, so it works in tests. */
function isTabbable(el) {
	if (el.tabIndex < 0) return false;
	if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
	// The contents of a closed native <dialog> are not rendered.
	const dialog = el.closest('dialog');
	if (dialog && !dialog.open) return false;
	// display:none and visibility:hidden from a stylesheet. Every current browser has
	// checkVisibility; the test DOM does not, and there the attribute checks above suffice.
	if (typeof el.checkVisibility === 'function') {
		return el.checkVisibility({ visibilityProperty: true });
	}
	return true;
}

/** The keyboard-focusable elements inside `container`, in DOM (tab) order. */
export function tabbables(container) {
	return [...container.querySelectorAll(TABBABLE)].filter(isTabbable);
}

/**
 * @param {object} [opts]
 * @param {string} [opts.initialFocus]  selector, inside the overlay, for the element to focus first.
 * @param {boolean} [opts.focusContainer]  focus the overlay itself on open, so a large screen does
 *   not open with a focus ring on its first card; Tab then enters at the first control.
 * @param {() => (HTMLElement | null)} [opts.fallbackFocus]  where focus goes on close when the
 *   element that had it before is gone.
 * @param {() => void} [opts.onEscape]  close the overlay; omit where closing is not allowed.
 * @param {() => boolean} [opts.enabled]  false while something stacked on top owns the keyboard.
 * @returns {(node: HTMLElement) => () => void}
 */
export function focusTrap({ initialFocus, focusContainer, fallbackFocus, onEscape, enabled } = {}) {
	return (node) => {
		const doc = node.ownerDocument;
		const previouslyFocused = doc.activeElement;

		const focusFirst = () => {
			const target = focusContainer
				? null
				: (initialFocus && node.querySelector(initialFocus)) || tabbables(node)[0] || null;
			if (target) {
				target.focus();
				return;
			}
			// Asked to, or nothing actionable yet (a list still loading): hold focus on the overlay
			// itself, so Tab starts from inside it rather than from the page underneath.
			if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
			node.focus();
		};

		/** @param {KeyboardEvent} e */
		const onKeydown = (e) => {
			if (enabled && !enabled()) return;
			if (e.key === 'Escape' && onEscape) {
				e.preventDefault();
				e.stopPropagation();
				onEscape();
				return;
			}
			if (e.key !== 'Tab') return;
			const items = tabbables(node);
			if (items.length === 0) {
				e.preventDefault();
				return;
			}
			const first = items[0];
			const last = items[items.length - 1];
			const active = doc.activeElement;
			const atContainer = active === node || !node.contains(active);
			if (e.shiftKey && (active === first || atContainer)) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && (active === last || atContainer)) {
				e.preventDefault();
				first.focus();
			}
		};

		node.addEventListener('keydown', onKeydown);
		focusFirst();

		return () => {
			node.removeEventListener('keydown', onKeydown);
			// Back to where the user was, if that is still on the page (the opener may have gone).
			const back =
				previouslyFocused &&
				previouslyFocused !== doc.body &&
				previouslyFocused.isConnected &&
				typeof previouslyFocused.focus === 'function'
					? previouslyFocused
					: (fallbackFocus?.() ?? null);
			back?.focus();
		};
	};
}
