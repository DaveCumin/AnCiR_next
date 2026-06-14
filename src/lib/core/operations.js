// src/lib/core/operations.js
// @ts-nocheck

/**
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
 * @typedef {Object} OpAddTable
 * @property {'addTable'} kind
 * @property {Object} tableData
 *
 * @typedef {Object} OpRemoveTable
 * @property {'removeTable'} kind
 * @property {string} id
 *
 * @typedef {Object} OpAddTableProcess
 * @property {'addTableProcess'} kind
 * @property {string} tableId
 * @property {string} tpType
 * @property {string} [tpId]
 * @property {Object} [args]
 * @property {number} [index]
 *
 * @typedef {Object} OpRemoveTableProcess
 * @property {'removeTableProcess'} kind
 * @property {string} tableId
 * @property {string} tpId
 *
 * @typedef {Object} OpSetTableProcessArg
 * @property {'setTableProcessArg'} kind
 * @property {string} tableId
 * @property {string} tpId
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
 *   OpAddTable | OpRemoveTable | OpAddTableProcess | OpRemoveTableProcess |
 *   OpSetTableProcessArg | OpSetStoredValue | OpRemoveStoredValue |
 *   OpRenameStoredValue | OpReplaceColumnRefs | OpSwapColumnRefs | OpBatch} GraphOperation
 */

const opListeners = new Set();

/**
 * Add a listener that fires synchronously after every successful top-level applyOp.
 * Receives (forward, reverse). HistoryManager subscribes here. Future collab/MCP
 * transports register the same way.
 */
export function addOpListener(fn) {
    opListeners.add(fn);
    return () => opListeners.delete(fn);
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

function applyForward(op) {
    // Stub — concrete handlers implemented in subsequent tasks.
    throw new Error(`applyOp: unknown kind ${op?.kind}`);
}
