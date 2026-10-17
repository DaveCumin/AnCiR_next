// Stored-value identity: one entry per <owner>|<default name>, however many
// buttons hold it (the canvas node and the control panel both mount the node).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/core/Column.svelte', () => ({ Column: vi.fn(), getColumnById: vi.fn() }));
vi.mock('$lib/core/Plot.svelte', () => ({ Plot: vi.fn() }));

import { core, getStoredValue, renameStoredValue, outputCoreAsJson } from '$lib/core/core.svelte';
import {
	claimStoredValue,
	releaseStoredValue,
	updateStoredValueClaim,
	storedValueKey,
	storedValueNameForKey,
	storedValueHolderCount,
	resetStoredValueClaimsForTest,
	sweepStoredValueOwners
} from './storedValueClaims.js';

beforeEach(() => {
	resetStoredValueClaimsForTest();
	for (const k of Object.keys(core.storedValues)) delete core.storedValues[k];
	core.tableProcesses.length = 0;
	core.plots.length = 0;
});

const KEY = 'tp:2|cosinor_rmse_y';

describe('claimStoredValue', () => {
	it('two holders of one key share ONE entry', () => {
		const a = {};
		const b = {};
		const n1 = claimStoredValue({ key: KEY, base: 'cosinor_rmse_y', getter: () => 1, token: a });
		const n2 = claimStoredValue({ key: KEY, base: 'cosinor_rmse_y', getter: () => 1, token: b });
		expect(n1).toBe('cosinor_rmse_y');
		expect(n2).toBe('cosinor_rmse_y');
		expect(Object.keys(core.storedValues)).toEqual(['cosinor_rmse_y']);
		expect(storedValueHolderCount(KEY)).toBe(2);
	});

	it('different owners with the same default name still get distinct names', () => {
		claimStoredValue({ key: 'tp:1|v', base: 'v', getter: () => 1, token: {} });
		const n = claimStoredValue({ key: 'tp:2|v', base: 'v', getter: () => 2, token: {} });
		expect(n).toBe('v_2');
		expect(getStoredValue('v')).toBe(1);
		expect(getStoredValue('v_2')).toBe(2);
	});

	it('the entry outlives the first holder and switches to the remaining getter', () => {
		const a = {};
		const b = {};
		claimStoredValue({ key: KEY, base: 'x', getter: () => 1, token: a });
		claimStoredValue({ key: KEY, base: 'x', getter: () => 2, token: b });
		expect(getStoredValue('x')).toBe(1);
		releaseStoredValue(KEY, a);
		expect(getStoredValue('x')).toBe(2);
		releaseStoredValue(KEY, b);
		expect('x' in core.storedValues).toBe(false);
	});

	it('a rename by one holder is the name every holder sees', () => {
		const a = {};
		const b = {};
		claimStoredValue({ key: KEY, base: 'x', getter: () => 1, token: a });
		claimStoredValue({ key: KEY, base: 'x', getter: () => 1, token: b });
		renameStoredValue('x', 'my_rmse');
		expect(storedValueNameForKey(KEY)).toBe('my_rmse');
		releaseStoredValue(KEY, a);
		releaseStoredValue(KEY, b);
		expect(core.storedValues).toEqual({});
	});

	it('updates follow the active holder only', () => {
		const a = {};
		const b = {};
		claimStoredValue({ key: KEY, base: 'x', getter: () => 1, token: a });
		claimStoredValue({ key: KEY, base: 'x', getter: () => 2, token: b });
		updateStoredValueClaim(KEY, b, () => 3);
		expect(getStoredValue('x')).toBe(1);
		updateStoredValueClaim(KEY, a, () => 4);
		expect(getStoredValue('x')).toBe(4);
	});

	it('anonymous keys (no owner) behave as sole holders, as before', () => {
		const k1 = storedValueKey(null, 'v');
		const k2 = storedValueKey(null, 'v');
		expect(k1).not.toBe(k2);
		claimStoredValue({ key: k1, base: 'v', getter: () => 1, token: {} });
		expect(claimStoredValue({ key: k2, base: 'v', getter: () => 2, token: {} })).toBe('v_2');
		expect(core.storedValues.v.key).toBeUndefined();
	});

	it('the identity key is saved; anonymous keys are not', () => {
		claimStoredValue({ key: KEY, base: 'x', getter: () => 1, token: {} });
		claimStoredValue({ key: storedValueKey(null, 'y'), base: 'y', getter: () => 2, token: {} });
		const out = JSON.parse(outputCoreAsJson());
		expect(out.storedValues.x).toEqual({ source: '', key: KEY, staticValue: 1 });
		expect(out.storedValues.y).toEqual({ source: '', staticValue: 2 });
	});
});

