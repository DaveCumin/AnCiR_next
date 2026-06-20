// src/lib/core/operations.js
// @ts-nocheck

import { core, replaceColumnRefs, swapColumnRefs } from './core.svelte.js';
import { Plot } from './Plot.svelte';
import { Column } from './Column.svelte';
import { Process } from './Process.svelte';
import { TableProcess } from './TableProcess.svelte';

/**
 * @typedef {Object} OpAddFreeTableProcess
 * @property {'addFreeTableProcess'} kind
 * @property {string} tpType
 * @property {string} [tpId]
 * @property {Object} [args]
 *
 * @typedef {Object} OpRemoveFreeTableProcess
 * @property {'removeFreeTableProcess'} kind
 * @property {string} tpId
 *
 * @typedef {Object} OpSetFreeTableProcessArg
 * @property {'setFreeTableProcessArg'} kind
 * @property {string} tpId
 * @property {string} key
 * @property {unknown} value
 *
 * @typedef {Object} OpAddColumn
 * @property {'addColumn'} kind
 * @property {string} [id]              optional pre-assigned id for replay
 * @property {Object} columnData        plain-object snapshot used by Column.fromJSON
 * @property {string} [tableId]         optional table to add to
 *
 * @typedef {Object} OpRemoveColumn
 * @property {'removeColumn'} kind
 * @property {string} id
 *
 * @typedef {Object} OpAddProcess
 * @property {'addProcess'} kind
 * @property {string} columnId
 * @property {string} processType
 * @property {string} [processId]
 * @property {Object} [args]
 * @property {number} [index]
 *
 * @typedef {Object} OpRemoveProcess
 * @property {'removeProcess'} kind
 * @property {string} columnId
 * @property {string} processId
 *
 * @typedef {Object} OpSetProcessArg
 * @property {'setProcessArg'} kind
 * @property {string} columnId
 * @property {string} processId
 * @property {string} key
 * @property {unknown} value
 *
 * @typedef {Object} OpAddPlot
 * @property {'addPlot'} kind
 * @property {Object} plotData
 *
 * @typedef {Object} OpRemovePlot
 * @property {'removePlot'} kind
 * @property {string} id
 *
 * @typedef {Object} OpSetPlotProperty
 * @property {'setPlotProperty'} kind
 * @property {string} id
 * @property {string} key
 * @property {unknown} value
 *
 * @typedef {Object} OpSetPlotPosition
 * @property {'setPlotPosition'} kind
 * @property {string} id
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [width]
 * @property {number} [height]
 *
 * @typedef {Object} OpSetOrphanProcessArg
 * @property {'setOrphanProcessArg'} kind
 * @property {string} processId
 * @property {string} key
 * @property {unknown} value
 *
 * @typedef {Object} OpSetStoredValue
 * @property {'setStoredValue'} kind
 * @property {string} name
 * @property {Object} entry
 *
 * @typedef {Object} OpRemoveStoredValue
 * @property {'removeStoredValue'} kind
 * @property {string} name
 *
 * @typedef {Object} OpRenameStoredValue
 * @property {'renameStoredValue'} kind
 * @property {string} oldName
 * @property {string} newName
 *
 * @typedef {Object} OpReplaceColumnRefs
 * @property {'replaceColumnRefs'} kind
 * @property {string} newColId
 * @property {string} oldColId
 *
 * @typedef {Object} OpSwapColumnRefs
 * @property {'swapColumnRefs'} kind
 * @property {string} idA
 * @property {string} idB
 *
 * @typedef {Object} OpBatch
 * @property {'batch'} kind
 * @property {GraphOperation[]} ops
 *
 * @typedef {OpAddColumn | OpRemoveColumn | OpAddProcess | OpRemoveProcess |
 *   OpSetProcessArg | OpAddPlot | OpRemovePlot | OpSetPlotProperty | OpSetPlotPosition |
 *   OpAddFreeTableProcess | OpRemoveFreeTableProcess | OpSetFreeTableProcessArg |
 *   OpSetOrphanProcessArg | OpSetStoredValue | OpRemoveStoredValue |
 *   OpRenameStoredValue | OpReplaceColumnRefs | OpSwapColumnRefs | OpBatch} GraphOperation
 */

