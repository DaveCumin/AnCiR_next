/**
 * Regression test for the "Cannot convert a Symbol value to a string" crash when
 * clicking a Split output (or any column whose ref chain has a cycle a few hops
 * deep). Column.toJSON serialised the recursive `provenance` $derived; on a cyclic
 * ref chain Svelte hands back its UNINITIALIZED symbol for the in-flight derived,
 * and interpolating a Symbol into a template string throws — which surfaced during
 * recordPlotEdit's JSON.stringify.
 *
 * The `name` derived short-circuits on a customName, so a cycle *below* a named
 * column crashes `provenance` while `name` resolves fine — matching the reported
 * stack. We reproduce that exact shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fakeCore, fakeAppState, fakeAppConsts } = vi.hoisted(() => ({
	fakeCore: { data: [], rawData: new Map(), tables: [], plots: [] },
	fakeAppState: { displayTimezone: 'utc', AYStext: '', AYScallback: null, showAYSModal: false },
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
	let _pid = 0;
	return {
		Process: class {
			static fromJSON(json) {
				const p = new this();
				Object.assign(p, json);
				return p;
			}
			constructor() {
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

describe('Column provenance cycle safety', () => {
	it('reading provenance on a cyclic ref chain does not throw', () => {
		// b ⇄ c mutual refs, both named (so `name` terminates); provenance recurses
		// through the cycle and must be broken by the guard rather than throwing.
		const b = new ColumnClass({});
		const c = new ColumnClass({});
		fakeCore.data.push(b, c);
		b.refId = c.id;
		b.customName = 'B';
		c.refId = b.id;
		c.customName = 'C';

		expect(() => b.provenance).not.toThrow();
		expect(typeof b.provenance).toBe('string');
	});

	it('provenance describes one hop only (no recursive "which is" tail)', () => {
		// The recursive tail (…which is <refColumn.provenance>) was the self-reference
		// that crashed; provenance must no longer read another column's provenance.
		const src = new ColumnClass({ type: 'number', data: -1 });
		src.customName = 'Source';
		fakeCore.data.push(src);
		const ref = new ColumnClass({ refId: src.id });
		fakeCore.data.push(ref);

		expect(ref.provenance).toBe('refers to Source');
		expect(ref.provenance).not.toContain('which is');
	});

	it('does not serialise the derived provenance field', () => {
		const src = new ColumnClass({ type: 'number', data: -1 });
		fakeCore.data.push(src);
		const ref = new ColumnClass({ refId: src.id });
		fakeCore.data.push(ref);

		const json = ref.toJSON();
		expect(json).not.toHaveProperty('provenance');
	});
});
