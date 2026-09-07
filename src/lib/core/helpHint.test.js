import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	helpHint,
	queueHelpHint,
	dismissHelpHint,
	_resetHelpHintForTests,
	HINT_DELAY_MS
} from './helpHint.svelte.js';
import { ENGAGED_KEY, _resetFirstRunForTests, wasNewAtSessionStart } from '$lib/utils/firstRun.js';

beforeEach(() => {
	window.localStorage.clear();
	_resetFirstRunForTests();
	_resetHelpHintForTests();
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	window.localStorage.clear();
	_resetFirstRunForTests();
	_resetHelpHintForTests();
});

describe('showing', () => {
	it('shows for a new user only after the settle delay', () => {
		queueHelpHint();
		expect(helpHint.visible).toBe(false);
		vi.advanceTimersByTime(HINT_DELAY_MS - 1);
		expect(helpHint.visible).toBe(false);
		vi.advanceTimersByTime(1);
		expect(helpHint.visible).toBe(true);
	});

	it('never shows for a returning user', () => {
		window.localStorage.setItem(ENGAGED_KEY, '1');
		queueHelpHint();
		vi.advanceTimersByTime(HINT_DELAY_MS * 2);
		expect(helpHint.visible).toBe(false);
	});

	it('never shows for a user with recents, even without the flag', () => {
		window.localStorage.setItem('ancir.recents.v1', JSON.stringify([{ id: 'a' }]));
		queueHelpHint();
		vi.advanceTimersByTime(HINT_DELAY_MS * 2);
		expect(helpHint.visible).toBe(false);
	});

	it('still shows when the first action itself wrote the first recent', () => {
		// The live-site bug: opening an example records a recent BEFORE the start
		// screen closes, so a queue-time isNewUser() check saw a "returning" user.
		wasNewAtSessionStart(); // primed at app mount, before any action
		window.localStorage.setItem('ancir.recents.v1', JSON.stringify([{ id: 'the-example' }]));
		queueHelpHint();
		vi.advanceTimersByTime(HINT_DELAY_MS);
		expect(helpHint.visible).toBe(true);
	});

	it('suppresses a queued showing when the user engages during the delay', () => {
		queueHelpHint();
		// e.g. they started a tour from the start screen's own band before the timer fired
		window.localStorage.setItem(ENGAGED_KEY, '1');
		vi.advanceTimersByTime(HINT_DELAY_MS * 2);
		expect(helpHint.visible).toBe(false);
	});

	it('shows at most once per session, even if the start screen closes again', () => {
		queueHelpHint();
		vi.advanceTimersByTime(HINT_DELAY_MS);
		expect(helpHint.visible).toBe(true);
		dismissHelpHint();
		queueHelpHint(); // e.g. New session → start screen shown → dismissed again
		vi.advanceTimersByTime(HINT_DELAY_MS * 2);
		expect(helpHint.visible).toBe(false);
	});

	it('coalesces a double queue into one timer', () => {
		queueHelpHint();
		queueHelpHint();
		vi.advanceTimersByTime(HINT_DELAY_MS);
		expect(helpHint.visible).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('dismissing', () => {
	it('hides the mark and flips the flag permanently', () => {
		queueHelpHint();
		vi.advanceTimersByTime(HINT_DELAY_MS);
		dismissHelpHint();
		expect(helpHint.visible).toBe(false);
		expect(window.localStorage.getItem(ENGAGED_KEY)).toBe('1');
	});

	it('cancels a pending (not yet visible) showing', () => {
		queueHelpHint();
		dismissHelpHint(); // e.g. the user opened Help during the 500ms settle
		vi.advanceTimersByTime(HINT_DELAY_MS * 2);
		expect(helpHint.visible).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('is safe to call when nothing was ever queued (every Help open calls it)', () => {
		expect(() => dismissHelpHint()).not.toThrow();
		expect(window.localStorage.getItem(ENGAGED_KEY)).toBe('1');
	});
});
