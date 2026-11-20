// rovingRows: a treegrid of rich rows is one Tab stop. Only the active row (and the controls
// inside it) is in the Tab order; Up/Down/Home/End move between visible rows, Right/Left open,
// enter, close and leave a parent row, and the active row survives a re-render by its key.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rovingRows } from './rovingRows.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

function row(key, { level = 1, expanded = null } = {}) {
	const el = document.createElement('div');
	el.setAttribute('role', 'row');
	el.dataset.rovingRow = '';
	el.dataset.reorderKey = key;
	el.setAttribute('aria-level', String(level));
	if (expanded != null) el.setAttribute('aria-expanded', String(expanded));
	el.innerHTML = `<div role="gridcell"><button>${key} a</button><input aria-label="${key} b" /></div>`;
	return el;
}

let container;
let detach;
let opened;

function build() {
	container = document.createElement('div');
	container.setAttribute('role', 'treegrid');
	const g = row('g1', { expanded: true });
	const body = document.createElement('div');
	body.append(row('c1', { level: 2 }), row('c2', { level: 2 }));
	const g2 = row('g2', { expanded: false });
	const body2 = document.createElement('div');
	body2.hidden = true;
	body2.append(row('c3', { level: 2 }));
	container.append(g, body, g2, body2, row('u1'));
	document.body.append(container);
	opened = [];
	detach = rovingRows({
		onExpand: (r, open) => opened.push([r.dataset.reorderKey, open])
	})(container);
}

const get = (key) => container.querySelector(`[data-reorder-key="${key}"]`);
const tabbable = () =>
	[...container.querySelectorAll('[tabindex="0"], button:not([tabindex]), input:not([tabindex])')]
		.map((el) => el.dataset.reorderKey || el.textContent || el.getAttribute('aria-label'))
		.filter(Boolean);
const key = (target, k, init = {}) =>
	target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
const active = () => document.activeElement?.dataset?.reorderKey;

beforeEach(build);
afterEach(() => {
	detach();
	container.remove();
});

describe('rovingRows', () => {
	it('puts only the first row and its own controls in the Tab order', () => {
		expect(tabbable()).toEqual(['g1', 'g1 a', 'g1 b']);
		expect(get('c1').getAttribute('tabindex')).toBe('-1');
		expect(get('c1').querySelector('button').getAttribute('tabindex')).toBe('-1');
	});

	it('Up/Down go through the visible rows, skipping a closed group, Home/End to the ends', () => {
		get('g1').focus();
		key(get('g1'), 'ArrowDown');
		expect(active()).toBe('c1');
		key(get('c1'), 'ArrowDown');
		key(get('c2'), 'ArrowDown');
		expect(active()).toBe('g2');
		key(get('g2'), 'ArrowDown'); // c3 is in a hidden body
		expect(active()).toBe('u1');
		key(get('u1'), 'ArrowDown'); // the end: stays
		expect(active()).toBe('u1');
		key(get('u1'), 'Home');
		expect(active()).toBe('g1');
		key(get('g1'), 'End');
		expect(active()).toBe('u1');
		key(get('u1'), 'ArrowUp');
		expect(active()).toBe('g2');
		// The moved-to row is now the one Tab stop, controls and all.
		expect(tabbable()).toEqual(['g2', 'g2 a', 'g2 b']);
		expect(get('g1').querySelector('button').getAttribute('tabindex')).toBe('-1');
	});

	it('Right and Left open, enter, close and leave a group', () => {
		get('g1').focus();
		key(get('g1'), 'ArrowRight'); // open: into its first child
		expect(active()).toBe('c1');
		key(get('c1'), 'ArrowLeft'); // a child: to its parent
		expect(active()).toBe('g1');
		key(get('g1'), 'ArrowLeft'); // an open parent: close it
		expect(opened).toEqual([['g1', false]]);
		get('g2').focus();
		key(get('g2'), 'ArrowRight'); // a closed parent: open it
		expect(opened).toEqual([
			['g1', false],
			['g2', true]
		]);
	});

	it('leaves modified arrows (Alt+Arrow reorders) and keys inside a row alone', () => {
		get('g1').focus();
		key(get('g1'), 'ArrowDown', { altKey: true });
		expect(active()).toBe('g1');
		const input = get('g1').querySelector('input');
		input.focus();
		key(input, 'ArrowDown');
		expect(document.activeElement).toBe(input);
	});

	it('focus on a control in another row makes that row the stop; it survives a re-render', async () => {
		get('u1').querySelector('button').focus();
		expect(tabbable()).toEqual(['u1', 'u1 a', 'u1 b']);
		// The list re-renders the row (a reorder re-creates it): the same key stays active.
		const fresh = row('u1');
		get('u1').replaceWith(fresh);
		await flush();
		expect(fresh.getAttribute('tabindex')).toBe('0');
		expect(tabbable()).toEqual(['u1', 'u1 a', 'u1 b']);
		// Restoring a control's own tabindex: none before, none after.
		get('u1').querySelector('button').focus();
		get('g1').focus();
		await flush();
		expect(get('u1').querySelector('button').hasAttribute('tabindex')).toBe(true);
		expect(get('g1').querySelector('button').hasAttribute('tabindex')).toBe(false);
	});

	it('when the active row disappears, the row now in its place is the stop', async () => {
		get('g2').focus();
		get('g2').remove();
		await flush();
		expect(get('u1').getAttribute('tabindex')).toBe('0');
	});
});
