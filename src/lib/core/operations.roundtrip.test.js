// src/lib/core/operations.roundtrip.test.js
// @ts-nocheck
//
// Undo/redo round-trip invariants plus edge cases for the op engine.
// For every op kind: applying the forward op then its returned inverse must
// restore the prior observable state. Also covers no-op / nonexistent-target
// branches, double-remove, batch with a failing sub-op, and listener plumbing.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
    applyOp,
    applyOps,
    addOpListener,
    addStateChangeHook,
    withSuppressedListeners
} from './operations.js';
import { appConsts, core } from './core.svelte.js';

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

function resetCore() {
    core.plots.length = 0;
    core.data.length = 0;
    core.tableProcesses.length = 0;
    for (const k of Object.keys(core.storedValues)) delete core.storedValues[k];
}

beforeEach(resetCore);

/** Run forward op, then apply the inverse it returns. Returns the inverse. */
function roundTrip(forward) {
    const inv = applyOp(forward);
    expect(inv).toBeTruthy();
    applyOp(inv);
    return inv;
}

describe('round-trip: apply op then its inverse restores prior state', () => {
    it('addPlot → removePlot leaves no plots', () => {
        roundTrip({ kind: 'addPlot', plotData: { type: 'scatterplot', x: 1, y: 2, width: 3, height: 4 } });
        expect(core.plots).toHaveLength(0);
    });

    it('removePlot → addPlot restores the plot with the same id and props', () => {
        applyOp({ kind: 'addPlot', plotData: { type: 'scatterplot', name: 'p', x: 5, y: 6, width: 7, height: 8 } });
        const before = { ...core.plots[0] };
        roundTrip({ kind: 'removePlot', id: core.plots[0].id });
        expect(core.plots).toHaveLength(1);
        expect(core.plots[0].id).toBe(before.id);
        expect(core.plots[0].name).toBe('p');
        expect(core.plots[0].x).toBe(5);
    });

    it('setPlotProperty round-trips back to the original value', () => {
        applyOp({ kind: 'addPlot', plotData: { type: 'scatterplot', name: 'orig', x: 0, y: 0, width: 1, height: 1 } });
        const id = core.plots[0].id;
        roundTrip({ kind: 'setPlotProperty', id, key: 'name', value: 'changed' });
        expect(core.plots[0].name).toBe('orig');
    });

    it('setPlotPosition round-trips x/y/width/height', () => {
        applyOp({ kind: 'addPlot', plotData: { type: 'scatterplot', x: 10, y: 11, width: 12, height: 13 } });
        const id = core.plots[0].id;
        roundTrip({ kind: 'setPlotPosition', id, x: 99, y: 98, width: 97, height: 96 });
        expect(core.plots[0].x).toBe(10);
        expect(core.plots[0].y).toBe(11);
        expect(core.plots[0].width).toBe(12);
        expect(core.plots[0].height).toBe(13);
    });

    it('addColumn → removeColumn leaves no columns', () => {
        roundTrip({ kind: 'addColumn', columnData: { name: 'C', type: 'number' } });
        expect(core.data).toHaveLength(0);
    });

    it('removeColumn → addColumn restores the column with the same id', () => {
        applyOp({ kind: 'addColumn', columnData: { name: 'C', type: 'number' } });
        const id = core.data[0].id;
        roundTrip({ kind: 'removeColumn', id });
        expect(core.data).toHaveLength(1);
        expect(core.data[0].id).toBe(id);
    });

    it('addProcess → removeProcess leaves the column with no processes', () => {
        applyOp({ kind: 'addColumn', columnData: { name: 'C', type: 'number' } });
        const colId = core.data[0].id;
        roundTrip({ kind: 'addProcess', columnId: colId, processType: 'Normalize', args: { normalizationType: 'z-score' } });
        expect(core.data[0].processes).toHaveLength(0);
    });

    it('removeProcess → addProcess restores the process at the same index with same id and args', () => {
        applyOp({ kind: 'addColumn', columnData: { name: 'C', type: 'number' } });
        const colId = core.data[0].id;
        applyOp({ kind: 'addProcess', columnId: colId, processType: 'Normalize', args: { normalizationType: 'a' } });
        applyOp({ kind: 'addProcess', columnId: colId, processType: 'Normalize', args: { normalizationType: 'b' } });
        const targetId = core.data[0].processes[0].id; // remove the first
        roundTrip({ kind: 'removeProcess', columnId: colId, processId: targetId });
        const procs = core.data[0].processes;
        expect(procs).toHaveLength(2);
        // restored at original index 0
        expect(procs[0].id).toBe(targetId);
        expect(procs[0].args.normalizationType).toBe('a');
    });

    it('setProcessArg round-trips back to the original arg value', () => {
        applyOp({ kind: 'addColumn', columnData: { name: 'C', type: 'number' } });
        const colId = core.data[0].id;
        applyOp({ kind: 'addProcess', columnId: colId, processType: 'Normalize', args: { normalizationType: 'z-score' } });
        const procId = core.data[0].processes[0].id;
        roundTrip({ kind: 'setProcessArg', columnId: colId, processId: procId, key: 'normalizationType', value: 'min-max' });
        expect(core.data[0].processes[0].args.normalizationType).toBe('z-score');
    });

    it('addFreeTableProcess → removeFreeTableProcess leaves none', () => {
        roundTrip({ kind: 'addFreeTableProcess', tpType: 'BinnedData', args: { binSize: 60, out: {} } });
        expect(core.tableProcesses).toHaveLength(0);
    });

    it('removeFreeTableProcess → addFreeTableProcess restores with same id and args', () => {
        applyOp({ kind: 'addFreeTableProcess', tpType: 'BinnedData', args: { binSize: 42, out: {} } });
        const id = core.tableProcesses[0].id;
        roundTrip({ kind: 'removeFreeTableProcess', tpId: id });
        expect(core.tableProcesses).toHaveLength(1);
        expect(core.tableProcesses[0].id).toBe(id);
        expect(core.tableProcesses[0].args.binSize).toBe(42);
    });

    it('setFreeTableProcessArg round-trips back to the original value', () => {
        applyOp({ kind: 'addFreeTableProcess', tpType: 'BinnedData', args: { binSize: 60, out: {} } });
        const tpId = core.tableProcesses[0].id;
        roundTrip({ kind: 'setFreeTableProcessArg', tpId, key: 'binSize', value: 120 });
        expect(core.tableProcesses[0].args.binSize).toBe(60);
    });

    it('setStoredValue (new) → removeStoredValue leaves it absent', () => {
        roundTrip({ kind: 'setStoredValue', name: 'tau', entry: { staticValue: 24, source: 's' } });
        expect(core.storedValues.tau).toBeUndefined();
    });

    it('setStoredValue (overwrite) round-trips to the prior entry', () => {
        applyOp({ kind: 'setStoredValue', name: 'tau', entry: { staticValue: 1, source: 'a' } });
        roundTrip({ kind: 'setStoredValue', name: 'tau', entry: { staticValue: 2, source: 'b' } });
        expect(core.storedValues.tau.staticValue).toBe(1);
        expect(core.storedValues.tau.source).toBe('a');
    });

    it('removeStoredValue → setStoredValue restores the entry', () => {
        applyOp({ kind: 'setStoredValue', name: 'tau', entry: { staticValue: 7, source: 's' } });
        roundTrip({ kind: 'removeStoredValue', name: 'tau' });
        expect(core.storedValues.tau.staticValue).toBe(7);
    });

    it('renameStoredValue round-trips the name back', () => {
        applyOp({ kind: 'setStoredValue', name: 'old', entry: { staticValue: 1, source: 's' } });
        roundTrip({ kind: 'renameStoredValue', oldName: 'old', newName: 'new' });
        expect(core.storedValues.old.staticValue).toBe(1);
        expect(core.storedValues.new).toBeUndefined();
    });

    it('replaceColumnRefs round-trips the ref topology', () => {
        // Seed plain-object columns directly (real Column with a refId triggers
        // ref-resolution derivations that need a fuller fixture). The op only
        // reads/writes col.refId, so plain objects exercise the same path.
        core.data.push({ id: 1, refId: 10 });
        // forward: rewrite refs pointing at 10 → 999; inverse rewrites 999 → 10
        roundTrip({ kind: 'replaceColumnRefs', newColId: 999, oldColId: 10 });
        expect(core.data[0].refId).toBe(10);
    });

    it('swapColumnRefs round-trips (swap then swap again is identity)', () => {
        core.data.push({ id: 1, refId: 10 });
        core.data.push({ id: 2, refId: 20 });
        roundTrip({ kind: 'swapColumnRefs', idA: 10, idB: 20 });
        expect(core.data[0].refId).toBe(10);
        expect(core.data[1].refId).toBe(20);
    });

    it('batch round-trips: forward applies all, inverse undoes all in reverse', () => {
        const inv = applyOp({
            kind: 'batch',
            ops: [
                { kind: 'addColumn', columnData: { name: 'A', type: 'number' } },
                { kind: 'setStoredValue', name: 'k', entry: { staticValue: 1, source: 's' } }
            ]
        });
        expect(core.data).toHaveLength(1);
        expect(core.storedValues.k.staticValue).toBe(1);
        applyOp(inv);
        expect(core.data).toHaveLength(0);
        expect(core.storedValues.k).toBeUndefined();
    });

    // A batch must record what its children ACTUALLY did, not what they were asked to do.
    // The single-op path already does: op_addFreeTableProcess canonicalises the id it minted, so
    // redo restores the same node. A batch that replays the caller's original children instead
    // mints a SECOND node (and, for a real TP, a second set of output columns) on every redo —
    // undo/redo stops being a round trip and starts duplicating the session. Latent until a
    // batch carried an entity-creating op.
    it('batch redo restores the same entities rather than creating new ones', () => {
        // Capture the forward op the way HistoryManager does — redo replays the canonical op
        // the engine reports, not the object the caller happened to pass in.
        let recorded = null;
        const off = addOpListener((forward) => (recorded = forward));
        const inv = applyOp({
            kind: 'batch',
            ops: [{ kind: 'addColumn', columnData: { name: 'A', type: 'number' } }]
        });
        off();
        const originalId = core.data[0].id;

        applyOp(inv); // undo
        expect(core.data).toHaveLength(0);

        applyOp(recorded); // redo
        expect(core.data).toHaveLength(1);
        expect(core.data[0].id).toBe(originalId);
    });

    // A table process mints its own output columns, so they belong to it. Removing the node and
    // leaving them behind (what undoing an add used to do) strands one canvas node per output —
    // for a Cosinor, ten — that nothing produces and nothing reads.
    it('removing a free table process takes its output columns with it, reversibly', () => {
        applyOp({ kind: 'addColumn', columnData: { name: 'binnedx_1', type: 'number' } });
        const outCol = core.data[core.data.length - 1];
        // Stand in for the column the constructor mints (the registry stub doesn't compute).
        applyOp({
            kind: 'addFreeTableProcess',
            tpType: 'BinnedData',
            args: { binSize: 60, out: { binnedx: outCol.id } }
        });
        const tp = core.tableProcesses[0];
        const colsBefore = core.data.length;

        const inv = applyOp({ kind: 'removeFreeTableProcess', tpId: tp.id });
        expect(core.tableProcesses).toHaveLength(0);
        expect(core.data.find((c) => c.id === outCol.id)).toBeUndefined();

        applyOp(inv); // undo
        expect(core.tableProcesses).toHaveLength(1);
        expect(core.data).toHaveLength(colsBefore);
        // Same column id, so the node's `out` wiring still points at real data.
        expect(core.data.find((c) => c.id === outCol.id)).toBeTruthy();
        expect(core.tableProcesses[0].args.out.binnedx).toBe(outCol.id);
    });

    // The full cycle a user drives with Ctrl+Z / Ctrl+Shift+Z. Redo must restore the SAME output
    // column ids the node minted, because plots wire to those ids by number — redo that mints a
    // fresh set leaves every plot pointing at columns that no longer exist.
    it('add → undo → redo restores a table process with its original output column ids', () => {
        let recorded = null;
        const off = addOpListener((forward) => (recorded = forward));
        const inv = applyOp({
            kind: 'addFreeTableProcess',
            tpType: 'BinnedData',
            args: { binSize: 60, out: { binnedx: -1 } }
        });
        off();
        const tpId = core.tableProcesses[0].id;
        const outId = core.tableProcesses[0].args.out.binnedx;
        expect(outId).toBeGreaterThanOrEqual(0); // the constructor minted it
        expect(core.data.find((c) => c.id === outId)).toBeTruthy();

        applyOp(inv); // undo: node and its column both go
        expect(core.tableProcesses).toHaveLength(0);
        expect(core.data.find((c) => c.id === outId)).toBeUndefined();

        applyOp(recorded); // redo
        expect(core.tableProcesses).toHaveLength(1);
        expect(core.tableProcesses[0].id).toBe(tpId);
        expect(core.tableProcesses[0].args.out.binnedx).toBe(outId);
        expect(core.data.find((c) => c.id === outId)).toBeTruthy();
        // Exactly one set of outputs — not a second one alongside the first.
        expect(core.data.filter((c) => c.id === outId)).toHaveLength(1);
    });

    it('a batch reports the canonical form of each child it applied', () => {
        const inv = applyOp({
            kind: 'batch',
            ops: [{ kind: 'addColumn', columnData: { name: 'A', type: 'number' } }]
        });
        // The inverse names the concrete id it created — the forward must be equally concrete,
        // or redo can't target it.
        expect(inv.ops[0]).toMatchObject({ kind: 'removeColumn', id: core.data[0].id });
    });
});

