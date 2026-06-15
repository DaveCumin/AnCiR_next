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
