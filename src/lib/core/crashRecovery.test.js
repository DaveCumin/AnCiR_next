// @ts-nocheck
// ROB-5: the crash toast promised "a copy of your session was saved", and nothing ever read
// the copy back. offerCrashRecovery is the reader: on start, a kept copy is offered with a
// Restore button, closing the offer discards it, and a failed restore keeps it.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const markSessionUnsaved = vi.fn();
vi.mock('./unsavedChanges.svelte.js', () => ({ markSessionUnsaved: () => markSessionUnsaved() }));
import { offerCrashRecovery, describeSession, formatSavedAt } from './crashRecovery.js';
import { CRASH_SNAPSHOT_KEY, readCrashSnapshot } from './errorReporter.js';
import { notifications, dismissNotification } from './notifications.svelte.js';

const SESSION = {
	data: [
		{ id: 0, name: 't' },
		{ id: 1, name: 'y' }
	],
	plots: [{ id: 0 }]
};

function keep(session = SESSION, savedAt = new Date().toISOString()) {
	sessionStorage.setItem(CRASH_SNAPSHOT_KEY, JSON.stringify({ savedAt, session }));
}
const offer = () => notifications.list.find((n) => n.action?.label === 'Restore session');
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
	markSessionUnsaved.mockClear();
	notifications.list.length = 0;
	sessionStorage.clear();
	localStorage.clear();
});

describe('offerCrashRecovery', () => {
	it('offers nothing when no copy was kept', () => {
		const restore = vi.fn();
		expect(offerCrashRecovery({ restore })).toBeNull();
		expect(notifications.list).toHaveLength(0);
	});

	it('offers a kept copy, says what it holds, and does not time out', () => {
		keep();
		offerCrashRecovery({ restore: vi.fn() });
		const n = offer();
		expect(n).toBeTruthy();
		expect(n.message).toMatch(/kept a copy of the session/);
		expect(n.message).toMatch(/2 columns, 1 plot/);
		expect(n.message).toMatch(/close this message to discard/);
	});

	it('Restore loads the copy through the given loader, then deletes the copy', async () => {
		keep();
		const restore = vi.fn(async () => {});
		offerCrashRecovery({ restore });
		await offer().action.run();
		expect(restore).toHaveBeenCalledTimes(1);
		expect(restore.mock.calls[0][0]).toEqual(SESSION);
		expect(readCrashSnapshot()).toBeNull();
		expect(notifications.list.some((n) => /Restored the session/.test(n.message))).toBe(true);
		// The restored session now exists nowhere else: closing the tab must ask.
		expect(markSessionUnsaved).toHaveBeenCalledTimes(1);
	});

	it('closing the offer discards the copy', () => {
		keep();
		const restore = vi.fn();
		const id = offerCrashRecovery({ restore });
		dismissNotification(id);
		expect(readCrashSnapshot()).toBeNull();
		expect(restore).not.toHaveBeenCalled();
		expect(notifications.list).toHaveLength(0);
	});

	it('a restore that fails keeps the copy and says so', async () => {
		keep();
		offerCrashRecovery({
			restore: async () => {
				throw new Error('broken plot');
			}
		});
		await offer().action.run();
		await flush();
		expect(readCrashSnapshot()?.session).toEqual(SESSION);
		const err = notifications.list.find((n) => n.type === 'error');
		expect(err.message).toMatch(/broken plot/);
		expect(err.message).toMatch(/copy is still kept/);
	});

	it('declining to replace the open work keeps the copy for a later reload', async () => {
		keep();
		const restore = vi.fn();
		offerCrashRecovery({ restore, confirmReplace: async () => false });
		await offer().action.run();
		expect(restore).not.toHaveBeenCalled();
		expect(readCrashSnapshot()?.session).toEqual(SESSION);
	});

	it('an empty or unreadable copy is not offered, and is cleared', () => {
		keep({ data: [], plots: [] });
		expect(offerCrashRecovery({ restore: vi.fn() })).toBeNull();
		expect(readCrashSnapshot()).toBeNull();
		sessionStorage.setItem(CRASH_SNAPSHOT_KEY, 'not json{');
		expect(offerCrashRecovery({ restore: vi.fn() })).toBeNull();
	});
});

describe('helpers', () => {
	it('describeSession counts what is there', () => {
		expect(describeSession({ data: [1], tableProcesses: [1, 2], plots: [] })).toBe(
			'1 column, 2 analyses'
		);
	});
	it('formatSavedAt gives a time today and a date otherwise', () => {
		const now = new Date('2026-10-04T12:00:00');
		expect(formatSavedAt('2026-10-04T09:05:00', now)).not.toMatch(/Oct/);
		expect(formatSavedAt('2026-10-01T09:05:00', now)).toMatch(/Oct/);
		expect(formatSavedAt('garbage', now)).toBe('');
	});
});