describe('no-op / nonexistent-target branches return null', () => {
    it('removePlot on a missing id returns null and does not throw', () => {
        expect(applyOp({ kind: 'removePlot', id: 123456 })).toBeNull();
    });

    it('setPlotProperty on a missing plot returns null', () => {
        expect(applyOp({ kind: 'setPlotProperty', id: 999, key: 'name', value: 'x' })).toBeNull();
    });

    it('setPlotProperty with unchanged value returns null', () => {
        applyOp({ kind: 'addPlot', plotData: { type: 'scatterplot', name: 'same', x: 0, y: 0, width: 1, height: 1 } });
        const id = core.plots[0].id;
        expect(applyOp({ kind: 'setPlotProperty', id, key: 'name', value: 'same' })).toBeNull();
    });

    it('setPlotPosition on a missing plot returns null', () => {
        expect(applyOp({ kind: 'setPlotPosition', id: 999, x: 1 })).toBeNull();
    });

    it('removeColumn on a missing id returns null', () => {
        expect(applyOp({ kind: 'removeColumn', id: 999 })).toBeNull();
    });

    it('addProcess on a missing column returns null', () => {
        expect(applyOp({ kind: 'addProcess', columnId: 999, processType: 'Normalize' })).toBeNull();
    });

    it('removeProcess on a missing column returns null', () => {
        expect(applyOp({ kind: 'removeProcess', columnId: 999, processId: 1 })).toBeNull();
    });

    it('removeProcess on a missing process (existing column) returns null', () => {
        applyOp({ kind: 'addColumn', columnData: { name: 'C', type: 'number' } });
        const colId = core.data[0].id;
        expect(applyOp({ kind: 'removeProcess', columnId: colId, processId: 99999 })).toBeNull();
    });

    it('setProcessArg on a missing column returns null', () => {
        expect(applyOp({ kind: 'setProcessArg', columnId: 999, processId: 1, key: 'k', value: 1 })).toBeNull();
    });

    it('setProcessArg on a missing process returns null', () => {
        applyOp({ kind: 'addColumn', columnData: { name: 'C', type: 'number' } });
        const colId = core.data[0].id;
        expect(applyOp({ kind: 'setProcessArg', columnId: colId, processId: 99999, key: 'k', value: 1 })).toBeNull();
    });

    it('setProcessArg with unchanged value returns null', () => {
        applyOp({ kind: 'addColumn', columnData: { name: 'C', type: 'number' } });
        const colId = core.data[0].id;
        applyOp({ kind: 'addProcess', columnId: colId, processType: 'Normalize', args: { normalizationType: 'z' } });
        const procId = core.data[0].processes[0].id;
        expect(applyOp({ kind: 'setProcessArg', columnId: colId, processId: procId, key: 'normalizationType', value: 'z' })).toBeNull();
    });

    it('removeFreeTableProcess on a missing id returns null', () => {
        expect(applyOp({ kind: 'removeFreeTableProcess', tpId: 999 })).toBeNull();
    });

    it('setFreeTableProcessArg on a missing tp returns null', () => {
        expect(applyOp({ kind: 'setFreeTableProcessArg', tpId: 999, key: 'k', value: 1 })).toBeNull();
    });

    it('setFreeTableProcessArg with unchanged value returns null', () => {
        applyOp({ kind: 'addFreeTableProcess', tpType: 'BinnedData', args: { binSize: 60, out: {} } });
        const tpId = core.tableProcesses[0].id;
        expect(applyOp({ kind: 'setFreeTableProcessArg', tpId, key: 'binSize', value: 60 })).toBeNull();
    });

    it('removeStoredValue on a missing name returns null', () => {
        expect(applyOp({ kind: 'removeStoredValue', name: 'nope' })).toBeNull();
    });

    it('renameStoredValue on a missing source name returns null', () => {
        expect(applyOp({ kind: 'renameStoredValue', oldName: 'nope', newName: 'x' })).toBeNull();
    });

    it('renameStoredValue onto an existing target name returns null (no clobber)', () => {
        applyOp({ kind: 'setStoredValue', name: 'a', entry: { staticValue: 1, source: 's' } });
        applyOp({ kind: 'setStoredValue', name: 'b', entry: { staticValue: 2, source: 's' } });
        expect(applyOp({ kind: 'renameStoredValue', oldName: 'a', newName: 'b' })).toBeNull();
        // both still intact
        expect(core.storedValues.a.staticValue).toBe(1);
        expect(core.storedValues.b.staticValue).toBe(2);
    });
});

