/**
 * hoursSinceStart keeps a missing time as null, including a BLANK cell.
 *
 * Its missing test was `v == null || isNaN(v)`, and `isNaN('')` is false, so a blank cell was
 * turned into '' - baseline = -baseline: a real-looking time before the series started (the
 * baseline itself, from min(), already skipped it). The house rule (isInvalidValue) treats
 * null, undefined, a blank string and NaN as missing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { core } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';

function mkCol(values, type) {
	const c = new Column({ type, data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c;
}

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
});

describe('Column.hoursSinceStart with missing values', () => {
	it('number column: null and blank stay null, a real value is offset from the minimum', () => {
		expect(mkCol([5, null, '', 7], 'number').hoursSinceStart).toEqual([0, null, null, 2]);
	});

	it('time column: a blank cell stays null', () => {
		const t0 = Date.parse('2024-03-04T00:00:00Z');
		const hs = mkCol([t0, '', t0 + 3600000], 'time').hoursSinceStart;
		expect(hs[0]).toBe(0);
		expect(hs[1]).toBeNull();
		expect(hs[2]).toBe(1);
	});
});
