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
    // A node writing its own derived state is not a user edit. Recording it puts entries on the
    // undo stack that reverse nothing visible — press Ctrl+Z, watch `valid: true` be restored,
    // see nothing happen, press it again. Observed after loading any session, and after the AI
    // adds a node (Cosinor writes `valid` and `_fitHash` once it computes).
    it('does not record a node\'s own bookkeeping args as undo steps', async () => {
        const col = M.addColumn({ name: 'X', type: 'number' });
        const proc = M.addProcess(col.id, 'Normalize', { normalizationType: 'z-score' });
        paramDiffWatcher.rebaseSnapshot();
        const before = history.undoCount;

        proc.args.valid = true; // compute bookkeeping
        proc.args._fitHash = 'abc123'; // internal cache
        await paramDiffWatcher.flush();

        expect(history.undoCount).toBe(before);
        // The writes still land — they're just not steps in the user's history.
        expect(proc.args.valid).toBe(true);
        expect(proc.args._fitHash).toBe('abc123');
    });

    it('still records a real edit made alongside bookkeeping', async () => {
        const col = M.addColumn({ name: 'X', type: 'number' });
        const proc = M.addProcess(col.id, 'Normalize', { normalizationType: 'z-score' });
        paramDiffWatcher.rebaseSnapshot();
        const before = history.undoCount;

        proc.args.valid = true;
        proc.args.normalizationType = 'min-max';
        await paramDiffWatcher.flush();

        expect(history.undoCount).toBe(before + 1);
        history.undo();
        expect(proc.args.normalizationType).toBe('z-score');
    });

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

    it('live $effect wiring picks up direct arg mutations without a manual flush', async () => {
        const col = M.addColumn({ name: 'L', type: 'number' });
        const proc = M.addProcess(col.id, 'Normalize', { normalizationType: 'z-score' });

        paramDiffWatcher.init();
        try {
            const before = history.undoCount;

            proc.args.normalizationType = 'min-max';

            // The live effect runs on the microtask queue; wait one tick.
            await Promise.resolve();
            await Promise.resolve();

            expect(history.undoCount).toBe(before + 1);
            history.undo();
            expect(proc.args.normalizationType).toBe('z-score');
        } finally {
            paramDiffWatcher._disposeForTests();
        }
    });

    it('undo does not re-record itself as a fresh op (no undo loop)', async () => {
        const col = M.addColumn({ name: 'U', type: 'number' });
        const proc = M.addProcess(col.id, 'Normalize', { normalizationType: 'z-score' });

        paramDiffWatcher.init();
        try {
            const baseline = history.undoCount;

            // Direct mutation → live effect records one op.
            proc.args.normalizationType = 'min-max';
            await Promise.resolve();
            await Promise.resolve();
            expect(history.undoCount).toBe(baseline + 1);

            // Undo: should restore the value AND drop the stack back to baseline.
            // The watcher's reactive run after the restore must NOT re-record
            // the reverse mutation as a brand-new setProcessArg op.
            history.undo();
            await Promise.resolve();
            await Promise.resolve();

            expect(proc.args.normalizationType).toBe('z-score');
            expect(history.undoCount).toBe(baseline);
            expect(history.redoCount).toBe(1);

            // Redo should round-trip: redoStack stays consistent, undoCount goes
            // back up by one, value is restored to 'min-max'. Same anti-loop
            // requirement applies on the redo path.
            history.redo();
            await Promise.resolve();
            await Promise.resolve();

            expect(proc.args.normalizationType).toBe('min-max');
            expect(history.undoCount).toBe(baseline + 1);
            expect(history.redoCount).toBe(0);
        } finally {
            paramDiffWatcher._disposeForTests();
        }
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