const opListeners = new Set();
const stateChangeHooks = new Set();

/**
 * Add a listener that fires synchronously after every successful top-level applyOp.
 * Receives (forward, reverse). HistoryManager subscribes here. Future collab/MCP
 * transports register the same way.
 */
export function addOpListener(fn) {
    opListeners.add(fn);
    return () => opListeners.delete(fn);
}

/**
 * Add a hook that fires synchronously after every successful applyOp, including
 * under listener suppression (i.e. during history.undo / history.redo). Used by
 * state mirrors that need to stay in sync with core even when op recording is
 * muted, e.g. paramDiffWatcher's `prev` snapshot — otherwise an undo's mutation
 * would look like a fresh user edit on the watcher's next reactive run and get
 * re-recorded as a new op, creating an undo loop.
 */
export function addStateChangeHook(fn) {
    stateChangeHooks.add(fn);
    return () => stateChangeHooks.delete(fn);
}

let suppressed = 0;

export function withSuppressedListeners(fn) {
    suppressed++;
    try {
        return fn();
    } finally {
        suppressed--;
    }
}

function emit(forward, reverse) {
    if (suppressed > 0) return;
    for (const l of opListeners) l(forward, reverse);
}

/** Apply one op; return its inverse, or null if the op was a no-op. */
export function applyOp(op) {
    const result = applyForward(op);
    if (!result) return null;
    emit(result.canonical, result.inverse);
    for (const h of stateChangeHooks) h(result.canonical, result.inverse);
    return result.inverse;
}

export function applyOps(ops) {
    const inverses = [];
    for (const op of ops) {
        const inv = applyOp(op);
        if (inv) inverses.unshift(inv);
    }
    return inverses;
}

function pair(canonical, inverse) {
    return { canonical, inverse };
}

function snapshotPlot(plot) {
    // Cheap deep clone; drop functions so Svelte $state proxies don't smuggle methods.
    return JSON.parse(JSON.stringify(plot, (k, v) => (typeof v === 'function' ? undefined : v)));
}

function applyForward(op) {
    switch (op.kind) {
        case 'addPlot':
            return op_addPlot(op);
        case 'removePlot':
            return op_removePlot(op);
        case 'setPlotProperty':
            return op_setPlotProperty(op);
        case 'setPlotPosition':
            return op_setPlotPosition(op);
        case 'addColumn':
            return op_addColumn(op);
        case 'removeColumn':
            return op_removeColumn(op);
        case 'addProcess':
            return op_addProcess(op);
        case 'removeProcess':
            return op_removeProcess(op);
        case 'setProcessArg':
            return op_setProcessArg(op);
        case 'addFreeTableProcess':
            return op_addFreeTableProcess(op);
        case 'removeFreeTableProcess':
            return op_removeFreeTableProcess(op);
        case 'setFreeTableProcessArg':
            return op_setFreeTableProcessArg(op);
        case 'setOrphanProcessArg':
            return op_setOrphanProcessArg(op);
        case 'setStoredValue':
            return op_setStoredValue(op);
        case 'removeStoredValue':
            return op_removeStoredValue(op);
        case 'renameStoredValue':
            return op_renameStoredValue(op);
        case 'replaceColumnRefs':
            return op_replaceColumnRefs(op);
        case 'swapColumnRefs':
            return op_swapColumnRefs(op);
        case 'batch':
            return op_batch(op);
        default:
            throw new Error(`applyOp: unknown kind '${op?.kind}'`);
    }
}

function op_addPlot(op) {
    const plot = Plot.fromJSON(op.plotData);
    core.plots.push(plot);
    return pair(
        { kind: 'addPlot', plotData: snapshotPlot(plot) },
        { kind: 'removePlot', id: plot.id }
    );
}

