// src/lib/core/paramDiffWatcher.svelte.js
// @ts-nocheck
import { core } from './core.svelte.js';
import { mutationService } from './mutationService.js';
import { addStateChangeHook } from './operations.js';

/**
 * Bridge that converts direct `proc.args[key] = v` writes (e.g. from Svelte
 * `bind:value` inputs in process / table-process panels) into canonical
 * `setProcessArg` / `setTableProcessArg` ops, so they land on the op history
 * and become undo / redoable.
 *
 * Live wiring: `init()` attaches a `$effect.root` whose inner `$effect` reads
 * every arg value (registering them as dependencies) and re-runs `diffAndEmit`
 * on any change. Tests can drive the same logic manually via
 * `rebaseSnapshot()` + `flush()`.
 */

let prev = {};
let suppress = false;
let _rootCleanup = null;
let _unhookStateChange = null;

function snapshot() {
    const snap = {};
    for (const col of core.data) {
        const procs = {};
        for (const p of col.processes ?? []) {
            procs[String(p.id)] = JSON.parse(JSON.stringify(p.args ?? {}));
        }
        snap[String(col.id)] = procs;
    }
    // Free TPs use a single synthetic owner so the diff key uniformly carries
    // the TP id; the mutation routes through setFreeTableProcessArg.
    const freeTps = {};
    for (const tp of core.tableProcesses ?? []) {
        freeTps[String(tp.id)] = JSON.parse(JSON.stringify(tp.args ?? {}));
    }
    snap[`freetp:`] = freeTps;
    return snap;
}

function diffAndEmit() {
    if (suppress) return;
    const next = snapshot();
    for (const colKey of Object.keys(next)) {
        const prevProcs = prev[colKey] ?? {};
        const nextProcs = next[colKey];
        for (const procId of Object.keys(nextProcs)) {
            // Brand-new processes: their initial args are already captured by
            // the addProcess op's reverse pair, so don't double-record them as
            // setProcessArg diffs against the empty baseline.
            if (!(procId in prevProcs)) continue;
            const a = prevProcs[procId];
            const b = nextProcs[procId];
            for (const key of Object.keys(b)) {
                if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
                    const isFreeTP = colKey === 'freetp:';
                    let owner;
                    let proc;
                    if (isFreeTP) {
                        proc = core.tableProcesses.find((tp) => String(tp.id) === procId);
                        owner = proc; // free TPs are their own owner
                    } else {
                        owner = core.data.find((c) => String(c.id) === colKey);
                        proc = owner?.processes?.find((p) => String(p.id) === procId);
                    }
                    if (!owner || !proc) continue;
                    const liveOwnerId = owner.id;
                    const liveProcId = proc.id;

                    // Roll back the direct mutation so the op handler can
                    // record a real before -> after transition. Without this,
                    // the handler short-circuits because proc.args[key]
                    // already equals the new value.
                    suppress = true;
                    try {
                        if (key in a) {
                            proc.args[key] = a[key];
                        } else {
                            delete proc.args[key];
                        }
                    } finally {
                        suppress = false;
                    }
                    if (isFreeTP) {
                        mutationService.setFreeTableProcessArg(liveProcId, key, b[key]);
                    } else {
                        mutationService.setProcessArg(liveOwnerId, liveProcId, key, b[key]);
                    }
                }
            }
        }
    }
    prev = snapshot();
}

export const paramDiffWatcher = {
    /**
     * Re-baseline the snapshot. Call when entering a new "session" or after
     * intentional bulk loads so the next mutation diff starts clean.
     */
    rebaseSnapshot() {
        prev = snapshot();
    },

    /**
     * Drain pending diffs and emit ops for them. Always returns a resolved
     * Promise so consumers can `await watcher.flush()` regardless of whether
     * micro-task scheduling is involved.
     */
    async flush() {
        diffAndEmit();
    },

    /**
     * Live wiring. Attaches a $effect.root that re-snapshots whenever any
     * tracked arg value changes. Safe to call more than once (subsequent
     * calls are no-ops). Tests don't call this; they drive flush() manually.
     */
    init() {
        if (_rootCleanup) return;
        // Baseline what's already in core so the first effect run treats
        // existing args as the starting point rather than emitting
        // setProcessArg ops for the initial state.
        prev = snapshot();
        // Stay in sync with every applyOp, including the suppressed ones
        // from history.undo / history.redo. Without this, an undo's reverse
        // mutation looks like a fresh user edit on the next reactive run and
        // gets re-recorded as a brand-new op (infinite undo loop).
        _unhookStateChange = addStateChangeHook(() => {
            prev = snapshot();
        });
        _rootCleanup = $effect.root(() => {
            $effect(() => {
                // Read every arg value to register it as a dependency. Iterating
                // core.data / col.processes / p.args also registers structural
                // deps, so column / process adds and removes trigger a re-run.
                for (const col of core.data ?? []) {
                    for (const p of col.processes ?? []) {
                        if (!p.args) continue;
                        for (const k of Object.keys(p.args)) {
                            p.args[k]; // tracked read
                        }
                    }
                }
                for (const tp of core.tableProcesses ?? []) {
                    if (!tp.args) continue;
                    for (const k of Object.keys(tp.args)) {
                        tp.args[k]; // tracked read
                    }
                }
                diffAndEmit();
            });
        });
    },

    /** Test-only: tear down the live effect (no-op if not initialised). */
    _disposeForTests() {
        if (_rootCleanup) {
            _rootCleanup();
            _rootCleanup = null;
        }
        if (_unhookStateChange) {
            _unhookStateChange();
            _unhookStateChange = null;
        }
        prev = {};
    }
};
