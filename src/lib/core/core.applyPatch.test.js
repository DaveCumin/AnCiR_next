// src/lib/core/core.applyPatch.test.js
// @ts-nocheck
//
// applyPatchToCore reconciliation + serialize round-trip. Uses the real Column /
// Plot / TableProcess classes (registered as stubs in appConsts) rather than the
// mocked classes core.test.js uses, because the reconcile path calls
// Column.fromJSON / Plot.fromJSON / new TableProcess() for added entities.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as jsonpatch from 'fast-json-patch';
import {
    core,
    appConsts,
    applyPatchToCore,
    getCoreAsPlainObject,
    outputCoreAsJson,
    storeValue,
    getStoredValue
} from './core.svelte.js';
import { Column } from './Column.svelte';
import { Plot } from './Plot.svelte';

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
});

function resetCore() {
    core.rawData.clear();
    core.data.length = 0;
    core.tableProcesses.length = 0;
    core.plots.length = 0;
    for (const k of Object.keys(core.storedValues)) delete core.storedValues[k];
}
beforeEach(resetCore);

/** Snapshot core, mutate the snapshot via `mutate`, diff, and return the patch. */
function patchFor(mutate) {
    const before = getCoreAsPlainObject();
    const after = JSON.parse(JSON.stringify(before));
    mutate(after);
    return jsonpatch.compare(before, after);
}

describe('applyPatchToCore: rawData reconcile', () => {
    it('adds new rawData keys', () => {
        core.rawData.set(1, [1, 2, 3]);
        const patch = patchFor((s) => {
            s.rawData['2'] = [4, 5, 6];
        });
        applyPatchToCore(patch);
        expect(core.rawData.get(2)).toEqual([4, 5, 6]);
        expect(core.rawData.get(1)).toEqual([1, 2, 3]);
    });

    it('removes rawData keys no longer present', () => {
        core.rawData.set(1, [1]);
        core.rawData.set(2, [2]);
        const patch = patchFor((s) => {
            delete s.rawData['2'];
        });
        applyPatchToCore(patch);
        expect(core.rawData.has(2)).toBe(false);
        expect(core.rawData.has(1)).toBe(true);
    });

    it('replaces an existing rawData value', () => {
        core.rawData.set(1, [1, 2, 3]);
        const patch = patchFor((s) => {
            s.rawData['1'] = [9, 9, 9];
        });
        applyPatchToCore(patch);
        expect(core.rawData.get(1)).toEqual([9, 9, 9]);
    });

    it('keys are coerced back to numbers', () => {
        const patch = patchFor((s) => {
            s.rawData['42'] = [1];
        });
        applyPatchToCore(patch);
        expect(core.rawData.has(42)).toBe(true);
        expect(core.rawData.has('42')).toBe(false);
    });
});

describe('applyPatchToCore: data (columns) reconcile by id', () => {
    it('adds an entirely new column', () => {
        const patch = patchFor((s) => {
            s.data.push({ id: 7, name: 'New', type: 'number', processes: [] });
        });
        applyPatchToCore(patch);
        const col = core.data.find((c) => c.id === 7);
        expect(col).toBeTruthy();
        expect(col).toBeInstanceOf(Column);
    });

    it('removes a stale column', () => {
        core.data.push(Column.fromJSON({ id: 3, name: 'Gone', type: 'number', processes: [] }));
        core.data.push(Column.fromJSON({ id: 4, name: 'Stay', type: 'number', processes: [] }));
        const patch = patchFor((s) => {
            s.data = s.data.filter((c) => c.id !== 3);
        });
        applyPatchToCore(patch);
        expect(core.data.map((c) => c.id)).toEqual([4]);
    });

    it('updates a mutable property in place on an existing column (same instance)', () => {
        const col = Column.fromJSON({ id: 5, name: 'Old', type: 'number', processes: [] });
        core.data.push(col);
        const patch = patchFor((s) => {
            s.data[0].name = 'Renamed';
        });
        applyPatchToCore(patch);
        // same instance, customName updated
        expect(core.data[0]).toBe(col);
        expect(core.data[0].name).toBe('Renamed');
    });

    it('adds a new process to an existing column (reconcile processes by id)', () => {
        const col = Column.fromJSON({ id: 6, name: 'C', type: 'number', processes: [] });
        core.data.push(col);
        const patch = patchFor((s) => {
            s.data[0].processes.push({ id: 100, name: 'Normalize', args: { normalizationType: 'z' } });
        });
        applyPatchToCore(patch);
        expect(core.data[0]).toBe(col);
        expect(core.data[0].processes.map((p) => p.id)).toContain(100);
    });

    it('removes a stale process from an existing column', () => {
        const col = Column.fromJSON({
            id: 8,
            name: 'C',
            type: 'number',
            processes: [
                { id: 200, name: 'Normalize', args: { normalizationType: 'a' } },
                { id: 201, name: 'Normalize', args: { normalizationType: 'b' } }
            ]
        });
        core.data.push(col);
        const patch = patchFor((s) => {
            s.data[0].processes = s.data[0].processes.filter((p) => p.id !== 200);
        });
        applyPatchToCore(patch);
        expect(core.data[0].processes.map((p) => p.id)).toEqual([201]);
    });

    it('updates an existing process args in place', () => {
        const col = Column.fromJSON({
            id: 9,
            name: 'C',
            type: 'number',
            processes: [{ id: 300, name: 'Normalize', args: { normalizationType: 'a' } }]
        });
        core.data.push(col);
        const patch = patchFor((s) => {
            s.data[0].processes[0].args.normalizationType = 'b';
        });
        applyPatchToCore(patch);
        expect(core.data[0].processes[0].args.normalizationType).toBe('b');
    });

    it('does not touch core.data when the patch leaves data untouched', () => {
        const col = Column.fromJSON({ id: 11, name: 'C', type: 'number', processes: [] });
        core.data.push(col);
        // a plots-only patch
        const patch = patchFor((s) => {
            s.plots.push({ id: 0, name: 'p', type: 'scatterplot', x: 0, y: 0, width: 1, height: 1, selected: false, plot: {} });
        });
        applyPatchToCore(patch);
        expect(core.data[0]).toBe(col); // same instance, untouched
    });
});

