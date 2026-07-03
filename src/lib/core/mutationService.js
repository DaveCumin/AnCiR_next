// src/lib/core/mutationService.js
// @ts-nocheck
import { applyOp, applyOps } from './operations.js';
import { core } from './core.svelte.js';

/**
 * Typed public API for graph mutations. All mutation-emitting code in the
 * UI should go through this service (or through Phase 2's paramDiffWatcher
 * bridge for legacy `core.data[i].args.x = ...` style writes).
 *
 * Each method translates a friendly call into the canonical `applyOp(op)`
 * invocation. Methods that create entities return the new instance (or null
 * if the op no-opped).
 */
export const mutationService = {
    // --- Plot ops ---
    addPlot(plotData) {
        const inv = applyOp({ kind: 'addPlot', plotData });
        if (!inv) return null;
        return core.plots.find((p) => p.id === inv.id) ?? null;
    },
    removePlot(id) {
        applyOp({ kind: 'removePlot', id });
    },
    setPlotProperty(id, key, value) {
        applyOp({ kind: 'setPlotProperty', id, key, value });
    },
    setPlotPosition(id, position) {
        applyOp({ kind: 'setPlotPosition', id, ...position });
    },
    // Replace a plot's inner data object (plot.plot) from a serialized snapshot.
    // Records a single undo entry; used to make plot input wiring undoable.
    setPlotInner(id, inner) {
        applyOp({ kind: 'setPlotInner', id, inner });
    },

    // --- Column ops ---
    addColumn(columnData) {
        const inv = applyOp({ kind: 'addColumn', columnData });
        if (!inv) return null;
        return core.data.find((c) => c.id === inv.id) ?? null;
    },
    removeColumn(id) {
        applyOp({ kind: 'removeColumn', id });
    },
    addProcess(columnId, processType, args = {}) {
        const inv = applyOp({ kind: 'addProcess', columnId, processType, args });
        if (!inv) return null;
        const col = core.data.find((c) => c.id === columnId);
        return col?.processes.find((p) => p.id === inv.processId) ?? null;
    },
    removeProcess(columnId, processId) {
        applyOp({ kind: 'removeProcess', columnId, processId });
    },
    setProcessArg(columnId, processId, key, value) {
        applyOp({ kind: 'setProcessArg', columnId, processId, key, value });
    },

    // --- Free TableProcess ops (no parent Table) ---
    addFreeTableProcess(tpType, args = {}) {
        const inv = applyOp({ kind: 'addFreeTableProcess', tpType, args });
        if (!inv) return null;
        return core.tableProcesses.find((tp) => tp.id === inv.tpId) ?? null;
    },
    removeFreeTableProcess(tpId) {
        applyOp({ kind: 'removeFreeTableProcess', tpId });
    },
    setFreeTableProcessArg(tpId, key, value) {
        applyOp({ kind: 'setFreeTableProcessArg', tpId, key, value });
    },

    // --- Free (orphan) process ops: a process node not yet owned by a column.
    // Used by dataflow wiring to record a free process's input column (inIN).
    setOrphanProcessArg(processId, key, value) {
        applyOp({ kind: 'setOrphanProcessArg', processId, key, value });
    },

    // --- Stored values ---
    setStoredValue(name, entry) {
        applyOp({ kind: 'setStoredValue', name, entry });
    },
    removeStoredValue(name) {
        applyOp({ kind: 'removeStoredValue', name });
    },
    renameStoredValue(oldName, newName) {
        applyOp({ kind: 'renameStoredValue', oldName, newName });
    },

    // --- Column refs ---
    replaceColumnRefs(newColId, oldColId) {
        applyOp({ kind: 'replaceColumnRefs', newColId, oldColId });
    },
    swapColumnRefs(idA, idB) {
        applyOp({ kind: 'swapColumnRefs', idA, idB });
    },

    // --- Batch ---
    // Applies each op as its OWN history entry (N ops → N undo steps).
    batch(ops) {
        applyOps(ops);
    },
    // Applies a group of ops as a SINGLE atomic history entry (one undo reverses
    // the whole group). Use when several ops together form one user gesture,
    // e.g. removing a wired input (clear inIN + drop its producer column).
    atomicBatch(ops) {
        return applyOp({ kind: 'batch', ops });
    }
};
