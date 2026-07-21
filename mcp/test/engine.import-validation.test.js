// Imported data is validated against the column type before it enters the engine. A bare
// Array.isArray check previously let Infinity, NaN, '' and arbitrary objects into a numeric
// column, surfacing later as opaque analysis/plot failures. importColumns is the single
// validation point for every caller — direct engine, the stdio Zod tool, and the worker's
// import_data handler (mcp/src/worker.js line 29 is `importColumns(columns)` verbatim), so
// covering it covers the worker path too.
import { beforeAll, describe, expect, it } from 'vitest';
import { AncirSession, ensureRegistry, validateColumnValues } from '../src/engine/session.js';

beforeAll(async () => {
	await ensureRegistry();
});

describe('validateColumnValues', () => {
	it('accepts finite numbers and null (missing) in a number column', () => {
		expect(() => validateColumnValues('x', 'number', [1, -2.5, 0, null, 42])).not.toThrow();
	});

	it.each([
		['NaN', NaN],
		['Infinity', Infinity],
		['-Infinity', -Infinity],
		['a string', '5'],
		['an empty string', ''],
		['an object', { a: 1 }],
		['an array', [1, 2]],
		['a boolean', true]
	])('rejects %s in a number column', (_label, bad) => {
		expect(() => validateColumnValues('x', 'number', [1, 2, bad])).toThrow(/invalid value at index 2/);
	});

	it('accepts strings / numbers / null in category and time columns', () => {
		expect(() => validateColumnValues('g', 'category', ['A', 'B', null, 3])).not.toThrow();
		expect(() => validateColumnValues('t', 'time', ['2024-01-01T00:00:00Z', 1700000000000, null])).not.toThrow();
	});

	it('rejects non-primitive values in category / time columns', () => {
		expect(() => validateColumnValues('g', 'category', ['A', { x: 1 }])).toThrow(/non-primitive value at index 1/);
	});
});

describe('AncirSession.importColumns (direct engine + worker path)', () => {
	it('imports valid columns', () => {
		const s = new AncirSession('imp-ok');
		const added = s.importColumns([
			{ name: 'a', values: [1, 2, 3, null] },
			{ name: 'g', type: 'category', values: ['x', 'y', 'x', 'y'] }
		]);
		expect(added.map((c) => c.name)).toEqual(['a', 'g']);
	});

	it('throws on a non-finite value in a numeric column', () => {
		const s = new AncirSession('imp-bad');
		expect(() => s.importColumns([{ name: 'bad', values: [1, 2, Infinity] }])).toThrow(/Infinity/);
	});

	it('is atomic — a bad later column imports none of the batch', () => {
		const s = new AncirSession('imp-atomic');
		expect(() =>
			s.importColumns([
				{ name: 'good', values: [1, 2, 3] },
				{ name: 'bad', values: [1, NaN, 3] }
			])
		).toThrow(/NaN/);
		// The good column must NOT have been half-imported.
		expect(s.listColumns()).toHaveLength(0);
	});
});
