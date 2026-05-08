/**
 * Reproduction test for "in-plot Add data vs Make Plot" asymmetry on the
 * Scatterplot. The two flows construct the wrapper Column differently:
 *
 *   Make Plot:   ColumnClass.fromJSON({ refId: 5 })
 *                → new Column({ name: undef, type: undef, refId: 5,
 *                               binWidth: null, originTime_ms: null, ... })
 *
 *   In-plot Add: new ColumnClass({ refId: 5 })
 *                → new Column({ refId: 5 })
 *
 * Both should produce a wrapper that delegates type / originTime_ms /
 * binWidth to the underlying column via the $derived getters. If
 * Object.assign in the constructor overrides those getters with the literal
 * `null` from fromJSON, we'd see different behaviour between the two flows.
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
			return new this(json);
		}
		constructor(args) {
			Object.assign(this, args);
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

describe('Wrapper construction parity: fromJSON vs new ColumnClass({refId})', () => {
	it('underlying time column: both wrappers should report type=time', () => {
		const underlying = new ColumnClass({ type: 'time', timeFormat: 'YYYY-MM-DD' });
		fakeCore.data.push(underlying);

		const wrapperA = ColumnClass.fromJSON({ refId: underlying.id });
		const wrapperB = new ColumnClass({ refId: underlying.id });

		expect(wrapperA.type).toBe('time');
		expect(wrapperB.type).toBe('time');
		expect(wrapperA.type).toBe(wrapperB.type);
	});

	it('underlying bin column with originTime_ms: both wrappers should expose the same origin', () => {
		const underlying = new ColumnClass({
			type: 'bin',
			binWidth: 1,
			originTime_ms: 1745000000000
		});
		fakeCore.data.push(underlying);

		const wrapperA = ColumnClass.fromJSON({ refId: underlying.id });
		const wrapperB = new ColumnClass({ refId: underlying.id });

		expect(wrapperA.originTime_ms).toBe(1745000000000);
		expect(wrapperB.originTime_ms).toBe(1745000000000);
		expect(wrapperA.binWidth).toBe(1);
		expect(wrapperB.binWidth).toBe(1);
	});

	it('underlying bin column without origin: both wrappers should agree on missing origin', () => {
		const underlying = new ColumnClass({ type: 'bin', binWidth: 1 });
		fakeCore.data.push(underlying);

		const wrapperA = ColumnClass.fromJSON({ refId: underlying.id });
		const wrapperB = new ColumnClass({ refId: underlying.id });

		// Whatever the answer is, they MUST agree — otherwise the two flows
		// produce visibly different plots from the same x column.
		expect(wrapperA.originTime_ms).toBe(wrapperB.originTime_ms);
		expect(wrapperA.type).toBe(wrapperB.type);
	});

	it('underlying number column: wrapper should NOT carry a literal-null originTime_ms', () => {
		// Regression: `originTime_ms ?? null` in fromJSON shadowed the $derived
		// getter with `null`. resolveXOriginMs then did Number(null) === 0 and
		// treated 0 as a valid origin; xlims collapsed to [Infinity, -Infinity]
		// and number-vs-number scatter plots emitted "MNaN" in their <path d=…>.
		const underlying = new ColumnClass({ type: 'number' });
		fakeCore.data.push(underlying);

		const wrapperA = ColumnClass.fromJSON({ refId: underlying.id });
		const wrapperB = new ColumnClass({ refId: underlying.id });

		// Either undefined (derived for ref column with non-ref leaf) is OK;
		// the contract is "not the literal null", so Number(...) won't lie.
		expect(wrapperA.originTime_ms).not.toBe(null);
		expect(wrapperB.originTime_ms).not.toBe(null);
		expect(wrapperA.type).toBe('number');
		expect(wrapperB.type).toBe('number');
	});
});
