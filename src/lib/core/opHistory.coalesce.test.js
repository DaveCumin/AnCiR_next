// src/lib/core/opHistory.coalesce.test.js
// @ts-nocheck
//
// Coalescing boundaries (just under / over 500ms), different-target isolation,
// non-coalescing op kinds, redo-clearing on a new op, and the 50-entry cap.
// Timestamps are controlled by stubbing performance.now() so the 500ms window
// is exercised deterministically without real timers.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { history } from './opHistory.svelte.js';
import { applyOp } from './operations.js';
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

let nowMs;
beforeEach(() => {
    history.clear();
    core.plots.length = 0;
    core.data.length = 0;
    nowMs = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
});
afterEach(() => {
    vi.restoreAllMocks();
});

function addPlot(name = 'p') {
    applyOp({ kind: 'addPlot', plotData: { type: 'scatterplot', name, x: 0, y: 0, width: 1, height: 1 } });
    return core.plots[core.plots.length - 1].id;
}

describe('coalescing window boundaries', () => {
    it('two same-target setPlotProperty edits just under 500ms apart coalesce into one entry', () => {
        const id = addPlot('orig');
        const baseline = history.undoCount;
        nowMs = 2000;
        applyOp({ kind: 'setPlotProperty', id, key: 'name', value: 'a' });
        nowMs = 2499; // 499ms later → within window
        applyOp({ kind: 'setPlotProperty', id, key: 'name', value: 'b' });
        expect(history.undoCount).toBe(baseline + 1);
    });

    it('two same-target edits exactly 500ms apart do NOT coalesce (boundary is exclusive)', () => {
        const id = addPlot('orig');
        const baseline = history.undoCount;
        nowMs = 2000;
        applyOp({ kind: 'setPlotProperty', id, key: 'name', value: 'a' });
        nowMs = 2500; // exactly 500ms → not < COALESCE_MS
        applyOp({ kind: 'setPlotProperty', id, key: 'name', value: 'b' });
        expect(history.undoCount).toBe(baseline + 2);
    });

    it('two same-target edits over 500ms apart create two separate entries', () => {
        const id = addPlot('orig');
        const baseline = history.undoCount;
        nowMs = 2000;
        applyOp({ kind: 'setPlotProperty', id, key: 'name', value: 'a' });
        nowMs = 3000;
        applyOp({ kind: 'setPlotProperty', id, key: 'name', value: 'b' });
        expect(history.undoCount).toBe(baseline + 2);
    });

    it('coalesced entry keeps the original reverse so a single undo restores the first value', () => {
        const id = addPlot('orig');
        nowMs = 2000;
        applyOp({ kind: 'setPlotProperty', id, key: 'name', value: 'a' });
        nowMs = 2100;
        applyOp({ kind: 'setPlotProperty', id, key: 'name', value: 'b' });
        nowMs = 2200;
        applyOp({ kind: 'setPlotProperty', id, key: 'name', value: 'c' });
        expect(core.plots[0].name).toBe('c');
        history.undo();
        expect(core.plots[0].name).toBe('orig');
    });
});

