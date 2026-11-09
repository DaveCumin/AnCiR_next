/* global $derived, $effect */
// @ts-nocheck
// getColumnById keeps an id → index hint so a lookup is O(1) (it was core.data.find, O(n) per
// lookup, which made many-column nodes quadratic). The hint is never trusted: these pin that a
// removed, moved or replaced column is still found (or not) exactly as find would, and that a
// $derived reading a column still updates when the column appears or goes.
import { describe, it, expect, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import { core, pushObj } from '$lib/core/core.svelte.js';
import { Column, getColumnById } from '$lib/core/Column.svelte';

const make = (name) => {
	const c = new Column({ type: 'number' });
	c.name = name;
	return c;
};

beforeEach(() => {
	core.data = [];
});

describe('getColumnById', () => {
	it('finds columns, and nothing for -1, null, strings or unknown ids', () => {
		const a = make('a');
		const b = make('b');
		pushObj(a);
		pushObj(b);
		expect(getColumnById(a.id)).toBe(a);
		expect(getColumnById(b.id)).toBe(b);
		expect(getColumnById(-1)).toBeUndefined();
		expect(getColumnById(null)).toBeUndefined();
		expect(getColumnById(String(a.id))).toBeUndefined();
		expect(getColumnById(1e9)).toBeUndefined();
	});

	it('follows splices, reorders and a reassigned core.data', () => {
		const cols = ['a', 'b', 'c', 'd'].map(make);
		cols.forEach(pushObj);
		cols.forEach((c) => expect(getColumnById(c.id)).toBe(c));
		core.data.splice(1, 1); // remove b: c and d move down one
		expect(getColumnById(cols[1].id)).toBeUndefined();
		expect(getColumnById(cols[2].id)).toBe(cols[2]);
		expect(getColumnById(cols[3].id)).toBe(cols[3]);
		core.data.reverse();
		expect(getColumnById(cols[0].id)).toBe(cols[0]);
		core.data = [cols[3]];
		expect(getColumnById(cols[0].id)).toBeUndefined();
		expect(getColumnById(cols[3].id)).toBe(cols[3]);
	});

	it('a $derived over a lookup updates when the column is added and removed', () => {
		const a = make('a');
		const b = make('b');
		pushObj(a);
		let seen;
		const stop = $effect.root(() => {
			const found = $derived(getColumnById(b.id)?.name ?? null);
			$effect(() => {
				seen = found;
			});
		});
		flushSync();
		expect(seen).toBe(null);
		pushObj(b);
		flushSync();
		expect(seen).toBe('b');
		core.data.splice(core.data.indexOf(b), 1);
		flushSync();
		expect(seen).toBe(null);
		stop();
	});
});