describe('loading saved sessions', () => {
	it('a keyed snapshot is claimed by its key, even under a renamed name', () => {
		core.storedValues.my_name = { source: 'Cosinor', key: KEY, staticValue: 5 };
		const n = claimStoredValue({ key: KEY, base: 'cosinor_rmse_y', getter: () => 6, token: {} });
		expect(n).toBe('my_name');
		expect(getStoredValue('my_name')).toBe(6);
		expect(Object.keys(core.storedValues)).toEqual(['my_name']);
	});

	it("another owner's keyed snapshot of the same name is never taken over", () => {
		core.storedValues.v = { source: 'Cosinor', key: 'tp:9|v', staticValue: 5 };
		const n = claimStoredValue({ key: 'tp:2|v', base: 'v', getter: () => 6, token: {} });
		expect(n).toBe('v_2');
		expect(core.storedValues.v.staticValue).toBe(5);
	});

	it('a legacy (keyless) snapshot is claimed by the default name', () => {
		core.storedValues.v = { source: 'Cosinor', staticValue: 5 };
		expect(claimStoredValue({ key: KEY, base: 'v', getter: () => 6, token: {} })).toBe('v');
		expect(core.storedValues.v.key).toBe(KEY);
	});

	it('legacy panel copies (<base>_N, same family, same value) fold into the claimed value', () => {
		core.storedValues.v = { source: 'Cosinor', staticValue: 5 };
		core.storedValues.v_2 = { source: 'Cosinor (fixed)', staticValue: 5 };
		core.storedValues.v_3 = { source: 'Cosinor', staticValue: 7 }; // a different value: kept
		core.tableProcesses.push({
			id: 4,
			name: 'FormulaColumn',
			args: { tokens: [{ type: 'stored', key: 'v_2' }] }
		});
		claimStoredValue({ key: KEY, base: 'v', getter: () => 5, token: {} });
		expect(Object.keys(core.storedValues).sort()).toEqual(['v', 'v_3']);
		expect(core.tableProcesses[0].args.tokens[0].key).toBe('v');
	});

	it('a holder unmounting AFTER a session load leaves the restored snapshot alone', () => {
		const a = {};
		claimStoredValue({ key: KEY, base: 'x', getter: () => 1, token: a });
		// importJson: reset + restore the saved snapshot under the same name/key.
		delete core.storedValues.x;
		core.storedValues.x = { source: '', key: KEY, staticValue: 1 };
		releaseStoredValue(KEY, a);
		expect(core.storedValues.x).toEqual({ source: '', key: KEY, staticValue: 1 });
	});
});

// REPORTED 2026-10-17: selecting a Double Logistic node (or switching view, or collapsing it)
// unmounted every one of its buttons, which deleted its stored values and broke every formula
// using them. The value belongs to the NODE: it stays while the node exists, whether or not a
// button is on screen, and goes when the node is deleted.
describe('the node owns its stored values', () => {
	it('every button unmounting keeps the value while the node exists', () => {
		core.tableProcesses.push({ id: 2, name: 'Cosinor', args: {} });
		const a = {};
		let v = 1.5;
		claimStoredValue({ key: KEY, base: 'x', getter: () => v, token: a });
		renameStoredValue('x', 'my_rmse');
		releaseStoredValue(KEY, a);
		expect(Object.keys(core.storedValues)).toEqual(['my_rmse']);
		expect(getStoredValue('my_rmse')).toBe(1.5);
		// The saved copy carries the value and the key, so a reload claims it as before.
		const out = JSON.parse(outputCoreAsJson());
		expect(out.storedValues.my_rmse).toEqual({ source: '', key: KEY, staticValue: 1.5 });
		v = 2;
		// A button mounting again takes the same entry (name kept) with its own getter.
		const n = claimStoredValue({ key: KEY, base: 'x', getter: () => 7, token: {} });
		expect(n).toBe('my_rmse');
		expect(getStoredValue('my_rmse')).toBe(7);
		expect(Object.keys(core.storedValues)).toEqual(['my_rmse']);
	});

	it('a plot owns its values the same way', () => {
		core.plots.push({ id: 5 });
		const a = {};
		claimStoredValue({ key: 'plot:5|peak', base: 'peak', getter: () => 24.1, token: a });
		releaseStoredValue('plot:5|peak', a);
		expect(getStoredValue('peak')).toBe(24.1);
	});

	it('deleting the node releases its values, held or not', () => {
		core.tableProcesses.push({ id: 2, name: 'Cosinor', args: {} });
		const a = {};
		claimStoredValue({ key: KEY, base: 'x', getter: () => 1, token: a });
		claimStoredValue({ key: 'tp:3|y', base: 'y', getter: () => 2, token: {} });
		core.tableProcesses.push({ id: 3, name: 'Cosinor', args: {} });
		releaseStoredValue(KEY, a);
		expect(Object.keys(core.storedValues).sort()).toEqual(['x', 'y']);
		core.tableProcesses.splice(0, 1); // node 2 deleted while none of its buttons is mounted
		sweepStoredValueOwners();
		expect(Object.keys(core.storedValues)).toEqual(['y']);
	});

	it('a button unmounting after its node was deleted removes the value at once', () => {
		const a = {};
		claimStoredValue({ key: KEY, base: 'x', getter: () => 1, token: a });
		// node 2 is not in core: it was deleted, and its component unmounts after
		releaseStoredValue(KEY, a);
		expect(core.storedValues).toEqual({});
	});

	it('a snapshot restored by a session load is not swept while its node exists', () => {
		core.tableProcesses.push({ id: 2, name: 'Cosinor', args: {} });
		core.storedValues.x = { source: '', key: KEY, staticValue: 3 };
		sweepStoredValueOwners();
		expect(getStoredValue('x')).toBe(3);
	});
});

describe('every component that renders a StoreValueButton names its owner', () => {
	it('calls provideStoredValueOwner (otherwise each mounted copy registers its own value)', async () => {
		const { readFileSync, readdirSync, statSync } = await import('node:fs');
		const { join } = await import('node:path');
		const walk = (dir) =>
			readdirSync(dir).flatMap((f) => {
				const p = join(dir, f);
				return statSync(p).isDirectory() ? walk(p) : p.endsWith('.svelte') ? [p] : [];
			});
		const users = walk('src/lib').filter(
			(f) => !f.includes('conflicted') && /<StoreValueButton\b/.test(readFileSync(f, 'utf8'))
		);
		expect(users.length).toBeGreaterThanOrEqual(13);
		const missing = users.filter(
			(f) => !/provideStoredValueOwner\(\s*'(tp|plot)'/.test(readFileSync(f, 'utf8'))
		);
		expect(missing).toEqual([]);
	});
});
