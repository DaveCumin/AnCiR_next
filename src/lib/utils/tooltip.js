// @ts-nocheck
// Shared hover-tooltip attachment. Use as `{@attach tooltip('Reset viewport')}`.
//
// One overlay element is appended to <body> and reused across the whole app.
// `position: fixed`, so it tracks the viewport correctly regardless of scroll
// or which positioned ancestor the button sits inside.
//
// Pass an empty string / null / undefined to disable (the listeners still wire
// up, but show() short-circuits — convenient for conditional content).
//
// Accessibility (UI-5): the tooltip also shows when the host receives KEYBOARD
// focus (focus-visible, anchored to the element) and hides on blur or Escape. When
// the host is interactive and has no name of its own (an icon-only button: no
// text, no aria-label, no aria-labelledby), the tooltip text becomes its
// aria-label, so screen readers do not announce a bare "button".

let overlay = null;
let owner = null;

function ensureOverlay() {
	if (overlay) return overlay;
	if (typeof document === 'undefined') return null;
	overlay = document.createElement('div');
	overlay.className = 'tooltip app-tooltip';
	overlay.style.position = 'fixed';
	overlay.style.visibility = 'hidden';
	overlay.style.pointerEvents = 'none';
	document.body.appendChild(overlay);
	return overlay;
}

function show(node, text, x, y) {
	if (!text) return;
	const el = ensureOverlay();
	if (!el) return;
	el.textContent = text;
	// Park off-screen briefly so we can measure the rendered size before
	// flipping into the viewport — avoids the tooltip clipping off the
	// right/bottom edge of the canvas.
	el.style.visibility = 'hidden';
	el.style.left = '0px';
	el.style.top = '0px';
	const w = el.offsetWidth;
	const h = el.offsetHeight;
	let left = x + 12;
	let top = y + 14;
	if (left + w > window.innerWidth - 4) left = window.innerWidth - w - 4;
	if (top + h > window.innerHeight - 4) top = y - h - 10;
	if (left < 4) left = 4;
	if (top < 4) top = 4;
	el.style.left = `${left}px`;
	el.style.top = `${top}px`;
	el.style.visibility = 'visible';
	owner = node;
}

// Snap the tooltip to the element's bounding box (centred, below it; flips above
// when it would overflow the viewport bottom) instead of tracking the cursor.
// Used where a cursor-following tooltip would cover the element's own content —
// e.g. the node palette tiles, whose label sits right under the icon.
function showAnchored(node, text) {
	if (!text) return;
	const el = ensureOverlay();
	if (!el) return;
	el.textContent = text;
	el.style.visibility = 'hidden';
	el.style.left = '0px';
	el.style.top = '0px';
	const w = el.offsetWidth;
	const h = el.offsetHeight;
	const r = node.getBoundingClientRect();
	const gap = 8;
	let left = r.left + r.width / 2 - w / 2;
	let top = r.bottom + gap; // prefer below the tile
	if (top + h > window.innerHeight - 4) top = r.top - h - gap; // flip above if needed
	if (left + w > window.innerWidth - 4) left = window.innerWidth - w - 4;
	if (left < 4) left = 4;
	if (top < 4) top = 4;
	el.style.left = `${left}px`;
	el.style.top = `${top}px`;
	el.style.visibility = 'visible';
	owner = node;
}

function hide(node) {
	if (node && owner !== node) return;
	if (overlay) overlay.style.visibility = 'hidden';
	owner = null;
}

// Hosts that can carry an accessible name. aria-label on a plain div/span is
// ignored by most screen readers (and not allowed by ARIA), so those are skipped.
const NAMEABLE_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
const NAMEABLE_ROLES = new Set([
	'button',
	'link',
	'tab',
	'menuitem',
	'checkbox',
	'switch',
	'radio',
	'option',
	'slider',
	'spinbutton',
	'textbox',
	'combobox',
	'img'
]);

function isNameable(node) {
	if (NAMEABLE_TAGS.has(node.tagName)) return true;
	const role = node.getAttribute?.('role');
	return role != null && NAMEABLE_ROLES.has(role);
}

/** Whether the element already has an accessible name the tooltip must not replace. */
export function hasOwnAccessibleName(node) {
	if (node.hasAttribute('aria-label') || node.hasAttribute('aria-labelledby')) return true;
	if ((node.textContent ?? '').trim() !== '') return true;
	if (node.tagName === 'INPUT' || node.tagName === 'SELECT' || node.tagName === 'TEXTAREA') {
		if (node.labels && node.labels.length > 0) return true;
	}
	if (node.querySelector?.('img[alt]:not([alt=""]), svg title')) return true;
	return false;
}

function isFocusVisible(el) {
	try {
		return el.matches(':focus-visible');
	} catch {
		return true; // engines without :focus-visible: treat focus as keyboard focus
	}
}

/**
 * @param {string | null | undefined} content
 * @param {{ anchor?: 'cursor' | 'element' }} [opts] anchor 'element' snaps the
 *   tooltip to the host element's box (no cursor tracking); default 'cursor'.
 */
export function tooltip(content, opts = {}) {
	const anchorEl = opts.anchor === 'element';
	return (node) => {
		function onEnter(e) {
			if (!content) return;
			if (anchorEl) showAnchored(node, content);
			else show(node, content, e.clientX, e.clientY);
		}
		function onMove(e) {
			if (!content || owner !== node) return;
			if (anchorEl) return; // stays snapped to the element
			show(node, content, e.clientX, e.clientY);
		}
		function onLeave() {
			hide(node);
		}
		// Keyboard focus on the host (or a control inside it) shows the tooltip
		// anchored to the host; a mouse click's focus does not (focus-visible).
		function onFocusIn(e) {
			if (!content || !isFocusVisible(e.target)) return;
			showAnchored(node, content);
		}
		function onFocusOut(e) {
			if (node.contains(e.relatedTarget)) return;
			hide(node);
		}
		function onKeyDown(e) {
			if (e.key === 'Escape' && owner === node) hide(node);
		}
		node.addEventListener('mouseenter', onEnter);
		node.addEventListener('mousemove', onMove);
		node.addEventListener('mouseleave', onLeave);
		// Dismiss when the user actually activates the button — without this the
		// tooltip lingers over the click target.
		node.addEventListener('mousedown', onLeave);
		node.addEventListener('focusin', onFocusIn);
		node.addEventListener('focusout', onFocusOut);
		node.addEventListener('keydown', onKeyDown);

		// Name an icon-only control after its tooltip. Only set (and later removed)
		// here when the host had no name, so an explicit aria-label always wins.
		let namedHere = false;
		if (content && isNameable(node) && !hasOwnAccessibleName(node)) {
			node.setAttribute('aria-label', content);
			namedHere = true;
		}

		return () => {
			node.removeEventListener('mouseenter', onEnter);
			node.removeEventListener('mousemove', onMove);
			node.removeEventListener('mouseleave', onLeave);
			node.removeEventListener('mousedown', onLeave);
			node.removeEventListener('focusin', onFocusIn);
			node.removeEventListener('focusout', onFocusOut);
			node.removeEventListener('keydown', onKeyDown);
			if (namedHere && node.getAttribute('aria-label') === content) {
				node.removeAttribute('aria-label');
			}
			hide(node);
		};
	};
}
