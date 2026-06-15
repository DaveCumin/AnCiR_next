// src/lib/core/paramDiffWatcher.edge.test.js
// @ts-nocheck
//
// Edge cases for paramDiffWatcher: free-TableProcess arg diffs route through
// setFreeTableProcessArg, brand-new processes are NOT double-recorded, and
// rebaseSnapshot suppresses an already-applied change.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mutationService as M } from './mutationService.js';
import { history } from './opHistory.svelte.js';
import { paramDiffWatcher } from './paramDiffWatcher.svelte.js';
import { core, appConsts } from './core.svelte.js';

beforeAll(() => {
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
    history.init();
});

beforeEach(() => {
    history.clear();
    core.data.length = 0;
    core.tableProcesses.length = 0;
    paramDiffWatcher.rebaseSnapshot();
});
afterEach(() => {
    paramDiffWatcher._disposeForTests();
});

describe('paramDiffWatcher: free TableProcess args', () => {
    it('a direct free-TP arg mutation is recorded via setFreeTableProcessArg and is undoable', async () => {
        const tp = M.addFreeTableProcess('BinnedData', { binSize: 60, out: {} });
        paramDiffWatcher.rebaseSnapshot();
        const before = history.undoCount;

        // Direct write (as a bind:value panel would do)
        tp.args.binSize = 120;
        await paramDiffWatcher.flush();

        expect(history.undoCount).toBe(before + 1);
        history.undo();
        expect(tp.args.binSize).toBe(60);
    });
});

describe('paramDiffWatcher: new processes are not double-recorded', () => {
    it('adding a process then flushing records nothing extra (its args belong to addProcess)', async () => {
        const col = M.addColumn({ name: 'X', type: 'number' });
        const before = history.undoCount;
        M.addProcess(col.id, 'Normalize', { normalizationType: 'z-score' });
        // addProcess itself records one op
        const afterAdd = history.undoCount;
        expect(afterAdd).toBe(before + 1);
        // flushing must NOT emit a setProcessArg diff for the brand-new process
        await paramDiffWatcher.flush();
        expect(history.undoCount).toBe(afterAdd);
    });
});

describe('paramDiffWatcher: rebaseSnapshot', () => {
    it('rebaseSnapshot after a change makes the next flush a no-op', async () => {
        const col = M.addColumn({ name: 'X', type: 'number' });
        const proc = M.addProcess(col.id, 'Normalize', { normalizationType: 'z-score' });
        // mutate directly, then rebase (adopting the new value as the baseline)
        proc.args.normalizationType = 'min-max';
        paramDiffWatcher.rebaseSnapshot();
        const before = history.undoCount;
        await paramDiffWatcher.flush();
        expect(history.undoCount).toBe(before);
    });
});
