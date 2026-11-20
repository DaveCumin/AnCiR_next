// @ts-nocheck
// The "all inputs of a column process must be the same type" rule is declared per process
// (`sameType` on the definition's input port, core/processInputRules.js), default true.
// Filter takes a mix (its conditions test other columns), and each mixed input then computes
// on its own: a time input keeps its type and zone, a number input stays numeric.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { core, appConsts, appState, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Process } from '$lib/core/Process.svelte';
import { loadProcesses } from '$lib/processes/processMap.js';
import { mutationService as M } from '$lib/core/mutationService.js';
import { history } from '$lib/core/opHistory.svelte.js';
import { timeZoneSource, clockZoneOf } from './columnTimeZone.js';
import {
	requiresSameTypeInputs,
	disallowedInputTypes,
	inputTypeRefusal,
	processInputRefusal
} from './processInputRules.js';

const NZ = 'Pacific/Auckland';
const TIMES = ['2024-04-06 23:00', '2024-04-07 00:00', '2024-04-07 01:00', '2024-04-07 02:00'];

// The classification (see each definition's comment for its reason).
const EXPECTED_SAME_TYPE = {
	Add: true,
	Multiply: true,
	normalize: true,
	OutlierRemoval: true,
	RemoveTrend: true,
	EditValue: true,
	FrequencyFilter: true,
	Sub: true,
	FilterByOtherCol: false
};

function timeCol(name, values = TIMES, extra = {}) {
	const c = new Column({ type: 'time', timeFormat: 'YYYY-MM-DD HH:mm', ...extra });
	c.name = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	pushObj(c);
	return c;
}

function numberCol(name, values) {
	const c = new Column({ type: 'number' });
	c.name = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	pushObj(c);
	return c;
}

function freeProcess(name, args = {}) {
	const defaults = appConsts.processMap.get(name).defaults;
	const base = {};
	for (const [k, v] of defaults.entries()) base[k] = structuredClone(v.val);
	const proc = new Process({ name, args: { ...base, inIN: [], ...args } }, null);
	core.orphanProcesses.push(proc);
	return proc;
}

// The same ops the canvas emits when a column is wired into a free process
// (WorkflowEditor.connectColumnToInput), after the rule allows it.
function wire(proc, col) {
	const refusal = processInputRefusal(proc, col.id, proc.args.inIN);
	if (refusal) return refusal;
	M.atomicBatch([
		{
			kind: 'setOrphanProcessArg',
			processId: proc.id,
			key: 'inIN',
			value: [...proc.args.inIN, col.id]
		},
		{
			kind: 'addColumn',
			columnData: {
				type: col.type,
				producerNodeId: `process_${proc.id}`,
				producerPort: `out_${col.id}`,
				producerArtifactKind: 'column'
			}
		}
	]);
	return null;
}

const outputOf = (proc, col) =>
	core.data.find(
		(c) => c.producerNodeId === `process_${proc.id}` && c.producerPort === `out_${col.id}`
	);

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	history.init();
}, 60000);

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
	core.tableProcesses = [];
	core.orphanProcesses = [];
	core.plots = [];
	appState.displayTimezone = 'utc';
	appState.showTimesIn = 'column';
	history.clear();
});

describe('sameType is declared per process', () => {
	it('every registered column process is classified, and matches the table', () => {
		const keys = [...appConsts.processMap.keys()].sort();
		expect(keys).toEqual(Object.keys(EXPECTED_SAME_TYPE).sort());
		for (const [key, entry] of appConsts.processMap.entries()) {
			expect([key, requiresSameTypeInputs(entry)]).toEqual([key, EXPECTED_SAME_TYPE[key]]);
		}
	});

	it('defaults to the safe value (rule applies) when a process does not declare it', () => {
		expect(
			requiresSameTypeInputs({ definition: { nodeSpec: { inputs: [{ name: 'input' }] } } })
		).toBe(true);
		expect(requiresSameTypeInputs({ definition: {} })).toBe(true);
		expect(requiresSameTypeInputs(undefined)).toBe(true);
		expect(requiresSameTypeInputs({ nodeSpec: { inputs: [{ sameType: false }] } })).toBe(false);
	});

	it('keeps Substitute refusing time columns', () => {
		expect(disallowedInputTypes(appConsts.processMap.get('Sub'))).toEqual(['time']);
		expect(disallowedInputTypes(appConsts.processMap.get('FilterByOtherCol'))).toEqual([]);
	});
});

