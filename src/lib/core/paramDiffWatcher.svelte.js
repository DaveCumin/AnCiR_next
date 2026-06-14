// src/lib/core/paramDiffWatcher.svelte.js
// @ts-nocheck
import { core } from './core.svelte.js';
import { mutationService } from './mutationService.js';

/**
 * Transitional bridge for UI sites that still write
 * `core.data[i].processes[j].args.X = newVal` directly without going through
 * `mutationService.setProcessArg`. The watcher snapshots args per column /
 * table process, diffs against the previous snapshot on `flush()`, and emits
 * the appropriate canonical op so the change lands on the op history.
 *
 * Tasks 10+ migrate UI sites to call the mutation service directly; once that
 * migration is complete this bridge can be removed.
 */

let prev = {};
let suppress = false;

function snapshot() {
    const snap = {};
    for (const col of core.data) {
        const procs = {};
        for (const p of col.processes ?? []) {
            procs[String(p.id)] = JSON.parse(JSON.stringify(p.args ?? {}));
        }
        snap[String(col.id)] = procs;
    }
    for (const t of core.tables) {
        const tps = {};
        for (const tp of t.processes ?? []) {
            tps[String(tp.id)] = JSON.parse(JSON.stringify(tp.args ?? {}));
        }
        snap[`table:${t.id}`] = tps;
    }
    return snap;
}

function diffAndEmit() {
    if (suppress) return;
    const next = snapshot();
    for (const colKey of Object.keys(next)) {
        const prevProcs = prev[colKey] ?? {};
        const nextProcs = next[colKey];
        for (const procId of Object.keys(nextProcs)) {
            const a = prevProcs[procId] ?? {};
            const b = nextProcs[procId];
            for (const key of Object.keys(b)) {
                if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
                    const isTable = colKey.startsWith('table:');
                    const ownerId = isTable ? colKey.slice(6) : colKey;
                    const owner = isTable
                        ? core.tables.find((t) => String(t.id) === ownerId)
                        : core.data.find((c) => String(c.id) === ownerId);
                    if (!owner) continue;
                    const list = owner.processes ?? [];
                    const proc = list.find((p) => String(p.id) === procId);
                    if (!proc) continue;
                    const liveOwnerId = owner.id;
                    const liveProcId = proc.id;

                    // Roll back the direct mutation so the op handler can record
                    // a real before -> after transition. Without this, the
                    // handler short-circuits because proc.args[key] already
                    // equals the new value.
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
                    if (isTable) {
                        mutationService.setTableProcessArg(liveOwnerId, liveProcId, key, b[key]);
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
     * One-time setup. In the live app this would attach a Svelte `$effect`
     * inside a component scope. For now, callers must invoke `flush()`
     * explicitly (e.g., after a Svelte tick); the live wiring lands in Task 9.
     */
    init() {
        // No-op placeholder. Task 9 wires the live $effect.
    }
};
