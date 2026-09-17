// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { filterPaletteItems, paletteHaystack } from './paletteSearch.js';
import meta from '$lib/core/nodeMeta.js';

const mk = (over = {}) => ({
	type: 'ColumnFunctions',
	kind: 'tableProcess',
	displayName: 'Column Functions',
	family: 'Arithmetic',
	description: 'Apply a per-column aggregate function across rows or groups.',
	keywords: ['stats', 'mean', 'sd', 'average', 'aggregate', 'summary'],
	...over
});

describe('filterPaletteItems', () => {
	it('matches by hidden keyword ("stats" finds ColumnFunctions)', () => {
		const items = [mk(), mk({ type: 'Sort', displayName: 'Sort', keywords: ['order', 'rank'] })];
		const hits = filterPaletteItems(items, 'stats');
		expect(hits.map((i) => i.type)).toEqual(['ColumnFunctions']);
	});

	it('is case-insensitive for keywords and query', () => {
		const items = [mk({ keywords: ['Detrend', 'DRIFT'] })];
		expect(filterPaletteItems(items, 'dEtReNd')).toHaveLength(1);
		expect(filterPaletteItems(items, 'drift')).toHaveLength(1);
	});

	it('still matches name, family, type and description', () => {
		const items = [mk({ keywords: [] })];
		expect(filterPaletteItems(items, 'column func')).toHaveLength(1); // name
		expect(filterPaletteItems(items, 'arithmetic')).toHaveLength(1); // family
		expect(filterPaletteItems(items, 'columnfunctions')).toHaveLength(1); // type
		expect(filterPaletteItems(items, 'aggregate function')).toHaveLength(1); // description
	});

	it('empty/whitespace query returns all items unchanged', () => {
		const items = [mk(), mk({ type: 'Sort' })];
		expect(filterPaletteItems(items, '')).toBe(items);
		expect(filterPaletteItems(items, '   ')).toBe(items);
	});

	it('tolerates items with no keywords field', () => {
		const items = [mk({ keywords: undefined })];
		expect(filterPaletteItems(items, 'mean')).toHaveLength(0);
		expect(filterPaletteItems(items, 'column')).toHaveLength(1);
	});

	it('filtering never mutates items (keywords stay search-only data)', () => {
		const item = mk();
		const before = JSON.stringify(item);
		filterPaletteItems([item], 'stats');
		expect(JSON.stringify(item)).toBe(before);
	});
});

describe('paletteHaystack', () => {
	it('includes keywords, lowercased', () => {
		expect(paletteHaystack(mk())).toContain('stats');
		expect(paletteHaystack(mk({ keywords: ['MESOR'] }))).toContain('mesor');
	});
});

describe('nodeMeta keywords coverage', () => {
	it('every nodeMeta entry has 3-8 non-empty keywords, none duplicating the entry key', () => {
		for (const [key, entry] of meta.entries()) {
			expect(Array.isArray(entry.keywords), `${key} missing keywords[]`).toBe(true);
			expect(entry.keywords.length, `${key} keyword count`).toBeGreaterThanOrEqual(3);
			expect(entry.keywords.length, `${key} keyword count`).toBeLessThanOrEqual(8);
			for (const kw of entry.keywords) {
				expect(typeof kw, `${key} keyword type`).toBe('string');
				expect(kw.trim().length, `${key} empty keyword`).toBeGreaterThan(0);
				expect(kw.toLowerCase(), `${key} keyword duplicates node key`).not.toBe(key.toLowerCase());
			}
		}
	});
});
