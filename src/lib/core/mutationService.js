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

    // --- Table ops ---
    addTable(tableData) {
        const inv = applyOp({ kind: 'addTable', tableData });
        if (!inv) return null;
        return core.tables.find((t) => t.id === inv.id) ?? null;
    },
    removeTable(id) {
        applyOp({ kind: 'removeTable', id });
    },
    addTableProcess(tableId, tpType, args = {}) {
        const inv = applyOp({ kind: 'addTableProcess', tableId, tpType, args });
        if (!inv) return null;
        const table = core.tables.find((t) => t.id === tableId);
        return table?.processes.find((tp) => tp.id === inv.tpId) ?? null;
    },
    removeTableProcess(tableId, tpId) {
        applyOp({ kind: 'removeTableProcess', tableId, tpId });
    },
    setTableProcessArg(tableId, tpId, key, value) {
        applyOp({ kind: 'setTableProcessArg', tableId, tpId, key, value });
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
    batch(ops) {
        applyOps(ops);
    }
};
