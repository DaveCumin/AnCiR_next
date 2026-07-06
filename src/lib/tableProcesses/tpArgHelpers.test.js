// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { normalizeYInputs, migrateLegacyYIN, fillDefaults } from './tpArgHelpers.js';

describe('normalizeYInputs', () => {
	it('passes plain-id arrays through by value (fresh array, tokens expanded)', () => {
		const arr = [3, 4];
		// Returns a fresh array (it may expand Column Set tokens), so content — not
		// reference — is the contract. With no tokens the content is unchanged.
		expect(normalizeYInputs(arr)).toEqual([3, 4]);
	});
	it('wraps a legacy scalar id', () => {
		expect(normalizeYInputs(7)).toEqual([7]);
	});
	it('maps -1 / null / undefined to empty', () => {
		expect(normalizeYInputs(-1)).toEqual([]);
		expect(normalizeYInputs(null)).toEqual([]);
		expect(normalizeYInputs(undefined)).toEqual([]);
	});
	it('keeps 0 as a valid column id', () => {
		expect(normalizeYInputs(0)).toEqual([0]);
	});
});

describe('migrateLegacyYIN', () => {
	it('converts a scalar yIN in place', () => {
		const args = { yIN: 5 };
		migrateLegacyYIN(args);
		expect(args.yIN).toEqual([5]);
	});
	it('converts -1 to empty array', () => {
		const args = { yIN: -1 };
		migrateLegacyYIN(args);
		expect(args.yIN).toEqual([]);
	});
	it('leaves array yIN and missing args alone', () => {
		const args = { yIN: [1, 2] };
		migrateLegacyYIN(args);
		expect(args.yIN).toEqual([1, 2]);
		expect(() => migrateLegacyYIN(undefined)).not.toThrow();
	});
});

describe('fillDefaults', () => {
	const defaults = new Map([
		['xIN', { val: -1 }],
		['alpha', { val: 0.05 }],
		['preProcesses', { val: [] }],
		// structured entry (no top-level val) — must be skipped
		['out', { fitx: { val: -1 } }]
	]);

	it('fills only missing keys', () => {
		const args = { xIN: 3 };
		fillDefaults(args, defaults);
		expect(args.xIN).toBe(3);
		expect(args.alpha).toBe(0.05);
	});
	it('does not overwrite falsy-but-present values', () => {
		const args = { alpha: 0 };
		fillDefaults(args, defaults);
		expect(args.alpha).toBe(0);
	});
	it('clones object/array defaults so instances do not share refs', () => {
		const a = {};
		const b = {};
		fillDefaults(a, defaults);
		fillDefaults(b, defaults);
		expect(a.preProcesses).toEqual([]);
		expect(a.preProcesses).not.toBe(b.preProcesses);
		expect(a.preProcesses).not.toBe(defaults.get('preProcesses').val);
	});
	it('skips structured entries like out', () => {
		const args = {};
		fillDefaults(args, defaults);
		expect(args.out).toBeUndefined();
	});
});
