/**
 * Regression test: a column must NOT throw when its rawData entry is missing.
 *
 * Symptom this guards against: loading a session where a column's `data` id
 * is absent from core.rawData (e.g. an 'awd' column whose stored array was
 * never written, or a legacy session migration where the id diverges). The
 * `hoursSinceStart` derived and the getData() pipeline indexed
 * `core.rawData.get(this.data).length` with no guard, so they threw
 * "Cannot read properties of undefined (reading 'length')".
 *
 * Because importJson awaits a reactive flush mid-import, that throw aborted
 * the whole import before groups and table-processes were migrated, leaving
 * the Data Sources panel empty of BOTH columns and processes. A column with a
 * missing rawData entry must degrade to an empty series instead of throwing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fakeCore, fakeAppState, fakeAppConsts } = vi.hoisted(() => ({
	fakeCore: { data: [], rawData: new Map(), tables: [], plots: [] },
	fakeAppState: {
		displayTimezone: 'utc',
		AYStext: '',
		AYScallback: null,
		showAYSModal: false
	},
	fakeAppConsts: {}
}));

vi.mock('$lib/core/core.svelte.js', () => ({
	core: fakeCore,
	appConsts: fakeAppConsts,
	appState: fakeAppState
}));
vi.mock('$lib/core/core.svelte', () => ({
	core: fakeCore,
	appConsts: fakeAppConsts,
	appState: fakeAppState
}));
vi.mock('$lib/core/Process.svelte', () => {
	// Deterministic mock ids (was Math.random(), which risked cross-test collisions)
	let _pid = 0;
	return {
		Process: class {
			static fromJSON(json) {
				return new this(json);
			}
			constructor(args) {
				Object.assign(this, args);
				this.id = ++_pid;
				this.args = {};
			}
			doProcess(out) {
				return out;
			}
		},
		nextLinkedGroupId: () => 1,
		getLinkedProcesses: () => []
	};
});

import { Column as ColumnClass } from './Column.svelte';

beforeEach(() => {
	fakeCore.data.length = 0;
	fakeCore.rawData.clear();
});

describe('Column with a missing rawData entry degrades safely', () => {
	it('awd number column whose data id is absent from rawData: hoursSinceStart returns [] (no throw)', () => {
		const col = new ColumnClass({ type: 'number' });
		col.compression = 'awd';
		col.data = 99999; // deliberately not present in core.rawData
		fakeCore.data.push(col);

		expect(() => col.hoursSinceStart).not.toThrow();
		expect(col.hoursSinceStart).toEqual([]);
	});

	it('awd column whose data id is absent from rawData: getData() returns [] (no throw)', () => {
		const col = new ColumnClass({ type: 'number' });
		col.compression = 'awd';
		col.data = 99999;
		fakeCore.data.push(col);

		expect(() => col.getData()).not.toThrow();
		expect(col.getData()).toEqual([]);
	});
});
