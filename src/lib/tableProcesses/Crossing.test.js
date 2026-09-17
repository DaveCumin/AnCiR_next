import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: new Map(), tableProcesses: [], storedValues: {} }
}));
vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => mockColumns[id],
	Column: class {}
}));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));

import { crossingdata } from './Crossing.svelte';
import { core } from '$lib/core/core.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	core.rawData.clear();
});

const col = (data) => ({ type: 'number', getData: () => data });
const outCol = () => ({ type: 'number', data: -1 });

/** Build minimal args: one y series (id 1), optional x (id 0), one rule group. */
function args(overrides = {}) {
	mockColumns[90] = outCol();
	mockColumns[91] = outCol();
	mockColumns[92] = outCol();
	return {
		xIN: -1,
		yIN: [1],
		thresholdIN: [],
		groups: [[{ target: 1, isOperator: '<', source: -1, value: 10 }]],
		persistence: 0,
		out: { breach: 90, crossing: 91, count: 92 },
		...overrides
	};
}

describe('crossingdata — validity', () => {
	it('is invalid with no condition groups', () => {
		mockColumns[1] = col([1, 2, 3]);
		expect(crossingdata(args({ groups: [] }))[1]).toBe(false);
	});

	it('is invalid when a condition targets an unwired series', () => {
		mockColumns[1] = col([1, 2, 3]);
		mockColumns[5] = col([1, 2, 3]);
		expect(
			crossingdata(args({ groups: [[{ target: 5, isOperator: '<', source: -1, value: 10 }]] }))[1]
		).toBe(false);
	});

	it('is invalid when referenced series lengths differ', () => {
		mockColumns[1] = col([1, 2, 3]);
		mockColumns[2] = col([1, 2]);
		expect(
			crossingdata(
				args({
					yIN: [1, 2],
					groups: [
						[
							{ target: 1, isOperator: '<', source: -1, value: 10 },
							{ target: 2, isOperator: '<', source: -1, value: 10 }
						]
					]
				})
			)[1]
		).toBe(false);
	});
});

describe('crossingdata — basic crossings and outputs', () => {
	it('reports the sample index of a single crossing when x is unwired', () => {
		mockColumns[1] = col([20, 20, 5, 5, 20]);
		const [res, valid] = crossingdata(args());
		expect(valid).toBe(true);
		expect(res.crossings).toEqual([2]); // first sample satisfying "below 10"
		expect(res.count).toBe(1);
		expect(res.breach).toEqual([0, 0, 1, 1, 0]);
	});

	it('reports the x VALUE at the crossing when x is wired', () => {
		mockColumns[0] = col([100, 200, 300, 400, 500]);
		mockColumns[1] = col([20, 20, 5, 5, 20]);
		const [res] = crossingdata(args({ xIN: 0 }));
		expect(res.crossings).toEqual([300]);
	});

	it('writes breach, crossing and count into the output columns', () => {
		mockColumns[1] = col([20, 5, 20]);
		crossingdata(args());
		expect(core.rawData.get(90)).toEqual([0, 1, 0]);
		expect(core.rawData.get(91)).toEqual([1]);
		expect(core.rawData.get(92)).toEqual([1]);
	});

	it('takes a wired scalar threshold from thresholdIN (length-1 column)', () => {
		mockColumns[1] = col([20, 20, 5, 20]);
		mockColumns[7] = col([10]);
		const [res] = crossingdata(
			args({
				thresholdIN: [7],
				groups: [[{ target: 1, isOperator: '<', source: 7, value: 999 }]]
			})
		);
		expect(res.crossings).toEqual([2]); // used 10 from column 7, not the typed 999
	});
});