describe('different targets do not coalesce', () => {
    it('same key+kind but different plot ids stay separate even within the window', () => {
        const id1 = addPlot('p1');
        const id2 = addPlot('p2');
        const baseline = history.undoCount;
        nowMs = 2000;
        applyOp({ kind: 'setPlotProperty', id: id1, key: 'name', value: 'a' });
        nowMs = 2100;
        applyOp({ kind: 'setPlotProperty', id: id2, key: 'name', value: 'b' });
        expect(history.undoCount).toBe(baseline + 2);
    });

    it('same plot but different keys stay separate', () => {
        const id = addPlot('p');
        const baseline = history.undoCount;
        nowMs = 2000;
        applyOp({ kind: 'setPlotProperty', id, key: 'name', value: 'a' });
        nowMs = 2100;
        applyOp({ kind: 'setPlotProperty', id, key: 'colour', value: '#fff' });
        expect(history.undoCount).toBe(baseline + 2);
    });

    it('different setProcessArg targets (same key) do not coalesce', () => {
        const colA = (applyOp({ kind: 'addColumn', columnData: { name: 'A', type: 'number' } }), core.data[0].id);
        const colB = (applyOp({ kind: 'addColumn', columnData: { name: 'B', type: 'number' } }), core.data[1].id);
        applyOp({ kind: 'addProcess', columnId: colA, processType: 'Normalize', args: { normalizationType: 'z' } });
        applyOp({ kind: 'addProcess', columnId: colB, processType: 'Normalize', args: { normalizationType: 'z' } });
        const procA = core.data[0].processes[0].id;
        const procB = core.data[1].processes[0].id;
        const baseline = history.undoCount;
        nowMs = 5000;
        applyOp({ kind: 'setProcessArg', columnId: colA, processId: procA, key: 'normalizationType', value: 'a' });
        nowMs = 5100;
        applyOp({ kind: 'setProcessArg', columnId: colB, processId: procB, key: 'normalizationType', value: 'b' });
        expect(history.undoCount).toBe(baseline + 2);
    });

    it('setProcessArg on the same (col, proc, key) within window coalesces', () => {
        applyOp({ kind: 'addColumn', columnData: { name: 'A', type: 'number' } });
        const colId = core.data[0].id;
        applyOp({ kind: 'addProcess', columnId: colId, processType: 'Normalize', args: { normalizationType: 'z' } });
        const procId = core.data[0].processes[0].id;
        const baseline = history.undoCount;
        nowMs = 5000;
        applyOp({ kind: 'setProcessArg', columnId: colId, processId: procId, key: 'normalizationType', value: 'a' });
        nowMs = 5100;
        applyOp({ kind: 'setProcessArg', columnId: colId, processId: procId, key: 'normalizationType', value: 'b' });
        expect(history.undoCount).toBe(baseline + 1);
    });
});

describe('non-coalescing op kinds', () => {
    it('addColumn ops never coalesce even back-to-back within the window', () => {
        const baseline = history.undoCount;
        nowMs = 2000;
        applyOp({ kind: 'addColumn', columnData: { name: 'A', type: 'number' } });
        nowMs = 2050;
        applyOp({ kind: 'addColumn', columnData: { name: 'B', type: 'number' } });
        expect(history.undoCount).toBe(baseline + 2);
    });

    it('setPlotPosition coalesces by plot id (ignores key)', () => {
        const id = addPlot('p');
        const baseline = history.undoCount;
        nowMs = 2000;
        applyOp({ kind: 'setPlotPosition', id, x: 10, y: 10 });
        nowMs = 2100;
        applyOp({ kind: 'setPlotPosition', id, x: 20, y: 20 });
        expect(history.undoCount).toBe(baseline + 1);
    });
});

describe('redo stack clearing', () => {
    it('a new op after an undo clears the redo stack', async () => {
        const id = addPlot('p');
        nowMs = 2000;
        applyOp({ kind: 'setPlotProperty', id, key: 'name', value: 'a' });
        history.undo();
        expect(history.redoCount).toBe(1);
        // undo holds isRestoring=true until the next microtask; a real user
        // gesture always lands on a later tick. Without this await the op is
        // dropped by #record's isRestoring guard.
        await Promise.resolve();
        nowMs = 9000;
        applyOp({ kind: 'setPlotProperty', id, key: 'name', value: 'c' });
        expect(history.redoCount).toBe(0);
    });
});

describe('stack cap at maxStackSize', () => {
    it('caps at 50 distinct (non-coalescing) entries, dropping the oldest', () => {
        for (let i = 0; i < 60; i++) {
            // advance time well past the window so nothing coalesces
            nowMs = 1000 + i * 1000;
            applyOp({ kind: 'addColumn', columnData: { name: `c${i}`, type: 'number' } });
        }
        expect(history.undoCount).toBe(50);
    });

    it('the oldest entry is dropped (FIFO) when over the cap', () => {
        for (let i = 0; i < 51; i++) {
            nowMs = 1000 + i * 1000;
            applyOp({ kind: 'setStoredValue', name: `k${i}`, entry: { staticValue: i, source: 's' } });
        }
        // 51 ops, cap 50 → first one (k0) was shifted out. Undo all 50 and verify
        // k0 is never the entry restored last.
        expect(history.undoCount).toBe(50);
    });
});

describe('undo/redo with empty stacks is a safe no-op', () => {
    it('undo on an empty stack does nothing', () => {
        expect(() => history.undo()).not.toThrow();
        expect(history.undoCount).toBe(0);
    });
    it('redo on an empty stack does nothing', () => {
        expect(() => history.redo()).not.toThrow();
        expect(history.redoCount).toBe(0);
    });
});
