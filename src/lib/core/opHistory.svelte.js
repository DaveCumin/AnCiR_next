// src/lib/core/opHistory.svelte.js
// @ts-nocheck
import { addOpListener, applyOp, withSuppressedListeners } from './operations.js';

const COALESCE_MS = 500;
const COALESCE_KINDS = new Set([
    'setProcessArg',
    'setTableProcessArg',
    'setPlotProperty',
    'setPlotPosition'
]);

class OpHistoryManager {
    undoStack = $state([]);
    redoStack = $state([]);
    maxStackSize = 50;
    isRestoring = false;
    #lastTs = 0;
    #initialized = false;
    #unsubscribe = null;

    init() {
        if (this.#initialized) return;
        this.#initialized = true;
        this.#unsubscribe = addOpListener((forward, reverse) => this.#record(forward, reverse));
    }

    #record(forward, reverse) {
        if (this.isRestoring) return;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const top = this.undoStack[this.undoStack.length - 1];
        if (
            top &&
            now - this.#lastTs < COALESCE_MS &&
            COALESCE_KINDS.has(forward.kind) &&
            top.forward.kind === forward.kind &&
            this.#sameTarget(top.forward, forward)
        ) {
            // Forward keeps the latest value; reverse stays the original (top.reverse).
            top.forward = forward;
            this.#lastTs = now;
        } else {
            this.undoStack.push({ forward, reverse });
            this.#lastTs = now;
            if (this.undoStack.length > this.maxStackSize) this.undoStack.shift();
        }
        this.redoStack = [];
    }

    #sameTarget(a, b) {
        switch (a.kind) {
            case 'setProcessArg':
                return a.columnId === b.columnId && a.processId === b.processId && a.key === b.key;
            case 'setTableProcessArg':
                return a.tableId === b.tableId && a.tpId === b.tpId && a.key === b.key;
            case 'setPlotProperty':
                return a.id === b.id && a.key === b.key;
            case 'setPlotPosition':
                return a.id === b.id;
        }
        return false;
    }

    undo() {
        if (this.undoStack.length === 0) return;
        const entry = this.undoStack[this.undoStack.length - 1];
        this.undoStack = this.undoStack.slice(0, -1);
        this.isRestoring = true;
        try {
            withSuppressedListeners(() => applyOp(entry.reverse));
        } finally {
            this.isRestoring = false;
        }
        this.redoStack.push(entry);
    }

    redo() {
        if (this.redoStack.length === 0) return;
        const entry = this.redoStack[this.redoStack.length - 1];
        this.redoStack = this.redoStack.slice(0, -1);
        this.isRestoring = true;
        try {
            withSuppressedListeners(() => applyOp(entry.forward));
        } finally {
            this.isRestoring = false;
        }
        this.undoStack.push(entry);
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.#lastTs = 0;
    }

    canUndo = $derived(this.undoStack.length > 0);
    canRedo = $derived(this.redoStack.length > 0);
    undoCount = $derived(this.undoStack.length);
    redoCount = $derived(this.redoStack.length);
}

export const history = new OpHistoryManager();
