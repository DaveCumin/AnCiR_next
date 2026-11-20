// @ts-nocheck
// Autosave (autosave.svelte.js): when it writes, when it must not, what it offers back, and
// how tabs keep out of each other's copies. On a real IndexedDB implementation, with the Web
// Locks API faked (happy-dom has none) as a lock manager shared by every "tab".
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { appConsts, createNote, outputCoreAsJson } from './core.svelte.js';
import { notifications } from './notifications.svelte.js';
import { privacy, setEphemeral, EPHEMERAL_MODE_KEY } from './localData.svelte.js';
import {
	initUnsavedChanges,
	markSessionSaved,
	hasUnsavedChanges,
	_bumpRevisionForTest
} from './unsavedChanges.svelte.js';
import { getAutosaveSlot, setAutosaveSlot } from './autosaveSlot.js';
import { listCopies, readCopy, writeCopy, clearCopies } from './autosaveStore.js';
import { getSaveHandle, clearSaveTarget } from './saveTarget.svelte.js';
import {
	autosave,
	autosaveStatus,
	autosaveDelay,
	flushAutosave,
	scheduleAutosave,
	autosaveAfterSave,
	autosaveSessionReplaced,
	refreshAutosaveOffers,
	hideAutosaveOffer,
	discardAutosave,
	restoreAutosave,
	setAutosaveEnabled,
	clearAutosavedCopies,
	describeSummary,
	DEBOUNCE_MS,
	MAX_COPIES,
	MAX_AGE_DAYS,
	AUTOSAVE_PREF_KEY,
	autosaveEphemeralChanged,
	initAutosave,
	_resetAutosaveForTest
} from './autosave.svelte.js';
import { resetSession } from './sessionLoad.svelte.js';

/** A lock manager shared by every "tab" in the test, as the browser's is per origin. */
function fakeLocks() {
	const held = new Map();
	return {
		held,
		request(name, opts, cb) {
			if (held.has(name)) return Promise.resolve(cb(null));
			held.set(name, true);
			// Held until the callback's promise settles, as the real lock manager does.
			return Promise.resolve(cb({ name })).then(() => held.delete(name));
		},
		async query() {
			return { held: [...held.keys()].map((name) => ({ name })) };
		}
	};
}

let locks;
beforeAll(() => {
	initUnsavedChanges();
	appConsts.version = 'test';
});

beforeEach(async () => {
	locks = fakeLocks();
	Object.defineProperty(window.navigator, 'locks', { value: locks, configurable: true });
	localStorage.clear();
	privacy.ephemeral = false;
	_resetAutosaveForTest();
	await clearCopies();
	notifications.list.length = 0;
	resetSession();
	clearSaveTarget();
	setAutosaveSlot('tab-a');
	markSessionSaved();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	_resetAutosaveForTest();
});

/** Put something in the session and make it unsaved. */
function edit(text = 'a note') {
	createNote({ text, clear: false });
	_bumpRevisionForTest();
}

describe('what autosave writes', () => {
	it('writes the exact session JSON when there are unsaved changes', async () => {
		edit();
		expect(hasUnsavedChanges()).toBe(true);
		await flushAutosave();
		const copy = await readCopy('tab-a');
		expect(copy.json).toBe(outputCoreAsJson());
		expect(copy.meta.summary).toEqual({ columns: 0, analyses: 0, plots: 0 });
		expect(autosave.lastSavedAt).toBe(copy.meta.savedAt);
	});

	it('writes nothing while the session has no unsaved changes', async () => {
		edit();
		markSessionSaved();
		await flushAutosave();
		expect(await listCopies()).toEqual([]);
	});

	it('deletes its copy once the session is saved to a file', async () => {
		edit();
		await flushAutosave();
		expect(await listCopies()).toHaveLength(1);
		markSessionSaved();
		await autosaveAfterSave();
		expect(await listCopies()).toEqual([]);
	});

	it('deletes its copy when another session replaces this one', async () => {
		edit();
		await flushAutosave();
		resetSession();
		markSessionSaved();
		await autosaveSessionReplaced();
		expect(await listCopies()).toEqual([]);
	});

	it('does not rewrite an unchanged session', async () => {
		edit();
		await flushAutosave();
		const first = (await readCopy('tab-a')).meta.savedAt;
		await new Promise((r) => setTimeout(r, 5));
		await flushAutosave();
		expect((await readCopy('tab-a')).meta.savedAt).toBe(first);
	});
});

