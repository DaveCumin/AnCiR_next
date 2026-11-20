// @ts-nocheck
// The autosave database (autosaveStore.js), on a real IndexedDB implementation.
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
	writeCopy,
	listCopies,
	readCopy,
	deleteCopies,
	clearCopies,
	slotsToPrune,
	isQuotaError
} from './autosaveStore.js';

let idb;
beforeEach(() => {
	idb = new IDBFactory();
});

const copy = (slot, savedAt, extra = {}) => ({
	slot,
	savedAt,
	name: `Session ${slot}`,
	summary: { columns: 2, analyses: 1, plots: 1 },
	json: JSON.stringify({ slot, data: [] }),
	...extra
});

describe('autosave store', () => {
	it('writes a copy and reads it back exactly', async () => {
		await writeCopy(copy('a', 100, { fileName: 'a.ancir', version: '82.68' }), idb);
		const back = await readCopy('a', idb);
		expect(back.json).toBe(JSON.stringify({ slot: 'a', data: [] }));
		expect(back.meta).toMatchObject({
			slot: 'a',
			savedAt: 100,
			name: 'Session a',
			fileName: 'a.ancir',
			version: '82.68',
			chars: back.json.length
		});
		expect(back.handle).toBe(null);
	});

	it('keeps one copy per slot: a second write replaces the first', async () => {
		await writeCopy(copy('a', 100), idb);
		await writeCopy(copy('a', 200, { json: '{"v":2}' }), idb);
		expect((await listCopies(idb)).map((m) => m.savedAt)).toEqual([200]);
		expect((await readCopy('a', idb)).json).toBe('{"v":2}');
	});

	it('lists newest first, metadata only', async () => {
		await writeCopy(copy('old', 100), idb);
		await writeCopy(copy('new', 300), idb);
		await writeCopy(copy('mid', 200), idb);
		const list = await listCopies(idb);
		expect(list.map((m) => m.slot)).toEqual(['new', 'mid', 'old']);
		expect(list[0].json).toBeUndefined();
	});

	it('keeps the file handle with the copy', async () => {
		const handle = { kind: 'file', name: 'study.ancir' };
		await writeCopy(copy('a', 100, { handle }), idb);
		expect((await readCopy('a', idb)).handle).toEqual(handle);
	});

	it('a handle the browser cannot store does not cost the copy', async () => {
		await writeCopy(copy('a', 100, { handle: () => 'not cloneable' }), idb);
		const back = await readCopy('a', idb);
		expect(back.json).toContain('"slot":"a"');
		expect(back.handle).toBe(null);
	});

	it('deletes chosen slots and clears all, reporting the count', async () => {
		await writeCopy(copy('a', 1), idb);
		await writeCopy(copy('b', 2), idb);
		await writeCopy(copy('c', 3), idb);
		await deleteCopies(['b'], idb);
		expect((await listCopies(idb)).map((m) => m.slot)).toEqual(['c', 'a']);
		expect(await readCopy('b', idb)).toBe(null);
		expect(await clearCopies(idb)).toBe(2);
		expect(await listCopies(idb)).toEqual([]);
	});
});

describe('slotsToPrune', () => {
	const DAY = 86_400_000;
	const now = 100 * DAY;
	const metas = (n) => Array.from({ length: n }, (_, i) => ({ slot: `s${i}`, savedAt: now - i }));

	it('keeps the newest maxCopies and drops the rest', () => {
		expect(slotsToPrune(metas(7), { now, maxCopies: 5, maxAgeMs: 30 * DAY }).sort()).toEqual([
			's5',
			's6'
		]);
	});

	it('drops copies older than the age limit', () => {
		const list = [
			{ slot: 'fresh', savedAt: now - DAY },
			{ slot: 'stale', savedAt: now - 31 * DAY }
		];
		expect(slotsToPrune(list, { now, maxCopies: 5, maxAgeMs: 30 * DAY })).toEqual(['stale']);
	});

	it('never drops a protected slot (this tab, or another open tab), nor counts it', () => {
		const list = metas(7);
		const protectedSlots = new Set(['s5', 's6', 's0']);
		const drop = slotsToPrune(list, { now, maxCopies: 3, maxAgeMs: 30 * DAY, protectedSlots });
		expect(drop.sort()).toEqual(['s4']); // s1, s2, s3 kept; s0, s5, s6 protected
	});
});

describe('isQuotaError', () => {
	it('recognises a full store and a session too big to be a string', () => {
		expect(isQuotaError(Object.assign(new Error('full'), { name: 'QuotaExceededError' }))).toBe(
			true
		);
		expect(isQuotaError(new RangeError('Invalid string length'))).toBe(true);
		expect(isQuotaError(new Error('other'))).toBe(false);
	});
});
