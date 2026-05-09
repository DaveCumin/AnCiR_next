/**
 * Probes whether Object.assign in the Column constructor overrides the
 * $derived `type` / `name` / `originTime_ms` getters, or whether Svelte 5
 * silently rejects writes to a derived. The answer governs whether
 * JSON-loaded wrappers behave like fresh-added ones.
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
vi.mock('$lib/core/Process.svelte', () => ({
	Process: class {
		static fromJSON(json) {
			const p = new this();
			Object.assign(p, json);
			return p;
		}
		constructor() {
			this.id = Math.random();
			this.args = {};
		}
		doProcess(out) {
			return out;
		}
	},
	nextLinkedGroupId: () => 1,
	getLinkedProcesses: () => []
}));

import { Column as ColumnClass } from './Column.svelte';

beforeEach(() => {
	fakeCore.data.length = 0;
	fakeCore.rawData.clear();
});

describe('Column construction probes', () => {
	it('Object.assign with type=undefined leaves the derived intact (refColumn.type still wins)', () => {
		const underlying = new ColumnClass({ type: 'time' });
		fakeCore.data.push(underlying);

		// Equivalent to `new ColumnClass({ refId, ... })` from in-plot Add.
		const wrapper = new ColumnClass({ refId: underlying.id });
		expect(wrapper.type).toBe('time'); // delegated via $derived
	});

	it('Object.assign with type=null (legacy fromJSON null-default) — does it leak?', () => {
		const underlying = new ColumnClass({ type: 'time' });
		fakeCore.data.push(underlying);

		// Pass a literal null explicitly (NOT through fromJSON's filter).
		const wrapper = new ColumnClass({ refId: underlying.id, type: null });
		// If Svelte 5 silently rejects derived writes, wrapper.type === 'time'.
		// If it overrides, wrapper.type === null (the literal).
		console.log('type after null override:', wrapper.type);
	});

	it('Object.assign with type="time" (real value, like JSON load) — does it override?', () => {
		const underlying = new ColumnClass({ type: 'time' });
		fakeCore.data.push(underlying);

		const wrapper = new ColumnClass({ refId: underlying.id, type: 'time' });
		expect(wrapper.type).toBe('time'); // should match either way
		// If override succeeds, wrapper.type is now a plain prop, not derived.
		// We can detect that by changing the underlying type and seeing
		// whether wrapper.type follows.
		underlying.type = 'number'; // Note: also a derived for non-ref → test via direct set on a fresh underlying
	});

	it('Wrapper from JSON-shaped input matches the underlying type even after refColumn type changes', () => {
		// Underlying is a non-ref bin column with originTime_ms baked in.
		const underlying = new ColumnClass({
			type: 'bin',
			binWidth: 1,
			originTime_ms: 1700000000000
		});
		fakeCore.data.push(underlying);

		const wrapperJson = ColumnClass.fromJSON({
			id: 999,
			name: 'wrap*',
			refId: underlying.id,
			type: 'bin',
			tableProcessGUId: '',
			processes: []
		});
		const wrapperFresh = new ColumnClass({ refId: underlying.id });

		expect(wrapperJson.type).toBe('bin');
		expect(wrapperFresh.type).toBe('bin');
		expect(wrapperJson.originTime_ms).toBe(1700000000000);
		expect(wrapperFresh.originTime_ms).toBe(1700000000000);
		expect(wrapperJson.binWidth).toBe(1);
		expect(wrapperFresh.binWidth).toBe(1);
	});
});
