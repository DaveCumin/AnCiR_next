// src/lib/core/opHistory.test.js
// @ts-nocheck
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { history } from './opHistory.svelte.js';
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
    history.init();
});

beforeEach(() => {
    history.clear();
    core.plots.length = 0;
    core.data.length = 0;
});

describe('opHistory', () => {
    it('records an op and supports undo/redo', () => {
        const plot = M.addPlot({ type: 'scatterplot', name: 'orig', x: 0, y: 0, width: 1, height: 1 });
        expect(history.canUndo).toBe(true);
        history.undo();
        expect(core.plots).toHaveLength(0);
        expect(history.canRedo).toBe(true);
        history.redo();
        expect(core.plots).toHaveLength(1);
    });

    it('coalesces consecutive setProcessArg ops on the same (col, proc, key)', () => {
        const col = M.addColumn({ name: 'X', type: 'number' });
        const proc = M.addProcess(col.id, 'Normalize', { normalizationType: 'z-score' });
        M.setProcessArg(col.id, proc.id, 'normalizationType', 'min-max');
        M.setProcessArg(col.id, proc.id, 'normalizationType', 'robust');
        M.setProcessArg(col.id, proc.id, 'normalizationType', 'unit-vector');
        // Pre-coalesce: 5 entries (addCol + addProc + 3 setArg). Coalesced: 3.
        expect(history.undoCount).toBe(3);
        history.undo(); // undoes the coalesced setArg back to 'z-score'
        expect(proc.args.normalizationType).toBe('z-score');
    });

    it('does not record while restoring (no echo on undo/redo)', () => {
        M.addPlot({ type: 'scatterplot', x: 0, y: 0, width: 1, height: 1 });
        const stackBefore = history.undoCount;
        history.undo();
        expect(history.undoCount).toBe(stackBefore - 1);
    });

    it('caps stack at maxStackSize (50)', () => {
        for (let i = 0; i < 60; i++) {
            M.addPlot({ type: 'scatterplot', x: 0, y: 0, width: 1, height: 1 });
        }
        expect(history.undoCount).toBe(50);
    });
});
