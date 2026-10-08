// focusTrap: the keyboard contract an aria-modal overlay owes (review UI-6). Focus moves in when
// it opens, Tab and Shift+Tab stay inside, Escape closes where closing is allowed, and focus goes
// back to where it was when the overlay closes.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { focusTrap, tabbables } from './focusTrap.js';

afterEach(() => {
	document.body.innerHTML = '';
});

function setup(html, opts) {
	document.body.innerHTML = `<button id="outside">outside</button><div id="dlg">${html}</div>`;
	const opener = document.getElementById('outside');
	opener.focus();
	const node = document.getElementById('dlg');
	const cleanup = focusTrap(opts)(node);
	return { node, opener, cleanup };
}

function tab(shift = false) {
	const ev = new KeyboardEvent('keydown', {
		key: 'Tab',
		shiftKey: shift,
		bubbles: true,
		cancelable: true
	});
	document.activeElement.dispatchEvent(ev);
	return ev;
}

describe('tabbables', () => {
	it('lists focusable controls in DOM order and skips disabled, hidden and inert ones', () => {
		document.body.innerHTML = `<div id="c">
			<button id="a">a</button>
			<button disabled>off</button>
			<input id="b" />
			<input type="hidden" />
			<div hidden><button>hidden</button></div>
			<div inert><button>inert</button></div>
			<a href="#x" id="c1">link</a>
			<a>no href</a>
			<span tabindex="0" id="d">span</span>
			<span tabindex="-1">not in order</span>
			<dialog><button>closed dialog</button></dialog>
		</div>`;
		const ids = tabbables(document.getElementById('c')).map((e) => e.id);
		expect(ids).toEqual(['a', 'b', 'c1', 'd']);
	});
});

describe('focusTrap', () => {
	it('moves focus to the first actionable element on open', () => {
		setup('<p>text</p><button id="first">1</button><button id="last">2</button>');
		expect(document.activeElement.id).toBe('first');
	});

	it('honours an initialFocus selector', () => {
		setup('<button id="first">1</button><button id="pick">2</button>', {
			initialFocus: '#pick'
		});
		expect(document.activeElement.id).toBe('pick');
	});

	it('focuses the container when asked to (a large overlay that should not open on a focus ring)', () => {
		const { node } = setup('<button id="first">1</button>', { focusContainer: true });
		expect(document.activeElement).toBe(node);
		// …and Tab from there enters at the first control.
		tab();
		expect(document.activeElement.id).toBe('first');
	});

	it('restores to fallbackFocus when the opener has gone (a menu item that closed)', () => {
		document.body.innerHTML = `<button id="help">?</button><button id="item">menu item</button><div id="dlg"><button>1</button></div>`;
		document.getElementById('item').focus();
		const cleanup = focusTrap({ fallbackFocus: () => document.getElementById('help') })(
			document.getElementById('dlg')
		);
		document.getElementById('item').remove();
		cleanup();
		expect(document.activeElement.id).toBe('help');
	});

	it('focuses the container itself when it has nothing actionable', () => {
		const { node } = setup('<p>Loading…</p>');
		expect(document.activeElement).toBe(node);
		expect(node.getAttribute('tabindex')).toBe('-1');
	});

	it('wraps Tab from the last element to the first', () => {
		setup('<button id="first">1</button><button id="last">2</button>');
		document.getElementById('last').focus();
		const ev = tab();
		expect(ev.defaultPrevented).toBe(true);
		expect(document.activeElement.id).toBe('first');
	});

	it('wraps Shift+Tab from the first element to the last', () => {
		setup('<button id="first">1</button><button id="last">2</button>');
		const ev = tab(true);
		expect(ev.defaultPrevented).toBe(true);
		expect(document.activeElement.id).toBe('last');
	});

	it('leaves Tab between two inner elements to the browser', () => {
		setup('<button id="first">1</button><button id="mid">2</button><button id="last">3</button>');
		const ev = tab();
		expect(ev.defaultPrevented).toBe(false);
	});

	it('Shift+Tab from the container itself goes to the last element', () => {
		const { node } = setup('<button id="first">1</button><button id="last">2</button>');
		node.setAttribute('tabindex', '-1');
		node.focus();
		tab(true);
		expect(document.activeElement.id).toBe('last');
	});

	it('does nothing while disabled (a child dialog owns the keyboard)', () => {
		let on = true;
		setup('<button id="first">1</button><button id="last">2</button>', { enabled: () => on });
		on = false;
		document.getElementById('last').focus();
		expect(tab().defaultPrevented).toBe(false);
	});

	it('calls onEscape and stops the key there, so an overlay underneath does not also close', () => {
		const onEscape = vi.fn();
		setup('<button id="first">1</button>', { onEscape });
		const below = vi.fn();
		window.addEventListener('keydown', below);
		const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		document.activeElement.dispatchEvent(ev);
		window.removeEventListener('keydown', below);
		expect(onEscape).toHaveBeenCalledTimes(1);
		expect(below).not.toHaveBeenCalled();
	});

	it('leaves Escape alone without onEscape (closing is not allowed, or handled elsewhere)', () => {
		setup('<button id="first">1</button>');
		const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		document.activeElement.dispatchEvent(ev);
		expect(ev.defaultPrevented).toBe(false);
	});

	it('restores focus to the element that had it before opening', () => {
		const { opener, cleanup } = setup('<button id="first">1</button>');
		expect(document.activeElement).not.toBe(opener);
		cleanup();
		expect(document.activeElement).toBe(opener);
	});

	it('does not try to restore focus to an element that has since left the page', () => {
		const { opener, cleanup } = setup('<button id="first">1</button>');
		opener.remove();
		expect(() => cleanup()).not.toThrow();
	});

	it('stops trapping once cleaned up', () => {
		const { cleanup } = setup('<button id="first">1</button><button id="last">2</button>');
		cleanup();
		document.getElementById('last').focus();
		expect(tab().defaultPrevented).toBe(false);
	});
});
