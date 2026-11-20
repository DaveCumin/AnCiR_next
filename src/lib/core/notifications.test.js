// Toast timing (WCAG 2.2.1 / 2.2.2): a toast with a working action stays until used or closed;
// the others time out, but their clocks stop while a toast is hovered or focused and resume
// with the time they had left; a stale action makes its toast an ordinary one; a burst is
// capped without dropping anything actionable; the announcement names the key that reaches it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	notifications,
	addNotification,
	removeNotification,
	setActionable,
	holdNotification,
	isCountingDown,
	isToastKey,
	MAX_TOASTS
} from './notifications.svelte.js';

const ids = () => notifications.list.map((n) => n.id);

beforeEach(() => {
	vi.useFakeTimers();
	for (const id of ids()) removeNotification(id);
});
afterEach(() => {
	for (const id of ids()) removeNotification(id);
	vi.useRealTimers();
});

describe('toast timing', () => {
	it('a plain toast times out', () => {
		const id = addNotification('Saved', 'info', 5000);
		expect(isCountingDown(id)).toBe(true);
		vi.advanceTimersByTime(5001);
		expect(ids()).not.toContain(id);
	});

	it('a toast with a working action stays until it is used or closed', () => {
		const id = addNotification('Series removed', 'info', 5000, { label: 'Undo', run: () => {} });
		expect(isCountingDown(id)).toBe(false);
		vi.advanceTimersByTime(60_000);
		expect(ids()).toContain(id);
	});

	it('an action that goes stale starts the full clock', () => {
		let enabled = true;
		const id = addNotification('Series removed', 'info', 5000, {
			label: 'Undo',
			run: () => {},
			enabled: () => enabled
		});
		vi.advanceTimersByTime(20_000);
		enabled = false;
		setActionable(id, false); // what the toast component does when enabled() turns false
		vi.advanceTimersByTime(4000);
		expect(ids()).toContain(id);
		vi.advanceTimersByTime(1001);
		expect(ids()).not.toContain(id);
	});

	it('hover or focus stops every clock; leaving resumes with the time left', () => {
		const a = addNotification('A', 'info', 5000);
		const b = addNotification('B', 'info', 5000);
		vi.advanceTimersByTime(3000);
		holdNotification(a, 'hover', true);
		vi.advanceTimersByTime(30_000);
		expect(ids()).toEqual([a, b]);
		holdNotification(b, 'focus', true);
		holdNotification(a, 'hover', false); // focus still holds
		vi.advanceTimersByTime(30_000);
		expect(ids()).toEqual([a, b]);
		holdNotification(b, 'focus', false);
		vi.advanceTimersByTime(1900);
		expect(ids()).toEqual([a, b]);
		vi.advanceTimersByTime(200); // the 2 s they had left
		expect(ids()).toEqual([]);
	});

	it('a held toast that is removed (no leave event ever comes) does not freeze the rest', () => {
		const a = addNotification('A', 'info', 5000);
		const b = addNotification('B', 'info', 5000);
		holdNotification(a, 'hover', true);
		removeNotification(a); // e.g. replaced by the next "saved" toast
		vi.advanceTimersByTime(5001);
		expect(ids()).not.toContain(b);
	});

	it('a new toast added while held waits too', () => {
		const a = addNotification('A', 'info', 5000);
		holdNotification(a, 'hover', true);
		const b = addNotification('B', 'info', 5000);
		vi.advanceTimersByTime(10_000);
		expect(ids()).toEqual([a, b]);
		holdNotification(a, 'hover', false);
		vi.advanceTimersByTime(5001);
		expect(ids()).toEqual([]);
	});

	it('a burst is capped by dropping the oldest timed toasts, never an actionable one', () => {
		const undo = addNotification('Removed', 'info', 5000, { label: 'Undo', run: () => {} });
		const manual = addNotification('Read me', 'error', 0);
		const timed = [];
		for (let i = 0; i < 5; i++) timed.push(addNotification(`T${i}`, 'info', 5000));
		expect(notifications.list).toHaveLength(MAX_TOASTS);
		expect(ids()).toEqual([undo, manual, timed[3], timed[4]]);
	});

	it('the announcement of an action toast names the key that reaches it', async () => {
		addNotification('Series removed', 'info', 5000, { label: 'Undo', run: () => {} });
		vi.advanceTimersByTime(60);
		expect(document.getElementById('app-announcer').textContent).toMatch(
			/^Series removed Undo is in the notification; press (Alt|Option)\+T to reach it\.$/
		);
	});
});

describe('isToastKey', () => {
	const ev = (init) => new KeyboardEvent('keydown', init);
	it('is Alt+T (by code, so Option+T on a Mac) or a bare F8', () => {
		expect(isToastKey(ev({ code: 'KeyT', key: '†', altKey: true }))).toBe(true);
		expect(isToastKey(ev({ key: 'F8', code: 'F8' }))).toBe(true);
		expect(isToastKey(ev({ code: 'KeyT', key: 't' }))).toBe(false);
		expect(isToastKey(ev({ code: 'KeyT', key: 'T', altKey: true, shiftKey: true }))).toBe(false);
		expect(isToastKey(ev({ code: 'KeyT', key: 't', altKey: true, ctrlKey: true }))).toBe(false);
		expect(isToastKey(ev({ key: 'F8', code: 'F8', shiftKey: true }))).toBe(false);
	});
});
