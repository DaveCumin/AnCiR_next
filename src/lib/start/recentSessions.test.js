// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	recents,
	loadRecents,
	recordRecentFile,
	removeRecent,
	clearRecents,
	openRecent,
	getHandle,
	relativeTime,
	sessionCounts,
	supportsFileHandles,
	MAX_RECENTS
} from './recentSessions.svelte.js';
import { privacy } from '$lib/core/localData.svelte.js';
import { fakeIndexedDB, fileHandle } from './__fixtures__/fakeHandles.js';

// The index lives in localStorage; handles live in IndexedDB. happy-dom has no usable IndexedDB,
// and a real implementation (fake-indexeddb) structured-clones what it stores, which a fake
// handle with methods cannot survive. So a small by-reference fake stands in (__fixtures__).

let savedIdb;
beforeEach(() => {
	savedIdb = window.indexedDB;
	window.indexedDB = fakeIndexedDB();
	window.localStorage.clear();
	privacy.ephemeral = false;
	loadRecents();
});
afterEach(() => {
	window.indexedDB = savedIdb;
	privacy.ephemeral = false;
});

const save = (name, over = {}) =>
	recordRecentFile(fileHandle(name, over), { action: 'saved', meta: '4 columns · 1 plot' });

describe('recent files index', () => {
	it('starts empty', () => {
		expect(loadRecents()).toEqual([]);
	});

	it('records a file with its name, action, time and counts, and keeps its handle', async () => {
		await save('Cohort A 2026-11-21.ancir');
		const [e] = loadRecents();
		expect(e.name).toBe('Cohort A 2026-11-21');
		expect(e.fileName).toBe('Cohort A 2026-11-21.ancir');
		expect(e.action).toBe('saved');
		expect(e.meta).toBe('4 columns · 1 plot');
		expect(typeof e.ts).toBe('number');
		expect(e.thumb).toContain('<svg');
		expect((await getHandle(e.id)).name).toBe('Cohort A 2026-11-21.ancir');
		expect(recents.items).toHaveLength(1);
	});

	it('is most-recent-first', async () => {
		await save('first.ancir');
		await save('second.ancir');
		expect(loadRecents().map((e) => e.name)).toEqual(['second', 'first']);
	});

	it('refreshes the same file in place, and records how it was last used', async () => {
		await save('Cohort A.ancir');
		await save('other.ancir');
		await recordRecentFile(fileHandle('Cohort A.ancir'), { action: 'opened' });
		const items = loadRecents();
		expect(items.filter((e) => e.name === 'Cohort A')).toHaveLength(1);
		expect(items[0].name).toBe('Cohort A');
		expect(items[0].action).toBe('opened');
	});

	it('keeps two different files with the same name (two folders) as two rows', async () => {
		await save('study.ancir', { key: 'folder-1/study.ancir' });
		await save('study.ancir', { key: 'folder-2/study.ancir' });
		const items = loadRecents();
		expect(items.map((e) => e.name)).toEqual(['study', 'study']);
		expect(new Set(items.map((e) => e.id)).size).toBe(2);
		// The first one saved again refreshes ITS row, not the other.
		await save('study.ancir', { key: 'folder-1/study.ancir' });
		expect(loadRecents()).toHaveLength(2);
	});

	it(`caps the list at ${MAX_RECENTS}, evicting the oldest and its handle`, async () => {
		for (let i = 0; i < MAX_RECENTS + 2; i++) await save(`s${i}.ancir`);
		const items = loadRecents();
		expect(items).toHaveLength(MAX_RECENTS);
		expect(items[0].name).toBe(`s${MAX_RECENTS + 1}`);
		expect(items.some((e) => e.name === 's0')).toBe(false);
		expect(await getHandle('file::s0.ancir')).toBeNull();
	});

	it('records nothing in ephemeral mode', async () => {
		privacy.ephemeral = true;
		expect(await save('secret.ancir')).toBeNull();
		expect(loadRecents()).toEqual([]);
	});

	it('records nothing when the handle cannot be stored (no IndexedDB)', async () => {
		window.indexedDB = undefined;
		expect(await save('nowhere.ancir')).toBeNull();
		expect(loadRecents()).toEqual([]);
	});

	it('keeps the stored index small (a few kB, not a payload store)', async () => {
		for (let i = 0; i < MAX_RECENTS; i++) await save(`session ${i}.ancir`);
		const raw = window.localStorage.getItem('ancir.recents.v1') ?? '';
		expect(raw.length).toBeLessThan(64 * 1024);
	});

	it('removes a single entry and its handle, leaving the rest', async () => {
		await save('keep-1.ancir');
		await save('drop.ancir');
		await save('keep-2.ancir');
		await removeRecent('file::drop.ancir');
		expect(loadRecents().map((e) => e.name)).toEqual(['keep-2', 'keep-1']);
		expect(await getHandle('file::drop.ancir')).toBeNull();
	});

	it('clears the whole list and every handle', async () => {
		await save('a.ancir');
		await save('b.ancir');
		await clearRecents();
		expect(loadRecents()).toEqual([]);
		expect(window.localStorage.getItem('ancir.recents.v1')).toBeNull();
		expect(await getHandle('file::a.ancir')).toBeNull();
	});

	it('drops what older versions recorded (examples, files without a handle)', () => {
		window.localStorage.setItem(
			'ancir.recents.v1',
			JSON.stringify([
				{ id: 'example::stats-anova', name: 'ANOVA', ts: 3, url: 'x.json' },
				{ id: 'file::old.json', name: 'old', ts: 2 },
				{ id: 'file::kept.ancir', name: 'kept', ts: 1, hasHandle: true }
			])
		);
		expect(loadRecents().map((e) => e.id)).toEqual(['file::kept.ancir']);
		expect(JSON.parse(window.localStorage.getItem('ancir.recents.v1'))).toHaveLength(1);
	});

	it('survives a corrupt index without throwing', () => {
		window.localStorage.setItem('ancir.recents.v1', '{not json');
		expect(() => loadRecents()).not.toThrow();
		expect(loadRecents()).toEqual([]);
	});
});