describe('inputTypeRefusal', () => {
	const entryOf = (k) => appConsts.processMap.get(k);

	it('refuses a mix for every process that keeps the rule, naming the type already there', () => {
		for (const [key, same] of Object.entries(EXPECTED_SAME_TYPE)) {
			if (!same) continue;
			// A process that refuses time outright says that instead (next tests); a category
			// beside numbers still meets the mix rule on every one.
			const refusesTime = disallowedInputTypes(entryOf(key)).includes('time');
			const msg = refusesTime
				? inputTypeRefusal(entryOf(key), key, 'category', ['number'])
				: inputTypeRefusal(entryOf(key), key, 'time', ['number']);
			expect(msg, key).toMatch(/inputs must all be the same type \(already number\)/);
		}
	});

	it('Multiply, Normalize, Remove outliers and Frequency filter refuse time like Substitute', () => {
		const refusing = Object.keys(EXPECTED_SAME_TYPE).filter((k) =>
			disallowedInputTypes(entryOf(k)).includes('time')
		);
		expect(refusing.sort()).toEqual(
			['FrequencyFilter', 'Multiply', 'OutlierRemoval', 'Sub', 'normalize'].sort()
		);
		expect(inputTypeRefusal(entryOf('Multiply'), 'Multiply', 'time', [])).toBe(
			"Multiply doesn't support time columns yet."
		);
	});

	it('accepts a mix for Filter, and the same type for everyone', () => {
		expect(inputTypeRefusal(entryOf('FilterByOtherCol'), 'Filter', 'time', ['number'])).toBe(null);
		expect(
			inputTypeRefusal(entryOf('FilterByOtherCol'), 'Filter', 'category', ['time', 'number'])
		).toBe(null);
		expect(inputTypeRefusal(entryOf('Add'), 'Add', 'number', ['number', 'number'])).toBe(null);
		expect(inputTypeRefusal(entryOf('Add'), 'Add', 'time', [])).toBe(null);
	});

	it('checks disallowTypes before the mix, so Substitute names the refused type', () => {
		expect(inputTypeRefusal(entryOf('Sub'), 'Substitute', 'time', ['number'])).toBe(
			"Substitute doesn't support time columns yet."
		);
		expect(inputTypeRefusal(entryOf('Sub'), 'Substitute', 'category', ['number'])).toMatch(
			/same type/
		);
	});
});

describe('wiring a time and a number column into one node', () => {
	it('Add refuses the second, different-type column and wires nothing', () => {
		const t = timeCol('time');
		const n = numberCol('activity', [1, 2, 3, 4]);
		const add = freeProcess('Add', { value: 5 });
		expect(wire(add, n)).toBe(null);
		expect(wire(add, t)).toMatch(/Add inputs must all be the same type \(already number\)/);
		expect(add.args.inIN).toEqual([n.id]);
		expect(outputOf(add, t)).toBeUndefined();
	});

	it('Filter takes both; each output keeps its own type, zone and values', () => {
		const t = timeCol('time', TIMES, { timeZone: NZ });
		const n = numberCol('activity', [10, 20, 30, 40]);
		const light = numberCol('light', [0, 1, 1, 0]);
		const filter = freeProcess('FilterByOtherCol', {
			conditions: [{ byColId: light.id, isOperator: '==', byColValue: 1 }]
		});
		expect(wire(filter, t)).toBe(null);
		expect(wire(filter, n)).toBe(null);
		expect(filter.args.inIN).toEqual([t.id, n.id]);

		const tOut = outputOf(filter, t);
		const nOut = outputOf(filter, n);
		expect(tOut.type).toBe('time');
		expect(nOut.type).toBe('number');
		const tIn = t.getData();
		expect(tOut.getData()).toEqual([null, tIn[1], tIn[2], null]);
		expect(nOut.getData()).toEqual([null, 20, 30, null]);
		// The time output reads in its input's zone.
		expect(timeZoneSource(tOut)?.id).toBe(t.id);
		expect(clockZoneOf(tOut)).toBe(clockZoneOf(t));
	});

	it('a condition on one of the inputs tests THAT column for every output', () => {
		// Regression: a free node exposed only its FIRST input as the "column itself", so the
		// second input's output tested its own values against a condition on the first.
		const n = numberCol('activity', [10, 20, 30, 40]);
		const m = numberCol('temperature', [36, 37, 38, 39]);
		const filter = freeProcess('FilterByOtherCol', {
			conditions: [{ byColId: n.id, isOperator: '>=', byColValue: 25 }],
			parentColId: n.id // what the panel's effect writes for a free node: its first input
		});
		expect(wire(filter, n)).toBe(null);
		expect(wire(filter, m)).toBe(null);
		expect(outputOf(filter, n).getData()).toEqual([null, null, 30, 40]);
		expect(outputOf(filter, m).getData()).toEqual([null, null, 38, 39]);
	});

	it('the same for a mix: a condition on the time input filters the number output', () => {
		const t = timeCol('time', TIMES);
		const n = numberCol('activity', [10, 20, 30, 40]);
		const filter = freeProcess('FilterByOtherCol', { parentColId: t.id });
		expect(wire(filter, t)).toBe(null);
		expect(wire(filter, n)).toBe(null);
		const cut = t.getData()[2];
		filter.args.conditions = [{ byColId: t.id, isOperator: '>=', byColValue: cut }];
		expect(outputOf(filter, n).getData()).toEqual([null, null, 30, 40]);
		expect(outputOf(filter, t).getData()).toEqual([null, null, ...t.getData().slice(2)]);
	});

	it('each wire is one undo step, and redo restores it', () => {
		const t = timeCol('time');
		const n = numberCol('activity', [1, 2, 3, 4]);
		const filter = freeProcess('FilterByOtherCol');
		history.clear();
		wire(filter, t);
		wire(filter, n);
		const outs = () =>
			core.data.filter((c) => c.producerNodeId === `process_${filter.id}`).map((c) => c.type);
		expect(filter.args.inIN).toEqual([t.id, n.id]);
		expect(outs()).toEqual(['time', 'number']);

		history.undo();
		expect(filter.args.inIN).toEqual([t.id]);
		expect(outs()).toEqual(['time']);
		history.undo();
		expect(filter.args.inIN).toEqual([]);
		expect(outs()).toEqual([]);

		history.redo();
		history.redo();
		expect(filter.args.inIN).toEqual([t.id, n.id]);
		expect(outs()).toEqual(['time', 'number']);
	});
});
