import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/core/Column.svelte', () => ({ Column: vi.fn(), getColumnById: vi.fn() }));
vi.mock('$lib/core/Plot.svelte', () => ({ Plot: vi.fn() }));

import {
	core,
	storeValue,
	storeValueRef,
	resolveStoredValueRef,
	getStoredValue,
	removeStoredValue,
	renameStoredValue,
	outputCoreAsJson
} from '$lib/core/core.svelte';

function seedMetricTP() {
	core.tableProcesses.length = 0;
	core.tableProcesses.push({
		id: 7,
		name: 'cosinor',
		args: { xIN: 1, yIN: [2, 3], out: { cosinorx: 100, period: 101 } }
	});
	core.rawData.clear();
	core.rawData.set(101, [24.13, 23.87]);
}

beforeEach(() => {
	for (const k of Object.keys(core.storedValues)) delete core.storedValues[k];
	seedMetricTP();
});

describe('ref-based stored values (metric-port refs)', () => {
	it('resolves by yId, robust to yIN reorder', () => {
		storeValueRef('tau_act', { tpId: 7, outKey: 'period', yId: 3 }, 'Cosinor');
		expect(getStoredValue('tau_act')).toBe(23.87);

		// Swap the y order + values (a reorder recomputes the metric column too).
		core.tableProcesses[0].args.yIN = [3, 2];
		core.rawData.set(101, [23.87, 24.13]);
		expect(getStoredValue('tau_act')).toBe(23.87);
	});

	it('resolves by index when yId is null (e.g. GroupComparison multi-Y mode)', () => {
		storeValueRef('p_all', { tpId: 7, outKey: 'period', yId: null, index: 1 });
		expect(getStoredValue('p_all')).toBe(23.87);
	});

	it('falls back to the static snapshot when the source is gone', () => {
		core.storedValues.tau = {
			ref: { tpId: 999, outKey: 'period', yId: 3 },
			source: '',
			staticValue: 24.5
		};
		expect(getStoredValue('tau')).toBe(24.5);
	});

	it('returns NaN when unresolvable and no snapshot exists', () => {
		storeValueRef('tau', { tpId: 7, outKey: 'period', yId: 99 });
		expect(getStoredValue('tau')).toBeNaN();
	});

	it('supports rename and remove like any stored value', () => {
		storeValueRef('tau', { tpId: 7, outKey: 'period', yId: 2 });
		expect(renameStoredValue('tau', 'tau_temp')).toBe('tau_temp');
		expect(getStoredValue('tau_temp')).toBe(24.13);
		removeStoredValue('tau_temp');
		expect(getStoredValue('tau_temp')).toBeNaN();
	});

	it('resolveStoredValueRef handles legacy scalar yIN args', () => {
		core.tableProcesses[0].args.yIN = 2;
		expect(resolveStoredValueRef({ tpId: 7, outKey: 'period', yId: 2 })).toBe(24.13);
	});
});

describe('rename propagation into formula references', () => {
	it('rewrites FormulaColumn tokens, BlankColumn refs, and StoredValueGroup keys', () => {
		storeValueRef('tau', { tpId: 7, outKey: 'period', yId: 2 });
		core.tableProcesses.push(
			{
				id: 20,
				name: 'formulacolumn',
				args: {
					tokens: [
						{ type: 'text', text: '2*' },
						{ type: 'stored', key: 'tau' },
						{ type: 'stored', key: 'other' }
					],
					out: {}
				}
			},
			{
				id: 21,
				name: 'blankcolumn',
				args: { storedValueRefs: { 0: 'tau', 1: 'other' }, out: {} }
			},
			{
				id: 22,
				name: 'storedvaluegroup',
				args: { groups: [{ id: 'g1', name: 'G', keys: ['tau', 'other'] }], out: {} }
			}
		);

		const finalName = renameStoredValue('tau', 'tau_renamed');
		expect(finalName).toBe('tau_renamed');
		expect(core.tableProcesses[1].args.tokens[1].key).toBe('tau_renamed');
		expect(core.tableProcesses[1].args.tokens[2].key).toBe('other'); // untouched
		expect(core.tableProcesses[2].args.storedValueRefs).toEqual({ 0: 'tau_renamed', 1: 'other' });
		expect(core.tableProcesses[3].args.groups[0].keys).toEqual(['tau_renamed', 'other']);
		// The renamed entry still resolves live.
		expect(getStoredValue('tau_renamed')).toBe(24.13);
	});

	it('collision-suffixed renames propagate the FINAL name', () => {
		storeValueRef('a', { tpId: 7, outKey: 'period', yId: 2 });
		storeValueRef('b', { tpId: 7, outKey: 'period', yId: 3 });
		core.tableProcesses.push({
			id: 20,
			name: 'formulacolumn',
			args: { tokens: [{ type: 'stored', key: 'b' }], out: {} }
		});
		// 'a' exists, so renaming b → a lands on a_2.
		expect(renameStoredValue('b', 'a')).toBe('a_2');
		expect(core.tableProcesses[1].args.tokens[0].key).toBe('a_2');
	});
});

describe('stored-value serialisation', () => {
	it('keeps the ref (plus a snapshot) for ref entries; getters become snapshots', () => {
		storeValueRef('tau_act', { tpId: 7, outKey: 'period', yId: 3 }, 'Cosinor');
		storeValue('live_getter', () => 42, 'FFT');

		const out = JSON.parse(outputCoreAsJson());
		expect(out.storedValues.tau_act).toEqual({
			source: 'Cosinor',
			ref: { tpId: 7, outKey: 'period', yId: 3 },
			staticValue: 23.87
		});
		expect(out.storedValues.live_getter).toEqual({ source: 'FFT', staticValue: 42 });
	});
});
