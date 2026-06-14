// src/lib/core/paramDiffWatcher.test.js
// @ts-nocheck
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
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
    history.init();
});

beforeEach(() => {
    history.clear();
    core.data.length = 0;
    paramDiffWatcher.rebaseSnapshot();
});

describe('paramDiffWatcher', () => {
    it('emits a setProcessArg op when a direct args mutation is detected', async () => {
        const col = M.addColumn({ name: 'X', type: 'number' });
        const proc = M.addProcess(col.id, 'Normalize', { normalizationType: 'z-score' });
        paramDiffWatcher.rebaseSnapshot();
        const before = history.undoCount;

        // Direct mutation (bypasses mutationService)
        proc.args.normalizationType = 'min-max';

        await paramDiffWatcher.flush();

        expect(history.undoCount).toBe(before + 1);
        history.undo();
        expect(proc.args.normalizationType).toBe('z-score');
    });

    it('detects multiple changes in a single flush', async () => {
        const col = M.addColumn({ name: 'Y', type: 'number' });
        const proc = M.addProcess(col.id, 'Normalize', { normalizationType: 'z-score' });
        paramDiffWatcher.rebaseSnapshot();
        const before = history.undoCount;
        proc.args.normalizationType = 'min-max';
        proc.args.extra = 'added';
        await paramDiffWatcher.flush();
        // Two key changes: normalizationType + extra → 2 history entries
        expect(history.undoCount).toBe(before + 2);
    });

    it('no-op when nothing changed', async () => {
        const col = M.addColumn({ name: 'Z', type: 'number' });
        M.addProcess(col.id, 'Normalize', { normalizationType: 'z-score' });
        paramDiffWatcher.rebaseSnapshot();
        const before = history.undoCount;
        await paramDiffWatcher.flush();
        expect(history.undoCount).toBe(before);
    });
});