describe('when autosave must not write', () => {
	it.each([
		['ephemeral mode', () => (privacy.ephemeral = true), 'ephemeral'],
		['the setting off', () => (autosave.enabled = false), 'off'],
		[
			'ephemeral mode with the setting off (ephemeral is the reason given)',
			() => {
				privacy.ephemeral = true;
				autosave.enabled = false;
			},
			'ephemeral'
		]
	])('writes nothing in %s', async (_, setUp, status) => {
		setUp();
		edit();
		await flushAutosave();
		expect(autosaveStatus()).toBe(status);
		expect(await listCopies()).toEqual([]);
	});

	it('writes with nothing but the setting and ephemeral mode to go on (no private-window check)', async () => {
		expect(autosaveStatus()).toBe('on');
		edit();
		await flushAutosave();
		expect(await listCopies()).toHaveLength(1);
	});

	it('turning ephemeral mode on deletes every copy and stops writing; off resumes', async () => {
		await writeCopy({ slot: 'other-tab', savedAt: 1, name: 'x', json: '{}' });
		edit();
		await flushAutosave();
		expect(await listCopies()).toHaveLength(2);
		await setEphemeral(true);
		await autosaveEphemeralChanged();
		expect(await listCopies()).toEqual([]);
		expect(autosaveStatus()).toBe('ephemeral');
		edit('in ephemeral mode');
		await flushAutosave();
		expect(await listCopies()).toEqual([]);
		await setEphemeral(false);
		await autosaveEphemeralChanged();
		expect(autosaveStatus()).toBe('on');
		edit('after ephemeral mode');
		await flushAutosave();
		expect((await listCopies()).map((c) => c.slot)).toEqual(['tab-a']);
	});

	it('follows ephemeral mode turned on in another tab', async () => {
		await initAutosave();
		edit();
		await flushAutosave();
		expect(await listCopies()).toHaveLength(1);
		// The other tab cleared the database; this one must not write a new copy after it.
		await clearCopies();
		window.dispatchEvent(
			new StorageEvent('storage', { key: EPHEMERAL_MODE_KEY, newValue: '1', oldValue: null })
		);
		expect(privacy.ephemeral).toBe(true);
		edit('after the other tab');
		await flushAutosave();
		expect(await listCopies()).toEqual([]);
	});

	it('turning the setting off deletes every copy, from every tab, and remembers it', async () => {
		await writeCopy({ slot: 'other-tab', savedAt: 1, name: 'x', json: '{}' });
		edit();
		await flushAutosave();
		expect(await listCopies()).toHaveLength(2);
		const removed = await setAutosaveEnabled(false);
		expect(removed).toBe(2);
		expect(await listCopies()).toEqual([]);
		expect(localStorage.getItem(AUTOSAVE_PREF_KEY)).toBe('0');
		edit('another');
		await flushAutosave();
		expect(await listCopies()).toEqual([]);
	});

	it('"Clear autosaved copies" deletes them all and says how many', async () => {
		edit();
		await flushAutosave();
		expect(await clearAutosavedCopies()).toBe(1);
		expect(await listCopies()).toEqual([]);
	});
});

describe('debounce', () => {
	it('writes once, DEBOUNCE_MS after the LAST of several changes', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const ric = window.requestIdleCallback;
		window.requestIdleCallback = undefined;
		try {
			edit('one');
			scheduleAutosave();
			vi.advanceTimersByTime(DEBOUNCE_MS - 100);
			edit('two');
			scheduleAutosave();
			vi.advanceTimersByTime(DEBOUNCE_MS - 100);
			vi.useRealTimers();
			await new Promise((r) => setTimeout(r, 20));
			expect(await listCopies()).toEqual([]); // still inside the second debounce
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			scheduleAutosave();
			vi.advanceTimersByTime(DEBOUNCE_MS);
			vi.useRealTimers();
			await vi.waitFor(async () => expect(await listCopies()).toHaveLength(1));
			expect(JSON.parse((await readCopy('tab-a')).json).notes).toHaveLength(2);
		} finally {
			window.requestIdleCallback = ric;
		}
	});

	it('stretches the gap for a session that is slow to serialise', () => {
		expect(autosaveDelay(0)).toBe(DEBOUNCE_MS);
		expect(autosaveDelay(50)).toBe(DEBOUNCE_MS);
		expect(autosaveDelay(500)).toBe(10_000);
	});
});

