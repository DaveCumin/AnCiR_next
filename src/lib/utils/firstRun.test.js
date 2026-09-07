import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	isNewUser,
	hasEngaged,
	markEngaged,
	wasNewAtSessionStart,
	_resetFirstRunForTests,
	ENGAGED_KEY
} from './firstRun.js';
import { store } from '$lib/core/localData.svelte.js';

beforeEach(() => {
	window.localStorage.clear();
	_resetFirstRunForTests();
});
afterEach(() => {
	vi.restoreAllMocks();
	window.localStorage.clear();
	_resetFirstRunForTests();
});

describe('new-user detection', () => {
	it('treats a completely fresh browser as new', () => {
		expect(isNewUser()).toBe(true);
		expect(hasEngaged()).toBe(false);
	});

	it('treats a user with recents as returning — they predate the flag', () => {
		window.localStorage.setItem('ancir.recents.v1', JSON.stringify([{ id: 'a', ts: 1 }]));
		expect(isNewUser()).toBe(false);
	});

	it('treats a user with a completed tour as returning', () => {
		window.localStorage.setItem('ancir.tours.completed', JSON.stringify(['getting-started']));
		expect(isNewUser()).toBe(false);
	});

	it('treats an engaged user as returning even with empty recents and tours', () => {
		window.localStorage.setItem(ENGAGED_KEY, '1');
		expect(isNewUser()).toBe(false);
		expect(hasEngaged()).toBe(true);
	});

	it('ignores EMPTY recents/tours arrays — an empty list is not evidence of use', () => {
		window.localStorage.setItem('ancir.recents.v1', '[]');
		window.localStorage.setItem('ancir.tours.completed', '[]');
		expect(isNewUser()).toBe(true);
	});

	it('treats malformed stored JSON as no evidence rather than throwing', () => {
		window.localStorage.setItem('ancir.recents.v1', '{not json');
		window.localStorage.setItem('ancir.tours.completed', '"a string, not an array"');
		expect(isNewUser()).toBe(true);
	});
});

describe('the session-start snapshot', () => {
	it('freezes the verdict at first evaluation — later evidence cannot flip it', () => {
		expect(wasNewAtSessionStart()).toBe(true);
		// The user's first action writes a recent; they must STILL count as new.
		window.localStorage.setItem('ancir.recents.v1', JSON.stringify([{ id: 'a' }]));
		expect(wasNewAtSessionStart()).toBe(true);
		expect(isNewUser()).toBe(false); // the live check sees the evidence
	});

	it('judges a pre-existing user as returning from the outset', () => {
		window.localStorage.setItem('ancir.recents.v1', JSON.stringify([{ id: 'a' }]));
		expect(wasNewAtSessionStart()).toBe(false);
	});
});

describe('the engaged flag', () => {
	it('flips permanently and is idempotent', () => {
		markEngaged();
		expect(window.localStorage.getItem(ENGAGED_KEY)).toBe('1');
		expect(isNewUser()).toBe(false);
		markEngaged(); // second call must not throw or change anything
		expect(window.localStorage.getItem(ENGAGED_KEY)).toBe('1');
	});

	it('skips the redundant write once set', () => {
		markEngaged();
		const spy = vi.spyOn(Storage.prototype, 'setItem');
		markEngaged();
		expect(spy).not.toHaveBeenCalled();
	});
});

describe('a storage-hostile environment (private browsing)', () => {
	// `store` (localData) already swallows raw localStorage failures; these spies
	// make the accessor itself throw so firstRun's own belt-and-braces catches are
	// exercised too — the module must stay safe even if that guarantee ever slips.
	it('never throws, and answers "new" when nothing can be read', () => {
		vi.spyOn(store, 'getItem').mockImplementation(() => {
			throw new Error('denied');
		});
		expect(() => isNewUser()).not.toThrow();
		expect(isNewUser()).toBe(true);
		expect(hasEngaged()).toBe(false);
	});

	it('never throws on write', () => {
		vi.spyOn(store, 'getItem').mockImplementation(() => {
			throw new Error('denied');
		});
		vi.spyOn(store, 'setItem').mockImplementation(() => {
			throw new Error('quota');
		});
		expect(() => markEngaged()).not.toThrow();
	});
});