describe('reopening', () => {
	it('reopens a stored file in one click, handing back the file and its handle', async () => {
		await save('Cohort C.ancir');
		const res = await openRecent('file::Cohort C.ancir');
		expect(res.status).toBe('ok');
		expect(res.file.name).toBe('Cohort C.ancir');
		expect(res.handle.name).toBe('Cohort C.ancir');
	});

	it('asks for permission again when it has lapsed', async () => {
		await save('lapsed.ancir', { perm: 'prompt', request: 'granted' });
		expect((await openRecent('file::lapsed.ancir')).status).toBe('ok');
	});

	it('reports a refusal', async () => {
		await save('refused.ancir', { perm: 'prompt', request: 'denied' });
		expect((await openRecent('file::refused.ancir')).status).toBe('denied');
	});

	it('reports a file that was moved, renamed or deleted as missing', async () => {
		const gone = Object.assign(new Error('gone'), { name: 'NotFoundError' });
		await save('moved.ancir', {
			getFile: async () => {
				throw gone;
			}
		});
		expect((await openRecent('file::moved.ancir')).status).toBe('missing');
	});

	it('reports a row with no stored handle', async () => {
		expect((await openRecent('file::never.ancir')).status).toBe('no-handle');
	});

	it('reports handle support by feature detection', () => {
		expect(typeof supportsFileHandles()).toBe('boolean');
	});
});

describe('sessionCounts', () => {
	it('counts columns and plots, singular and plural', () => {
		expect(sessionCounts({ data: [1], plots: [] })).toBe('1 column · 0 plots');
		expect(sessionCounts({ data: [1, 2], plots: [1] })).toBe('2 columns · 1 plot');
	});
});

describe('relativeTime', () => {
	const now = 1_700_000_000_000;
	it('formats recent stamps', () => {
		expect(relativeTime(now - 5_000, now)).toBe('just now');
		expect(relativeTime(now - 120_000, now)).toBe('2 minutes ago');
		expect(relativeTime(now - 3 * 3600_000, now)).toBe('3 hours ago');
		expect(relativeTime(now - 2 * 86400_000, now)).toBe('2 days ago');
	});
	it('singularises', () => {
		expect(relativeTime(now - 60_000, now)).toBe('1 minute ago');
		expect(relativeTime(now - 86400_000, now)).toBe('1 day ago');
	});
});