describe('a session too large for the browser', () => {
	it('gives one quiet notice, not one per attempt, and keeps the app working', async () => {
		const quota = () => {
			throw Object.assign(new Error('The quota has been exceeded.'), {
				name: 'QuotaExceededError'
			});
		};
		const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(quota);
		edit('one');
		await flushAutosave();
		edit('two');
		await flushAutosave();
		edit('three');
		await flushAutosave();
		const notices = notifications.list.filter((n) => /too large to autosave/.test(n.message));
		expect(notices).toHaveLength(1);
		expect(notices[0].type).toBe('warning');
		expect(autosaveStatus()).toBe('too-large');
		// Once it fits again (a smaller session, or room freed), autosave resumes on its own.
		spy.mockRestore();
		edit('four');
		await flushAutosave();
		expect(autosaveStatus()).toBe('on');
		expect(await listCopies()).toHaveLength(1);
	});
});

describe('a session slow to write', () => {
	it('is then written only when the tab is hidden, with one quiet notice', async () => {
		const now = vi.spyOn(performance, 'now');
		let t = 0;
		// Every reading 600 ms after the last: serialising "takes" 600 ms, the hand-over 600 ms.
		now.mockImplementation(() => (t += 600));
		edit('big');
		await flushAutosave();
		expect(autosaveStatus()).toBe('slow');
		expect(
			notifications.list.filter((n) => /switch away from this tab/.test(n.message))
		).toHaveLength(1);
		const first = (await readCopy('tab-a')).json;

		// While the tab is visible: not rewritten, and no timer is even set.
		edit('more');
		scheduleAutosave();
		await flushAutosave();
		expect((await readCopy('tab-a')).json).toBe(first);

		// Hidden (or leaving): written.
		await flushAutosave({ background: true });
		expect(JSON.parse((await readCopy('tab-a')).json).notes).toHaveLength(2);
		expect(notifications.list.filter((n) => /switch away/.test(n.message))).toHaveLength(1);

		// Small and fast again: back to normal.
		now.mockImplementation(() => (t += 1));
		edit('fast');
		await flushAutosave({ background: true });
		expect(autosaveStatus()).toBe('on');
	});
});

describe('several tabs', () => {
	it('each tab writes only its own slot, so two tabs never overwrite each other', async () => {
		edit('tab A work');
		await flushAutosave();
		// "Tab B": another slot, its own session.
		setAutosaveSlot('tab-b');
		_resetAutosaveForTest();
		edit('tab B work');
		await flushAutosave();
		const a = JSON.parse((await readCopy('tab-a')).json);
		const b = JSON.parse((await readCopy('tab-b')).json);
		expect(a.notes.map((n) => n.text)).toEqual(['tab A work']);
		expect(b.notes.map((n) => n.text)).toEqual(['tab A work', 'tab B work']);
	});

	it("offers closed tabs' copies, newest first, and never an open tab's or its own", async () => {
		const t = Date.now();
		await writeCopy({ slot: 'closed-old', savedAt: t - 400, name: 'Old', json: '{}' });
		await writeCopy({ slot: 'closed-new', savedAt: t - 200, name: 'New', json: '{}' });
		await writeCopy({ slot: 'open-tab', savedAt: t - 100, name: 'Open', json: '{}' });
		await writeCopy({ slot: 'tab-a', savedAt: t, name: 'Mine', json: '{}' });
		locks.held.set('ancir-autosave:open-tab', true); // another tab is still open
		locks.held.set('ancir-autosave:tab-a', true);
		const offers = await refreshAutosaveOffers();
		expect(offers.map((o) => o.slot)).toEqual(['closed-new', 'closed-old']);
	});

	it(`keeps at most ${MAX_COPIES} copies from closed tabs, dropping the oldest`, async () => {
		for (let i = 0; i < MAX_COPIES + 2; i++) {
			await writeCopy({
				slot: `closed-${i}`,
				savedAt: Date.now() - i * 1000,
				name: `${i}`,
				json: '{}'
			});
		}
		const offers = await refreshAutosaveOffers();
		expect(offers).toHaveLength(MAX_COPIES);
		expect((await listCopies()).map((m) => m.slot)).not.toContain(`closed-${MAX_COPIES + 1}`);
	});

	it('leaves out the copy the crash toast is already offering', async () => {
		await writeCopy({ slot: 'crashed', savedAt: Date.now(), name: 'Crashed', json: '{}' });
		hideAutosaveOffer('crashed');
		expect((await refreshAutosaveOffers()).map((o) => o.slot)).toEqual([]);
	});
});