describe('crossingdata — rule logic', () => {
	it('OR of two one-sided groups behaves as an outside-band rule', () => {
		mockColumns[1] = col([15, 25, 15, 5, 15]);
		const groups = [
			[{ target: 1, isOperator: '>', source: -1, value: 20 }],
			[{ target: 1, isOperator: '<', source: -1, value: 10 }]
		];
		const [res] = crossingdata(args({ groups }));
		expect(res.breach).toEqual([0, 1, 0, 1, 0]);
		expect(res.count).toBe(2);
	});

	it('AND within a group requires all conditions (compound cross-series rule)', () => {
		mockColumns[1] = col([5, 5, 20, 5]);
		mockColumns[2] = col([100, 30, 30, 30]);
		const groups = [
			[
				{ target: 1, isOperator: '<', source: -1, value: 10 },
				{ target: 2, isOperator: '<', source: -1, value: 50 }
			]
		];
		const [res] = crossingdata(args({ yIN: [1, 2], groups }));
		// i0: y1 ok, y2 fails; i1: both; i2: y1 fails; i3: both
		expect(res.breach).toEqual([0, 1, 0, 1]);
	});

	it('a condition can target x, acting as a gate', () => {
		mockColumns[0] = col([1, 2, 3, 4, 5]);
		mockColumns[1] = col([5, 5, 5, 5, 5]); // always below 10
		const groups = [
			[
				{ target: 1, isOperator: '<', source: -1, value: 10 },
				{ target: 'x', isOperator: '>', source: -1, value: 3 }
			]
		];
		const [res] = crossingdata(args({ xIN: 0, groups }));
		expect(res.breach).toEqual([0, 0, 0, 1, 1]);
		expect(res.crossings).toEqual([4]);
	});
});

describe('crossingdata — persistence', () => {
	it('with x wired, persistence is in x units and the crossing fires at run completion', () => {
		// hourly x; persistence 3 h => 3 consecutive samples
		mockColumns[0] = col([1, 2, 3, 4, 5, 6, 7]);
		mockColumns[1] = col([20, 5, 5, 5, 20, 5, 5]);
		const [res] = crossingdata(args({ xIN: 0, persistence: 3 }));
		expect(res.crossings).toEqual([4]); // run starts at x=2, completes 3rd sample at x=4
		expect(res.count).toBe(1); // second dip (2 samples) never completes
	});

	it('the same persistence in x units needs more samples at finer spacing', () => {
		// 0.5-spaced x; persistence 3 => 6 consecutive samples
		mockColumns[0] = col([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
		mockColumns[1] = col([20, 5, 5, 5, 5, 5, 20, 5, 5, 5]);
		const [res] = crossingdata(args({ xIN: 0, persistence: 3 }));
		expect(res.crossings).toEqual([]); // longest run is 5 samples < 6 required
	});

	it('with x unwired, persistence is a number of consecutive values', () => {
		mockColumns[1] = col([20, 5, 5, 20, 5, 5, 5]);
		const [res] = crossingdata(args({ persistence: 3 }));
		expect(res.crossings).toEqual([6]);
	});
});

describe('crossingdata — missing data and re-arming', () => {
	it('missing values yield null breach and break a persistence run', () => {
		mockColumns[1] = col([20, 5, null, 5, 5, 20]);
		const [res] = crossingdata(args({ persistence: 2 }));
		expect(res.breach).toEqual([0, 1, null, 1, 1, 0]);
		expect(res.crossings).toEqual([4]); // run before the gap never reached 2
	});

	it('one long excursion is ONE crossing (re-arms only after the rule goes false)', () => {
		mockColumns[1] = col([20, 5, 5, 5, 5, 5, 20]);
		const [res] = crossingdata(args({ persistence: 2 }));
		expect(res.crossings).toEqual([2]);
		expect(res.count).toBe(1);
	});

	it('dip-recover-dip yields two crossings', () => {
		mockColumns[1] = col([20, 5, 5, 20, 5, 5, 20]);
		const [res] = crossingdata(args({ persistence: 2 }));
		expect(res.crossings).toEqual([2, 5]);
		expect(res.count).toBe(2);
	});

	it('a null after a crossing does not re-arm; an explicit false does', () => {
		mockColumns[1] = col([5, 5, null, 5, 5, 20, 5, 5]);
		const [res] = crossingdata(args({ persistence: 2 }));
		// crossing at 1; null at 2 keeps it disarmed; 5s at 3-4 do not fire;
		// 20 at 5 re-arms; second crossing completes at 7
		expect(res.crossings).toEqual([1, 7]);
	});
});