describe('double-remove and idempotency', () => {
    it('removing a column twice: second remove is a null no-op', () => {
        applyOp({ kind: 'addColumn', columnData: { name: 'C', type: 'number' } });
        const id = core.data[0].id;
        expect(applyOp({ kind: 'removeColumn', id })).toBeTruthy();
        expect(applyOp({ kind: 'removeColumn', id })).toBeNull();
    });

    it('removing a plot twice: second remove is a null no-op', () => {
        applyOp({ kind: 'addPlot', plotData: { type: 'scatterplot', x: 0, y: 0, width: 1, height: 1 } });
        const id = core.plots[0].id;
        expect(applyOp({ kind: 'removePlot', id })).toBeTruthy();
        expect(applyOp({ kind: 'removePlot', id })).toBeNull();
    });
});

describe('addProcess index insertion', () => {
    it('inserts at the given index when valid', () => {
        applyOp({ kind: 'addColumn', columnData: { name: 'C', type: 'number' } });
        const colId = core.data[0].id;
        applyOp({ kind: 'addProcess', columnId: colId, processType: 'Normalize', args: { normalizationType: 'a' } });
        applyOp({ kind: 'addProcess', columnId: colId, processType: 'Normalize', args: { normalizationType: 'b' } });
        // insert at index 1
        applyOp({ kind: 'addProcess', columnId: colId, processType: 'Normalize', args: { normalizationType: 'mid' }, index: 1 });
        const procs = core.data[0].processes;
        expect(procs).toHaveLength(3);
        expect(procs[1].args.normalizationType).toBe('mid');
    });

    it('appends when index is out of range (>= length)', () => {
        applyOp({ kind: 'addColumn', columnData: { name: 'C', type: 'number' } });
        const colId = core.data[0].id;
        applyOp({ kind: 'addProcess', columnId: colId, processType: 'Normalize', args: { normalizationType: 'a' } });
        applyOp({ kind: 'addProcess', columnId: colId, processType: 'Normalize', args: { normalizationType: 'tail' }, index: 99 });
        const procs = core.data[0].processes;
        expect(procs[procs.length - 1].args.normalizationType).toBe('tail');
    });
});

