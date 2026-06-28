// @ts-nocheck
// Shared hover-tooltip attachment. Use as `{@attach tooltip('Reset viewport')}`.
//
// One overlay element is appended to <body> and reused across the whole app.
// `position: fixed`, so it tracks the viewport correctly regardless of scroll
// or which positioned ancestor the button sits inside.
//
// Pass an empty string / null / undefined to disable (the listeners still wire
// up, but show() short-circuits — convenient for conditional content).

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
		node.addEventListener('mouseenter', onEnter);
		node.addEventListener('mousemove', onMove);
		node.addEventListener('mouseleave', onLeave);
		// Dismiss when the user actually activates the button — without this the
		// tooltip lingers over the click target.
		node.addEventListener('mousedown', onLeave);
		return () => {
			node.removeEventListener('mouseenter', onEnter);
			node.removeEventListener('mousemove', onMove);
			node.removeEventListener('mouseleave', onLeave);
			node.removeEventListener('mousedown', onLeave);
			hide(node);
		};
	};
}