describe('applyPatchToCore: plots reconcile by id', () => {
    it('adds a new plot', () => {
        const patch = patchFor((s) => {
            s.plots.push({ id: 0, name: 'p', type: 'scatterplot', x: 1, y: 2, width: 3, height: 4, selected: false, plot: {} });
        });
        applyPatchToCore(patch);
        const p = core.plots.find((p) => p.id === 0);
        expect(p).toBeTruthy();
        expect(p).toBeInstanceOf(Plot);
        expect(p.x).toBe(1);
    });

    it('updates an existing plot in place (position + name)', () => {
        const plot = Plot.fromJSON({ id: 1, name: 'orig', type: 'scatterplot', x: 0, y: 0, width: 1, height: 1, selected: false, plot: {} });
        core.plots.push(plot);
        const patch = patchFor((s) => {
            s.plots[0].name = 'updated';
            s.plots[0].x = 50;
        });
        applyPatchToCore(patch);
        expect(core.plots[0]).toBe(plot);
        expect(core.plots[0].name).toBe('updated');
        expect(core.plots[0].x).toBe(50);
    });

    it('removes a stale plot', () => {
        core.plots.push(Plot.fromJSON({ id: 1, name: 'a', type: 'scatterplot', x: 0, y: 0, width: 1, height: 1, selected: false, plot: {} }));
        core.plots.push(Plot.fromJSON({ id: 2, name: 'b', type: 'scatterplot', x: 0, y: 0, width: 1, height: 1, selected: false, plot: {} }));
        const patch = patchFor((s) => {
            s.plots = s.plots.filter((p) => p.id !== 1);
        });
        applyPatchToCore(patch);
        expect(core.plots.map((p) => p.id)).toEqual([2]);
    });
});

describe('applyPatchToCore: storedValues reconcile', () => {
    it('replaces storedValues wholesale when touched', () => {
        core.storedValues.old = { staticValue: 1, source: 's' };
        const patch = patchFor((s) => {
            delete s.storedValues.old;
            s.storedValues.fresh = { staticValue: 2, source: 's' };
        });
        applyPatchToCore(patch);
        expect(core.storedValues.old).toBeUndefined();
        expect(core.storedValues.fresh.staticValue).toBe(2);
    });
});

describe('outputCoreAsJson / getCoreAsPlainObject serialization', () => {
    it('serializes rawData Map to a plain object', () => {
        core.rawData.set(1, [1, 2, 3]);
        const out = JSON.parse(outputCoreAsJson());
        expect(out.rawData['1']).toEqual([1, 2, 3]);
    });

    it('resolves live stored-value getters into static snapshots', () => {
        storeValue('tau', () => 24.7, 'computed');
        const out = JSON.parse(outputCoreAsJson());
        expect(out.storedValues.tau.staticValue).toBe(24.7);
        expect(out.storedValues.tau.source).toBe('computed');
        // no function smuggled through
        expect(out.storedValues.tau.getter).toBeUndefined();
    });

    it('includes appState and version', () => {
        const out = JSON.parse(outputCoreAsJson());
        expect(out.version).toBe(appConsts.version);
        expect(out.appState).toBeTruthy();
    });

    it('getCoreAsPlainObject contains no class instances (functions stripped)', () => {
        core.data.push(Column.fromJSON({ id: 1, name: 'C', type: 'number', processes: [] }));
        const snap = getCoreAsPlainObject();
        expect(snap.data[0].constructor).toBe(Object);
        const serialized = JSON.stringify(snap);
        expect(serialized).not.toContain('function');
    });
});

describe('serialize → patch → reconcile round-trip', () => {
    it('a column added in the snapshot is reconstituted as a real Column', () => {
        const before = getCoreAsPlainObject();
        const after = JSON.parse(JSON.stringify(before));
        after.data.push({ id: 99, name: 'RT', type: 'number', processes: [{ id: 1, name: 'Normalize', args: { normalizationType: 'z' } }] });
        const patch = jsonpatch.compare(before, after);
        applyPatchToCore(patch);
        const col = core.data.find((c) => c.id === 99);
        expect(col).toBeInstanceOf(Column);
        expect(col.processes[0].name).toBe('Normalize');
    });

    it('reconcile keeps existing instances stable while applying changes', () => {
        const col = Column.fromJSON({ id: 50, name: 'A', type: 'number', processes: [] });
        const plot = Plot.fromJSON({ id: 60, name: 'P', type: 'scatterplot', x: 0, y: 0, width: 1, height: 1, selected: false, plot: {} });
        core.data.push(col);
        core.plots.push(plot);
        const patch = patchFor((s) => {
            s.data[0].name = 'A2';
            s.plots[0].x = 123;
        });
        applyPatchToCore(patch);
        expect(core.data[0]).toBe(col);
        expect(core.plots[0]).toBe(plot);
        expect(core.data[0].name).toBe('A2');
        expect(core.plots[0].x).toBe(123);
    });
});
