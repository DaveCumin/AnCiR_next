// src/lib/core/mutationService.edge.test.js
// @ts-nocheck
//
// Return-value contracts and no-op handling for the typed mutation API.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { mutationService as M } from './mutationService.js';
import { core, appConsts } from './core.svelte.js';

beforeAll(() => {
	if (!appConsts.plotMap.has('scatterplot')) {
		appConsts.plotMap.set('scatterplot', {
			displayName: 'Scatterplot (test stub)',
			data: { fromJSON: (_plot, plotData) => plotData ?? {} }
		});
	}
	if (!appConsts.processMap.has('Normalize')) {
		appConsts.processMap.set('Normalize', {
			displayName: 'Normalize (test stub)',
			defaults: new Map([['normalizationType', { val: 'z-score' }]]),
			func: (data) => data
		});
	}
	if (!appConsts.tableProcessMap.has('BinnedData')) {
		appConsts.tableProcessMap.set('BinnedData', {
			displayName: 'BinnedData (test stub)',
			defaults: new Map([['binSize', { val: 60 }]]),
			func: () => null,
			columnIdFields: { scalar: [], array: [] }
		});
	}
	if (!appConsts.tableProcessMap.has('StubWithOut')) {
		appConsts.tableProcessMap.set('StubWithOut', {
			displayName: 'Stub with a declared output',
			defaults: new Map([
				['k', { val: 1 }],
				['out', { result: { val: -1 } }]
			]),
			func: () => null,
			columnIdFields: { scalar: [], array: [] }
		});
	}
});

beforeEach(() => {
	core.plots.length = 0;
	core.data.length = 0;
	core.tableProcesses.length = 0;
	for (const k of Object.keys(core.storedValues)) delete core.storedValues[k];
});

describe('mutationService return contracts', () => {
	it('addColumn returns the live Column instance held in core.data', () => {
		const col = M.addColumn({ name: 'X', type: 'number' });
		expect(col).toBe(core.data[0]);
	});

	it('addProcess returns the live Process instance', () => {
		const col = M.addColumn({ name: 'X', type: 'number' });
		const proc = M.addProcess(col.id, 'Normalize', { normalizationType: 'z' });
		expect(proc).toBe(core.data[0].processes[0]);
	});

	it('addProcess on a missing column returns null', () => {
		expect(M.addProcess(99999, 'Normalize', {})).toBeNull();
	});

	it('addFreeTableProcess returns the live instance', () => {
		const tp = M.addFreeTableProcess('BinnedData', { binSize: 60, out: {} });
		expect(tp).toBe(core.tableProcesses[0]);
	});

	// An agent or script often passes only the parameters it cares about. A node created
	// without `out` used to throw in the TableProcess constructor (Object.keys of undefined).
	it('addFreeTableProcess without an `out` key creates the node with an empty `out`', () => {
		const tp = M.addFreeTableProcess('BinnedData', { binSize: 30 });
		expect(tp).toBe(core.tableProcesses[0]);
		expect(tp.args.binSize).toBe(30);
		expect(tp.args.out).toEqual({});
		expect(core.data).toHaveLength(0);
	});

	it('addFreeTableProcess without `out` takes the output keys the node declares, with columns', () => {
		const tp = M.addFreeTableProcess('StubWithOut', { k: 2 });
		expect(Object.keys(tp.args.out)).toEqual(['result']);
		const id = tp.args.out.result;
		expect(id).toBeGreaterThanOrEqual(0);
		expect(core.data.map((c) => c.id)).toEqual([id]);
	});

	it('addFreeTableProcess with no args at all, or a non-object `out`, does not throw', () => {
		expect(M.addFreeTableProcess('BinnedData').args.out).toEqual({});
		expect(M.addFreeTableProcess('BinnedData', { out: null }).args.out).toEqual({});
		expect(core.tableProcesses).toHaveLength(2);
	});

	it('removeColumn / removeProcess / removePlot return undefined (void) and do not throw on missing ids', () => {
		expect(M.removeColumn(99999)).toBeUndefined();
		expect(M.removeProcess(99999, 1)).toBeUndefined();
		expect(M.removePlot(99999)).toBeUndefined();
		expect(M.removeFreeTableProcess(99999)).toBeUndefined();
	});
});

describe('mutationService stored values + refs', () => {
	it('renameStoredValue moves the entry', () => {
		M.setStoredValue('a', { staticValue: 1, source: 's' });
		M.renameStoredValue('a', 'b');
		expect(core.storedValues.a).toBeUndefined();
		expect(core.storedValues.b.staticValue).toBe(1);
	});

	it('batch with a no-op member still applies the good ops', () => {
		M.batch([
			{ kind: 'addColumn', columnData: { name: 'A', type: 'number' } },
			{ kind: 'removeColumn', id: 99999 }, // no-op
			{ kind: 'addColumn', columnData: { name: 'B', type: 'number' } }
		]);
		expect(core.data.map((c) => c.name)).toEqual(['A', 'B']);
	});
});