function op_removePlot(op) {
    const idx = core.plots.findIndex((p) => p.id === op.id);
    if (idx < 0) return null;
    const before = snapshotPlot(core.plots[idx]);
    core.plots.splice(idx, 1);
    return pair(op, { kind: 'addPlot', plotData: before });
}

function op_setPlotProperty(op) {
    const plot = core.plots.find((p) => p.id === op.id);
    if (!plot) return null;
    const before = plot[op.key];
    if (before === op.value) return null;
    plot[op.key] = op.value;
    return pair(op, { kind: 'setPlotProperty', id: op.id, key: op.key, value: before });
}

function op_setPlotPosition(op) {
    const plot = core.plots.find((p) => p.id === op.id);
    if (!plot) return null;
    const before = { x: plot.x, y: plot.y, width: plot.width, height: plot.height };
    if (op.x != null) plot.x = op.x;
    if (op.y != null) plot.y = op.y;
    if (op.width != null) plot.width = op.width;
    if (op.height != null) plot.height = op.height;
    return pair(op, {
        kind: 'setPlotPosition',
        id: op.id,
        x: before.x,
        y: before.y,
        width: before.width,
        height: before.height
    });
}

function snapshotColumn(col) {
    return JSON.parse(JSON.stringify(col, (k, v) => (typeof v === 'function' ? undefined : v)));
}

function op_addColumn(op) {
    const data = op.columnData;
    const col = Column.fromJSON(data);
    core.data.push(col);
    return pair(
        { kind: 'addColumn', columnData: snapshotColumn(col) },
        { kind: 'removeColumn', id: col.id }
    );
}

function op_removeColumn(op) {
    const idx = core.data.findIndex((c) => c.id === op.id);
    if (idx < 0) return null;
    const before = snapshotColumn(core.data[idx]);
    core.data.splice(idx, 1);
    return pair(op, { kind: 'addColumn', columnData: before });
}

function op_addProcess(op) {
    const col = core.data.find((c) => c.id === op.columnId);
    if (!col) return null;
    const proc = new Process(
        { name: op.processType, args: op.args ?? {}, linkedGroupId: op.linkedGroupId ?? null },
        col,
        op.processId ?? null
    );
    if (op.index != null && op.index >= 0 && op.index < col.processes.length) {
        col.processes.splice(op.index, 0, proc);
    } else {
        col.processes.push(proc);
    }
    return pair(
        {
            kind: 'addProcess',
            columnId: op.columnId,
            processType: op.processType,
            processId: proc.id,
            args: JSON.parse(JSON.stringify(op.args ?? {})),
            ...(op.linkedGroupId != null && { linkedGroupId: op.linkedGroupId }),
            ...(op.index != null && { index: op.index })
        },
        { kind: 'removeProcess', columnId: op.columnId, processId: proc.id }
    );
}

function op_removeProcess(op) {
    const col = core.data.find((c) => c.id === op.columnId);
    if (!col) return null;
    const procIdx = col.processes.findIndex((p) => p.id === op.processId);
    if (procIdx < 0) return null;
    const before = col.processes[procIdx];
    const snap = {
        processType: before.name,
        processId: before.id,
        args: JSON.parse(JSON.stringify(before.args ?? {})),
        linkedGroupId: before.linkedGroupId ?? null,
        index: procIdx
    };
    col.processes.splice(procIdx, 1);
    return pair(op, {
        kind: 'addProcess',
        columnId: op.columnId,
        processType: snap.processType,
        processId: snap.processId,
        args: snap.args,
        ...(snap.linkedGroupId != null && { linkedGroupId: snap.linkedGroupId }),
        index: snap.index
    });
}

