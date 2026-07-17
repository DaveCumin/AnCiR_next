// @ts-nocheck
//
// The crash handler runs at the worst possible moment, so the thing it must never do is throw.
// These tests are mostly about it surviving: no storage, a full quota, no network, a session
// that won't serialise.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { reportError, saveCrashSnapshot, readCrashSnapshot, clearCrashSnapshot, CRASH_SNAPSHOT_KEY } from './errorReporter.js';
import { notifications } from './notifications.svelte.js';
import { core } from './core.svelte.js';

let fetchCalls;
beforeEach(() => {
	notifications.list.length = 0;
	localStorage.clear();
	core.data.length = 0;
	core.plots.length = 0;
	core.tableProcesses.length = 0;
	core.generatedBy = null;
	fetchCalls = [];
	vi.spyOn(console, 'error').mockImplementation(() => {});
	globalThis.fetch = (url, init) => {
		fetchCalls.push({ url, body: JSON.parse(init.body) });
		return Promise.resolve(new Response('{}'));
	};
	// Each test is a distinct error, so the repeat-suppressor doesn't hide it.
	vi.setSystemTime?.(new Date());
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('reportError', () => {
	it('tells the user, saves the session, and reports it', () => {
		core.data.push({ id: 0, name: 'time' });
		reportError(new Error('boom-unique-1'), { source: 'render', context: 'rendering the actogram plot' });

		// 1. the user hears about it, and hears their work is safe
		expect(notifications.list).toHaveLength(1);
		expect(notifications.list[0].type).toBe('error');
		expect(notifications.list[0].message).toMatch(/was contained/);
		expect(notifications.list[0].message).toMatch(/copy of your session was saved/);
		expect(notifications.list[0].message).toMatch(/boom-unique-1/);

		// 2. the session is recoverable
		expect(readCrashSnapshot()?.session).toBeTruthy();

		// 3. it's reported, with enough to find the bug
		expect(fetchCalls).toHaveLength(1);
		expect(fetchCalls[0].url).toMatch(/\/report$/);
		expect(fetchCalls[0].body).toMatchObject({
			message: 'boom-unique-1',
			source: 'render',
			context: 'rendering the actogram plot',
			sessionShape: { columns: 1, analyses: 0, plots: 0 }
		});
		expect(fetchCalls[0].body.stack).toBeTruthy();
	});

	it('never ships the session data to the Worker — only its shape', () => {
		core.data.push({ id: 0, name: 'secret-patient-id' });
		core.rawData.set(0, [1, 2, 3]);
		reportError(new Error('boom-unique-2'));
		const blob = JSON.stringify(fetchCalls[0].body);
		expect(blob).not.toMatch(/secret-patient-id/);
		expect(fetchCalls[0].body.sessionShape.columns).toBe(1);
	});

	it('ties the crash to the prompt that built the session, when there was one', () => {
		core.generatedBy = { source: 'ancir-nl', route: 'build', sessionId: 'abc-123' };
		reportError(new Error('boom-unique-3'));
		expect(fetchCalls[0].body.generatedBy).toMatchObject({ sessionId: 'abc-123' });
	});

	it('collapses a repeating crash — a broken render throws dozens of times a second', () => {
		for (let i = 0; i < 20; i++) reportError(new Error('same-error-loop'));
		expect(notifications.list).toHaveLength(1);
		expect(fetchCalls).toHaveLength(1);
		// Still logged locally every time: that's the developer's record, not the user's.
		expect(console.error).toHaveBeenCalledTimes(20);
	});

	it('says so honestly when the session could NOT be saved', () => {
		// Restored by hand: an instance spy on localStorage survives restoreAllMocks and would
		// break every later test that stores anything.
		const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
			throw new Error('QuotaExceededError');
		});
		try {
			reportError(new Error('boom-unique-4'));
		} finally {
			spy.mockRestore();
		}
		expect(notifications.list[0].message).toMatch(/save it now to be safe/);
		expect(notifications.list[0].message).not.toMatch(/copy of your session was saved/);
	});

	it('does not throw when everything around it is broken', () => {
		globalThis.fetch = () => {
			throw new Error('network gone');
		};
		const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
			throw new Error('no storage');
		});
		try {
			expect(() => reportError(new Error('boom-unique-5'))).not.toThrow();
			// Even a non-Error survives.
			expect(() => reportError('a string', { source: 'promise' })).not.toThrow();
			expect(() => reportError(undefined)).not.toThrow();
		} finally {
			spy.mockRestore();
		}
	});
});

describe('crash snapshot', () => {
	it('round-trips and clears', () => {
		core.data.push({ id: 0, name: 'time' });
		expect(saveCrashSnapshot()).toBe(true);
		const snap = readCrashSnapshot();
		expect(snap.savedAt).toBeTruthy();
		expect(snap.session.data).toHaveLength(1);

		clearCrashSnapshot();
		expect(readCrashSnapshot()).toBeNull();
	});

	it('survives a corrupt snapshot rather than throwing on read', () => {
		localStorage.setItem(CRASH_SNAPSHOT_KEY, 'not json{');
		expect(readCrashSnapshot()).toBeNull();
	});
});
