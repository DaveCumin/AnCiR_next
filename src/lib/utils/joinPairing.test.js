// Join Data's pairing rule and output names (utils/joinPairing.js). Synthetic names only.
import { describe, it, expect } from 'vitest';
import {
	normaliseColumnName,
	decidePairs,
	joinOutputs,
	joinPlan,
	joinOutKeys,
	joinValueIds
} from './joinPairing.js';

const namesOf = (names) => (id) => names[id];

describe('normaliseColumnName', () => {
	it('ignores case and surrounding whitespace, and reads inner runs as one space', () => {
		expect(normaliseColumnName('  Temp ')).toBe('temp');
		expect(normaliseColumnName('TEMP')).toBe('temp');
		expect(normaliseColumnName('air   temp\t C')).toBe('air temp c');
	});
	it('keeps a space that separates words: "temp C" and "tempC" differ', () => {
		expect(normaliseColumnName('temp C')).not.toBe(normaliseColumnName('tempC'));
	});
	it('reads null and undefined as the empty name', () => {
		expect(normaliseColumnName(null)).toBe('');
		expect(normaliseColumnName(undefined)).toBe('');
	});
});

describe('decidePairs', () => {
	it('pairs by name, case and whitespace ignored', () => {
		const n = namesOf({ 1: 'Temp', 2: 'humidity', 11: ' temp ', 12: 'light' });
		expect(decidePairs([1, 2], [11, 12], n).pairOf).toEqual({ 11: 1 });
	});

	it('leaves unmatched names unpaired', () => {
		const n = namesOf({ 1: 'a', 11: 'b' });
		expect(decidePairs([1], [11], n).pairOf).toEqual({});
	});

	it('an override to an A column pairs regardless of names', () => {
		const n = namesOf({ 1: 'ambient', 11: 'outside' });
		expect(decidePairs([1], [11], n, { 11: 1 }).pairOf).toEqual({ 11: 1 });
	});

	it('an override of -1 keeps a same-named column separate', () => {
		const n = namesOf({ 1: 'temp', 11: 'temp' });
		expect(decidePairs([1], [11], n, { 11: -1 }).pairOf).toEqual({});
	});

	it('a stale override (that A column is no longer wired) falls back to the name', () => {
		const n = namesOf({ 1: 'temp', 11: 'temp' });
		expect(decidePairs([1], [11], n, { 11: 99 }).pairOf).toEqual({ 11: 1 });
	});

	it('two B columns with the same name: the first pairs, the second is separate and reported', () => {
		const n = namesOf({ 1: 'temp', 11: 'temp', 12: 'TEMP' });
		const { pairOf, conflicts } = decidePairs([1], [11, 12], n);
		expect(pairOf).toEqual({ 11: 1 });
		expect(conflicts).toEqual([{ bId: 12, aId: 1, why: 'taken' }]);
	});

	it('two A columns with the same name: B pairs with the first, a second B with the second', () => {
		const n = namesOf({ 1: 'temp', 2: 'temp', 11: 'temp', 12: 'temp' });
		expect(decidePairs([1, 2], [11, 12], n).pairOf).toEqual({ 11: 1, 12: 2 });
	});

	it('overrides are honoured before name matches take an A column', () => {
		// B 12 claims A 1 by override, so B 11 (named like A 1) cannot have it.
		const n = namesOf({ 1: 'temp', 11: 'temp', 12: 'other' });
		const { pairOf, conflicts } = decidePairs([1], [11, 12], n, { 12: 1 });
		expect(pairOf).toEqual({ 12: 1 });
		expect(conflicts).toEqual([{ bId: 11, aId: 1, why: 'taken' }]);
	});

	it('two overrides to one A column: the first wins, the second is reported', () => {
		const n = namesOf({ 1: 'a', 11: 'x', 12: 'y' });
		const { pairOf, conflicts } = decidePairs([1], [11, 12], n, { 11: 1, 12: 1 });
		expect(pairOf).toEqual({ 11: 1 });
		expect(conflicts).toEqual([{ bId: 12, aId: 1, why: 'taken' }]);
	});

	it('an empty name never pairs', () => {
		const n = namesOf({ 1: '', 11: '  ' });
		expect(decidePairs([1], [11], n).pairOf).toEqual({});
	});
});

describe('joinOutputs: keys and labels', () => {
	it('one key per A column, then one per unpaired B column, in input order', () => {
		const n = namesOf({ 1: 'temp', 2: 'rh', 11: 'Temp', 12: 'light' });
		const outs = joinOutputs([1, 2], [11, 12], { 11: 1 }, n);
		expect(outs).toEqual([
			{ key: 'joined_1', aId: 1, bId: 11, label: 'temp' },
			{ key: 'joined_2', aId: 2, bId: null, label: 'rh' },
			{ key: 'joined_12', aId: null, bId: 12, label: 'light' }
		]);
	});

	it('a paired column takes the A name', () => {
		const n = namesOf({ 1: 'Temp', 11: 'temp' });
		expect(joinOutputs([1], [11], { 11: 1 }, n)[0].label).toBe('Temp');
	});

	it('two separate columns that read alike get their side: "temp (A)", "temp (B)"', () => {
		const n = namesOf({ 1: 'temp', 11: 'temp' });
		expect(joinOutputs([1], [11], {}, n).map((o) => o.label)).toEqual(['temp (A)', 'temp (B)']);
	});

	it('a pair keeps its plain name beside a separate same-named B column', () => {
		const n = namesOf({ 1: 'temp', 11: 'temp', 12: 'temp' });
		expect(joinOutputs([1], [11, 12], { 11: 1 }, n).map((o) => o.label)).toEqual([
			'temp',
			'temp (B)'
		]);
	});

	it('names still alike after the side are numbered', () => {
		const n = namesOf({ 11: 'temp', 12: 'Temp', 13: 'temp' });
		expect(joinOutputs([], [11, 12, 13], {}, n).map((o) => o.label)).toEqual([
			'temp (B)',
			'Temp (B) 2',
			'temp (B) 3'
		]);
	});
});

describe('joinPlan / joinOutKeys', () => {
	const n = namesOf({ 1: 'temp', 2: 'rh', 11: 'temp', 12: 'light' });
	it('reads the value ports, de-duplicated, ignoring -1 and junk', () => {
		expect(joinValueIds({ aValuesIN: [1, 1, -1, 'x'], bValuesIN: 11 })).toEqual({
			aIds: [1],
			bIds: [11]
		});
	});
	it('lists the time key, every value key and the source when asked for', () => {
		const args = { aValuesIN: [1, 2], bValuesIN: [11, 12], pairing: {} };
		expect(joinOutKeys(args, n)).toEqual(['jointime', 'joined_1', 'joined_2', 'joined_12']);
		expect(joinOutKeys({ ...args, sourceColumn: true }, n)).toContain('source');
	});
	it('useBaked trusts the pairs the node wrote, ignoring stale ones', () => {
		const args = {
			aValuesIN: [1, 2],
			bValuesIN: [11, 12],
			_resolvedPairs: { 12: 2, 99: 1 }
		};
		expect(joinPlan(args, n, { useBaked: true }).pairOf).toEqual({ 12: 2 });
		expect(joinPlan(args, n).pairOf).toEqual({ 11: 1 });
	});
});