describe('restore and discard', () => {
	async function leftByClosedTab() {
		edit('lost work');
		const json = outputCoreAsJson();
		resetSession();
		markSessionSaved();
		await writeCopy({
			slot: 'closed',
			savedAt: Date.now() - 60_000,
			name: 'Lost work',
			summary: { columns: 0, analyses: 0, plots: 0 },
			json,
			handle: { kind: 'file', name: 'lost.ancir' }
		});
		return json;
	}

	it('restores the exact session, adopts its slot and keeps it unsaved', async () => {
		const json = await leftByClosedTab();
		const load = vi.fn(async (session) => {
			createNote({ text: session.notes[0].text, clear: false });
			markSessionSaved(); // importJson marks a load saved
		});
		expect(await restoreAutosave('closed', { load })).toBe(true);
		expect(load).toHaveBeenCalledWith(JSON.parse(json));
		expect(getAutosaveSlot()).toBe('closed');
		expect(hasUnsavedChanges()).toBe(true); // its only copy is in the browser
		expect(getSaveHandle()).toEqual({ kind: 'file', name: 'lost.ancir' });
		// Later writes go to the same copy: one copy for the session, not two.
		edit('more');
		await flushAutosave();
		expect((await listCopies()).map((m) => m.slot)).toEqual(['closed']);
	});

	it('does nothing when the user cancels the replace question', async () => {
		await leftByClosedTab();
		const load = vi.fn();
		expect(await restoreAutosave('closed', { load, confirmReplace: async () => false })).toBe(
			false
		);
		expect(load).not.toHaveBeenCalled();
		expect(await listCopies()).toHaveLength(1);
	});

	it('reports a copy that has gone', async () => {
		await expect(restoreAutosave('missing', { load: vi.fn() })).rejects.toThrow(/no longer stored/);
	});

	it('Discard removes the copy', async () => {
		await leftByClosedTab();
		await refreshAutosaveOffers();
		expect(autosave.offers).toHaveLength(1);
		await discardAutosave('closed');
		expect(autosave.offers).toEqual([]);
		expect(await listCopies()).toEqual([]);
	});

	it('keeps 2 copies for 14 days (David, 2026-11-21)', () => {
		expect(MAX_COPIES).toBe(2);
		expect(MAX_AGE_DAYS).toBe(14);
	});

	it(`drops a copy older than ${MAX_AGE_DAYS} days instead of offering it, and keeps a younger one`, async () => {
		await writeCopy({
			slot: 'ancient',
			savedAt: Date.now() - (MAX_AGE_DAYS + 1) * 86_400_000,
			name: 'old',
			json: '{}'
		});
		await writeCopy({
			slot: 'recent',
			savedAt: Date.now() - (MAX_AGE_DAYS - 1) * 86_400_000,
			name: 'young',
			json: '{}'
		});
		expect((await refreshAutosaveOffers()).map((o) => o.slot)).toEqual(['recent']);
		expect((await listCopies()).map((c) => c.slot)).toEqual(['recent']);
	});

	it('describes a copy in words', () => {
		expect(describeSummary({ columns: 4, analyses: 1, plots: 2 })).toBe(
			'4 columns, 1 analysis, 2 plots'
		);
		expect(describeSummary({})).toBe('empty');
	});
});
