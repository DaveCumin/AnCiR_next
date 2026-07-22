import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	loadRecents,
	recordRecent,
	removeRecent,
	clearRecents,
	openRecent,
	relativeTime,
	supportsFileHandles,
	MAX_RECENTS
} from './recentSessions.svelte.js';

// The index lives in localStorage; handles live in IndexedDB. happy-dom has localStorage but no
// usable IndexedDB, which is exactly the "degrade, don't die" path we want covered.
beforeEach(() => {
	window.localStorage.clear();
	loadRecents();
});

const add = (name, over = {}) => recordRecent({ name, meta: '7 days · 6 subjects', workflow: 'rest-activity', ...over });

describe('recents index', () => {
	it('starts empty', () => {
		expect(loadRecents()).toEqual([]);
	});

	it('records an entry with a name, timestamp and metadata', async () => {
		await add('Cohort A');
		const [e] = loadRecents();
		expect(e.name).toBe('Cohort A');
		expect(e.meta).toBe('7 days · 6 subjects');
		expect(e.workflow).toBe('rest-activity');
		expect(typeof e.ts).toBe('number');
	});

	it('is most-recent-first', async () => {
		await add('first');
		await add('second');
		expect(loadRecents().map((e) => e.name)).toEqual(['second', 'first']);
	});

	it('refreshes an existing entry in place rather than duplicating it', async () => {
		await add('Cohort A');
		await add('other');
		await add('Cohort A'); // reopened
		const items = loadRecents();
		expect(items.filter((e) => e.name === 'Cohort A')).toHaveLength(1);
		expect(items[0].name).toBe('Cohort A'); // moved back to the front
	});

	it(`caps the list at ${MAX_RECENTS}, evicting the oldest`, async () => {
		for (let i = 0; i < MAX_RECENTS + 4; i++) await add(`s${i}`);
		const items = loadRecents();
		expect(items).toHaveLength(MAX_RECENTS);
		expect(items[0].name).toBe(`s${MAX_RECENTS + 3}`);
		expect(items.some((e) => e.name === 's0')).toBe(false); // oldest evicted
	});

	it('keeps the stored index small (a few kB, not a payload store)', async () => {
		for (let i = 0; i < MAX_RECENTS; i++) {
			await add(`session ${i}`, { thumb: '<svg viewBox="0 0 120 80"><rect width="120" height="80"/></svg>' });
		}
		const raw = window.localStorage.getItem('ancir.recents.v1') ?? '';
		expect(raw.length).toBeLessThan(64 * 1024);
	});

	it('dismisses a single entry and leaves the rest', async () => {
		await add('keep-1');
		await add('drop');
		await add('keep-2');
		const target = loadRecents().find((e) => e.name === 'drop');
		await removeRecent(target.id);
		expect(loadRecents().map((e) => e.name)).toEqual(['keep-2', 'keep-1']);
	});

	it('clears the whole list', async () => {
		await add('a');
		await add('b');
		await clearRecents();
		expect(loadRecents()).toEqual([]);
		expect(window.localStorage.getItem('ancir.recents.v1')).toBeNull();
	});

	it('survives a corrupt index without throwing', () => {
		window.localStorage.setItem('ancir.recents.v1', '{not json');
		expect(() => loadRecents()).not.toThrow();
		expect(loadRecents()).toEqual([]);
	});

	it('drops malformed entries', () => {
		window.localStorage.setItem('ancir.recents.v1', JSON.stringify([{ name: 'no id' }, { id: 'ok', name: 'fine', ts: 1 }]));
		expect(loadRecents().map((e) => e.id)).toEqual(['ok']);
	});
});

describe('reopening', () => {
	it('asks the caller to re-select when there is no stored handle', async () => {
		await add('Cohort A');
		const [e] = loadRecents();
		const res = await openRecent(e.id);
		expect(res.status).toBe('reselect');
		expect(res.reason).toBe('no-handle');
	});

	it('reports handle support by feature detection', () => {
		expect(typeof supportsFileHandles()).toBe('boolean');
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
