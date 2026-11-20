// Live regions for the whole app: `announce('Moved y to position 2 of 5 in Group A')` tells a
// screen reader what a keyboard action did when nothing on screen says it (a row moved by
// Alt+Arrow keeps its look, only its place changes), and every toast is read through here too
// (core/notifications.svelte.js), because a toast that appears on screen says nothing to a
// screen reader by itself.
//
// Two regions, each a visually hidden element made on first use and kept on <body>, so any
// component (or a plain module) can announce without mounting anything:
//   polite     role="status", aria-live="polite": read when the reader is idle (the default).
//   assertive  role="alert", aria-live="assertive": interrupts; for errors only.
// Repeating the same text is still read: the region is emptied first and filled a moment later,
// which is what makes a live region announce a change.

const REGIONS = {
	polite: { id: 'app-announcer', role: 'status', live: 'polite' },
	assertive: { id: 'app-alerts', role: 'alert', live: 'assertive' }
};
const timers = { polite: null, assertive: null };

function region(doc, kind) {
	const spec = REGIONS[kind];
	let el = doc.getElementById(spec.id);
	if (el) return el;
	el = doc.createElement('div');
	el.id = spec.id;
	el.setAttribute('role', spec.role);
	el.setAttribute('aria-live', spec.live);
	el.setAttribute('aria-atomic', 'true');
	el.dataset.testid = spec.id;
	// Visually hidden, still read (the standard clip pattern).
	Object.assign(el.style, {
		position: 'absolute',
		width: '1px',
		height: '1px',
		margin: '-1px',
		padding: '0',
		border: '0',
		overflow: 'hidden',
		clip: 'rect(0 0 0 0)',
		clipPath: 'inset(50%)',
		whiteSpace: 'nowrap'
	});
	doc.body.appendChild(el);
	return el;
}

/**
 * Announce `message`, politely unless `assertive`. Does nothing outside a browser.
 * @param {string} message
 * @param {{ assertive?: boolean }} [opts]
 */
export function announce(message, { assertive = false } = {}) {
	if (typeof document === 'undefined' || !document.body) return;
	const kind = assertive ? 'assertive' : 'polite';
	const el = region(document, kind);
	clearTimeout(timers[kind]);
	el.textContent = '';
	timers[kind] = setTimeout(() => {
		el.textContent = String(message ?? '');
	}, 50);
}