function op_setProcessArg(op) {
    const col = core.data.find((c) => c.id === op.columnId);
    if (!col) return null;
    const proc = col.processes.find((p) => p.id === op.processId);
    if (!proc) return null;
    if (!proc.args) proc.args = {};
    const before = proc.args[op.key];
    if (before === op.value) return null;
    proc.args[op.key] = op.value;
    return pair(op, {
        kind: 'setProcessArg',
        columnId: op.columnId,
        processId: op.processId,
        key: op.key,
        value: before
    });
}

function op_addFreeTableProcess(op) {
    const tp = new TableProcess(
        { name: op.tpType, args: op.args ?? {} },
        null,
        op.tpId ?? null
    );
    core.tableProcesses.push(tp);
    return pair(
        {
            kind: 'addFreeTableProcess',
            tpType: op.tpType,
            tpId: tp.id,
            args: JSON.parse(JSON.stringify(op.args ?? {}))
        },
        { kind: 'removeFreeTableProcess', tpId: tp.id }
    );
}

function op_removeFreeTableProcess(op) {
    const idx = core.tableProcesses.findIndex((tp) => tp.id === op.tpId);
    if (idx < 0) return null;
    const before = core.tableProcesses[idx];
    const snap = {
        tpType: before.name,
        tpId: before.id,
        args: JSON.parse(JSON.stringify(before.args ?? {}))
    };
    core.tableProcesses.splice(idx, 1);
    return pair(op, {
        kind: 'addFreeTableProcess',
        tpType: snap.tpType,
        tpId: snap.tpId,
        args: snap.args
    });
}

function op_setFreeTableProcessArg(op) {
    const tp = core.tableProcesses.find((x) => x.id === op.tpId);
    if (!tp) return null;
    if (!tp.args) tp.args = {};
    const before = tp.args[op.key];
    if (before === op.value) return null;
    tp.args[op.key] = op.value;
    return pair(op, {
        kind: 'setFreeTableProcessArg',
        tpId: op.tpId,
        key: op.key,
        value: before
    });
}

function op_setOrphanProcessArg(op) {
    const proc = core.orphanProcesses.find((p) => p.id === op.processId);
    if (!proc) return null;
    if (!proc.args) proc.args = {};
    const before = proc.args[op.key];
    if (before === op.value) return null;
    proc.args[op.key] = op.value;
    return pair(op, {
        kind: 'setOrphanProcessArg',
        processId: op.processId,
        key: op.key,
        value: before
    });
}

function op_setStoredValue(op) {
    const before = core.storedValues[op.name];
    core.storedValues[op.name] = { ...op.entry };
    return pair(
        op,
        before
            ? { kind: 'setStoredValue', name: op.name, entry: { ...before } }
            : { kind: 'removeStoredValue', name: op.name }
    );
}

function op_removeStoredValue(op) {
    const before = core.storedValues[op.name];
    if (!before) return null;
    delete core.storedValues[op.name];
    return pair(op, { kind: 'setStoredValue', name: op.name, entry: { ...before } });
}

function op_renameStoredValue(op) {
    const entry = core.storedValues[op.oldName];
    if (!entry || core.storedValues[op.newName]) return null;
    core.storedValues[op.newName] = entry;
    delete core.storedValues[op.oldName];
    return pair(op, { kind: 'renameStoredValue', oldName: op.newName, newName: op.oldName });
}

function op_replaceColumnRefs(op) {
    // Note: this is one-directional in current AnCiR. The inverse re-applies with
    // arguments swapped; round-trip restores the original ref topology.
    replaceColumnRefs(op.newColId, op.oldColId);
    return pair(op, { kind: 'replaceColumnRefs', newColId: op.oldColId, oldColId: op.newColId });
}

function op_swapColumnRefs(op) {
    swapColumnRefs(op.idA, op.idB);
    return pair(op, { kind: 'swapColumnRefs', idA: op.idA, idB: op.idB });
}

function op_batch(op) {
    const inverses = [];
    for (const child of op.ops) {
        const result = applyForward(child);
        if (result) inverses.unshift(result.inverse);
    }
    return pair(op, { kind: 'batch', ops: inverses });
}
