/**
 * groupLabel persistence: the per-column group/replicate label must survive a
 * toJSON -> fromJSON round-trip, and must be omitted from JSON when unset so
 * existing sessions/snapshots stay byte-identical.
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

describe('Column.groupLabel persistence', () => {
	it('defaults to null and is omitted from JSON when unset', () => {
		const col = new ColumnClass({ type: 'number', data: 1 });
		expect(col.groupLabel).toBe(null);
		expect('groupLabel' in col.toJSON()).toBe(false);
	});

	it('serialises a set label and restores it via fromJSON', () => {
		const col = new ColumnClass({ type: 'number', data: 1 });
		col.groupLabel = 'WT';
		const json = col.toJSON();
		expect(json.groupLabel).toBe('WT');

		const restored = ColumnClass.fromJSON(json);
		expect(restored.groupLabel).toBe('WT');
	});

	it('does not emit an empty-string label', () => {
		const col = new ColumnClass({ type: 'number', data: 1 });
		col.groupLabel = '';
		expect('groupLabel' in col.toJSON()).toBe(false);
	});
});
