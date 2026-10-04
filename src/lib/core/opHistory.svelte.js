// src/lib/core/opHistory.svelte.js
// @ts-nocheck
import { addOpListener, applyOp, withSuppressedListeners } from './operations.js';

const COALESCE_MS = 500;
const COALESCE_KINDS = new Set([
	'setProcessArg',
	// The op an analysis-parameter edit actually records. This used to name
	// 'setTableProcessArg', a kind nothing emits, so a slider drag never coalesced and
	// a 60-tick drag pushed the whole 50-step history out (review ROB-18).
	'setFreeTableProcessArg',
	'setOrphanProcessArg',
	'setPlotProperty',
	'setPlotPosition',
	// A colour-picker drag or a run of spinner clicks on one rule field is one step.
	'setMarkerRule'
]);

class OpHistoryManager {
	undoStack = $state([]);
	redoStack = $state([]);
	maxStackSize = 50;
	// Reactive so UI side-effects (e.g. auto-clear of stale selection) can
	// skip work while a restore is in flight.
	isRestoring = $state(false);
	// Depth of session loads in flight (beginLoad/endLoad). While a load runs, the stacks
	// describe a session that is being torn down: undo/redo would apply the OLD session's ops
	// to the half-built new one (review ROB-2), and anything the load itself writes (the
	// output-map reconcile, ROB-17) is not a user step. So both are refused until it ends.
	#loadDepth = $state(0);
	get isLoading() {
		return this.#loadDepth > 0;
	}
	#lastTs = 0;
	#initialized = false;
	// Handle from addOpListener. `init()` is idempotent (#initialized) and is
	// called once from the root +page.svelte, so this listener is app-lifetime
	// and no teardown was ever wired. Kept so the subscription is not silently
	// dropped if a dispose path is ever added.
	// eslint-disable-next-line no-unused-private-class-members -- app-lifetime singleton subscription; no teardown path exists
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

	// Capture the post-op UI snapshot on a microtask, i.e. after the current
	// synchronous gesture finishes. The caller typically mutates selection right
	// AFTER applyOp returns (e.g. delete clears the focused node); if we snapped
	// `uiAfter` synchronously here it would record the PRE-clear selection, and
	// redoing the op would wrongly restore the just-deleted node as selected.
	// Deferring lets those trailing updates land first. Only updates `entry` if
	// it's still the top of the stack; a newer op manages its own snapshot.
	#scheduleAfterCapture(entry) {
		queueMicrotask(() => {
			if (this.isRestoring) return;
			const top = this.undoStack[this.undoStack.length - 1];
			if (top === entry) entry.uiAfter = this.#captureUi();
		});
	}

	#record(forward, reverse) {
		if (this.isRestoring || this.isLoading) return;
		const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
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
			// Pass the PROXIED stack entry (read back), not the raw `entry`: the
			// later `top === entry` check reads `top` from the $state stack (a
			// proxy), so comparing it against the raw object mismatches and
			// uiAfter would never be captured (Svelte state_proxy_equality_mismatch).
			this.#scheduleAfterCapture(this.undoStack[this.undoStack.length - 1]);
		}
		this.redoStack = [];
	}

	#sameTarget(a, b) {
		switch (a.kind) {
			case 'setProcessArg':
				return a.columnId === b.columnId && a.processId === b.processId && a.key === b.key;
			case 'setFreeTableProcessArg':
				return a.tpId === b.tpId && a.key === b.key;
			case 'setOrphanProcessArg':
				return a.processId === b.processId && a.key === b.key;
			case 'setPlotProperty':
				return a.id === b.id && a.key === b.key;
			case 'setPlotPosition':
				return a.id === b.id;
			case 'setMarkerRule':
				return (
					a.id === b.id &&
					a.ruleId === b.ruleId &&
					Object.keys(a.patch ?? {})
						.sort()
						.join() ===
						Object.keys(b.patch ?? {})
							.sort()
							.join()
				);
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
		if (this.isLoading || this.undoStack.length === 0) return;
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
		if (this.isLoading || this.redoStack.length === 0) return;
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

	/** Mark a session load as started: undo, redo and recording are off until endLoad(). */
	beginLoad() {
		this.#loadDepth += 1;
	}

	/** Pair of beginLoad(); call from a finally block. */
	endLoad() {
		this.#loadDepth = Math.max(0, this.#loadDepth - 1);
	}

	canUndo = $derived(!this.isLoading && this.undoStack.length > 0);
	canRedo = $derived(!this.isLoading && this.redoStack.length > 0);
	undoCount = $derived(this.undoStack.length);
	redoCount = $derived(this.redoStack.length);
}

export const history = new OpHistoryManager();
