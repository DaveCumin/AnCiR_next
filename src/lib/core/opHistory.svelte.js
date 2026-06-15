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
    // Reactive so UI side-effects (e.g. auto-clear of stale selection) can
    // skip work while a restore is in flight.
    isRestoring = $state(false);
    #lastTs = 0;
    #initialized = false;
    #unsubscribe = null;
    #uiCapture = null;
    #uiRestore = null;

    init() {
        if (this.#initialized) return;
        this.#initialized = true;
        this.#unsubscribe = addOpListener((forward, reverse) => this.#record(forward, reverse));
    }

    /**
     * Register canvas selection/expansion snapshot handlers. `capture` returns
     * a plain object describing the current UI selection; `restore` applies it
     * back. Returns an unregister callback. Only the most recently registered
     * pair is used.
     */
    registerUiHandlers(capture, restore) {
        this.#uiCapture = capture;
        this.#uiRestore = restore;
        return () => {
            if (this.#uiCapture === capture) this.#uiCapture = null;
            if (this.#uiRestore === restore) this.#uiRestore = null;
        };
    }

    #captureUi() {
        if (!this.#uiCapture) return null;
        try {
            return this.#uiCapture();
        } catch {
            return null;
        }
    }

    #applyUi(snap) {
        if (!snap || !this.#uiRestore) return;
        try {
            this.#uiRestore(snap);
        } catch {
            /* ignore — UI restore is best-effort */
        }
    }

    // Defer until end of current sync gesture so any selection updates the
    // caller performs after applyOp (e.g. clearing after delete) land in
    // `uiAfter`. Only updates `entry` if it's still the top of the stack;
    // a newer op manages its own snapshot.
    #scheduleAfterCapture(entry) {
        queueMicrotask(() => {
            if (this.isRestoring) return;
            const top = this.undoStack[this.undoStack.length - 1];
            if (top === entry) entry.uiAfter = this.#captureUi();
        });
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
            // uiBefore stays from the original entry; uiAfter refreshes via microtask.
            top.forward = forward;
            this.#lastTs = now;
            this.#scheduleAfterCapture(top);
        } else {
            const uiBefore = this.#captureUi();
            const entry = { forward, reverse, uiBefore, uiAfter: uiBefore };
            this.undoStack.push(entry);
            this.#lastTs = now;
            if (this.undoStack.length > this.maxStackSize) this.undoStack.shift();
            this.#scheduleAfterCapture(entry);
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

    // Holds isRestoring=true across the Svelte effect flush that follows a
    // restore, then flips it back to false. Subscribers (e.g. the canvas's
    // auto-prune of expandedNodeIds) see it as true on their first re-run after
    // the restore — by which point any structural state changes have settled
    // — so they don't race the restore.
    #scheduleClearRestoring() {
        queueMicrotask(() => {
            this.isRestoring = false;
        });
    }

    undo() {
        if (this.undoStack.length === 0) return;
        const entry = this.undoStack[this.undoStack.length - 1];
        this.undoStack = this.undoStack.slice(0, -1);
        this.isRestoring = true;
        try {
            withSuppressedListeners(() => applyOp(entry.reverse));
            this.#applyUi(entry.uiBefore);
        } catch (e) {
            this.isRestoring = false;
            throw e;
        }
        this.redoStack.push(entry);
        this.#scheduleClearRestoring();
    }

    redo() {
        if (this.redoStack.length === 0) return;
        const entry = this.redoStack[this.redoStack.length - 1];
        this.redoStack = this.redoStack.slice(0, -1);
        this.isRestoring = true;
        try {
            withSuppressedListeners(() => applyOp(entry.forward));
            this.#applyUi(entry.uiAfter);
        } catch (e) {
            this.isRestoring = false;
            throw e;
        }
        this.undoStack.push(entry);
        this.#scheduleClearRestoring();
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