describe('batch with a no-op sub-op', () => {
    it('a failing/no-op child is skipped; the batch inverse only undoes the successful children', () => {
        const inv = applyOp({
            kind: 'batch',
            ops: [
                { kind: 'addColumn', columnData: { name: 'A', type: 'number' } },
                { kind: 'removeColumn', id: 99999 }, // no-op (missing)
                { kind: 'setStoredValue', name: 'k', entry: { staticValue: 5, source: 's' } }
            ]
        });
        // only two effective ops, so inverse has two entries
        expect(inv.kind).toBe('batch');
        expect(inv.ops).toHaveLength(2);
        expect(core.data).toHaveLength(1);
        expect(core.storedValues.k.staticValue).toBe(5);
        applyOp(inv);
        expect(core.data).toHaveLength(0);
        expect(core.storedValues.k).toBeUndefined();
    });

    it('empty batch returns a batch inverse with no ops and changes nothing', () => {
        const inv = applyOp({ kind: 'batch', ops: [] });
        expect(inv.kind).toBe('batch');
        expect(inv.ops).toHaveLength(0);
        expect(core.data).toHaveLength(0);
    });
});

describe('applyOps array helper', () => {
    it('returns inverses in reverse order so applying them undoes the sequence', () => {
        const inverses = applyOps([
            { kind: 'setStoredValue', name: 'a', entry: { staticValue: 1, source: 's' } },
            { kind: 'setStoredValue', name: 'b', entry: { staticValue: 2, source: 's' } }
        ]);
        expect(inverses).toHaveLength(2);
        // applying the reversed inverses undoes both
        for (const inv of inverses) applyOp(inv);
        expect(core.storedValues.a).toBeUndefined();
        expect(core.storedValues.b).toBeUndefined();
    });

    it('skips null inverses for no-op members', () => {
        const inverses = applyOps([
            { kind: 'removeColumn', id: 99999 }, // no-op
            { kind: 'setStoredValue', name: 'a', entry: { staticValue: 1, source: 's' } }
        ]);
        expect(inverses).toHaveLength(1);
    });
});

describe('unknown op kind', () => {
    it('throws for an unrecognised op kind', () => {
        expect(() => applyOp({ kind: 'totallyBogus' })).toThrow(/unknown kind/);
    });
});

describe('listener and state-change-hook plumbing', () => {
    it('emit fires opListeners with (forward, reverse) only for non-no-op ops', () => {
        const seen = [];
        const off = addOpListener((f, r) => seen.push([f, r]));
        applyOp({ kind: 'setStoredValue', name: 'x', entry: { staticValue: 1, source: 's' } });
        applyOp({ kind: 'removeStoredValue', name: 'missing' }); // no-op: no emit
        off();
        expect(seen).toHaveLength(1);
        expect(seen[0][0].kind).toBe('setStoredValue');
        expect(seen[0][1].kind).toBe('removeStoredValue');
    });

    it('withSuppressedListeners blocks opListeners but still fires stateChangeHooks', () => {
        const listened = [];
        const hooked = [];
        const offL = addOpListener(() => listened.push(1));
        const offH = addStateChangeHook(() => hooked.push(1));
        withSuppressedListeners(() => {
            applyOp({ kind: 'setStoredValue', name: 'y', entry: { staticValue: 1, source: 's' } });
        });
        offL();
        offH();
        expect(listened).toHaveLength(0);
        expect(hooked).toHaveLength(1);
    });

    it('nested withSuppressedListeners stays suppressed until the outer scope exits', () => {
        const listened = [];
        const off = addOpListener(() => listened.push(1));
        withSuppressedListeners(() => {
            withSuppressedListeners(() => {
                applyOp({ kind: 'setStoredValue', name: 'n1', entry: { staticValue: 1, source: 's' } });
            });
            // still inside the outer suppression
            applyOp({ kind: 'setStoredValue', name: 'n2', entry: { staticValue: 2, source: 's' } });
        });
        // back outside: this one emits
        applyOp({ kind: 'setStoredValue', name: 'n3', entry: { staticValue: 3, source: 's' } });
        off();
        expect(listened).toHaveLength(1);
    });

    it('addOpListener unsubscribe stops further notifications', () => {
        const seen = [];
        const off = addOpListener(() => seen.push(1));
        applyOp({ kind: 'setStoredValue', name: 'a', entry: { staticValue: 1, source: 's' } });
        off();
        applyOp({ kind: 'setStoredValue', name: 'b', entry: { staticValue: 2, source: 's' } });
        expect(seen).toHaveLength(1);
    });
});
