// @ts-nocheck
import { tick } from 'svelte';
import { core, appState, applyPatchToCore, getStoredValue } from './core.svelte';
import * as jsonpatch from 'fast-json-patch';

// History snapshots intentionally exclude core.rawData — the imported
// measurement arrays are typically megabytes per column, serialising them
// dominated the snapshot cost, and undoing an "import data" action is not
// a workflow users expect.
function snapshotCore() {
	const s = $state.snapshot(core);
	delete s.rawData;
	// storedValues holds live getter functions; $state.snapshot drops those,
	// so resolve each entry to its current static value for diff purposes.
	const resolved = {};
	for (const [name, entry] of Object.entries(core.storedValues)) {
		resolved[name] = {
			source: entry.source,
			staticValue: getStoredValue(name)
		};
	}
	s.storedValues = resolved;
	return s;
}

class HistoryManager {
	undoStack = $state([]);
	redoStack = $state([]);
	maxStackSize = 50;
	isRestoring = false;

	snapshotTimeout = null;
	lastSnapshotObj = null;
	lastCounts = null;

	// Initialize the automatic watching - must be called from a component
	init() {
		$effect(() => {
			if (this.isRestoring) return;

			// $state.snapshot walks all reactive reads, so this single call
			// registers dependencies on every nested $state field — no need
			// to hand-traverse columns/processes/plots to subscribe.
			$state.snapshot(core);

			const isStructuralChange = this.detectStructuralChange();
			const debounceMs = isStructuralChange ? 100 : 500;
			this.scheduleSnapshot(debounceMs);
		});
	}

	detectStructuralChange() {
		const currentCounts = {
			data: core.data.length,
			tables: core.tables.length,
			plots: core.plots.length
		};

		if (!this.lastCounts) {
			this.lastCounts = currentCounts;
			return true;
		}

		const changed =
			currentCounts.data !== this.lastCounts.data ||
			currentCounts.tables !== this.lastCounts.tables ||
			currentCounts.plots !== this.lastCounts.plots;

		this.lastCounts = currentCounts;
		return changed;
	}

	scheduleSnapshot(delayMs = 500) {
		if (this.snapshotTimeout) {
			clearTimeout(this.snapshotTimeout);
		}

		this.snapshotTimeout = setTimeout(() => {
			this.takeSnapshotIfChanged();
		}, delayMs);
	}

	takeSnapshotIfChanged() {
		const currentObj = snapshotCore();

		if (this.lastSnapshotObj !== null) {
			// compare(A, B) produces the ops that transform A → B.
			const forwardPatch = jsonpatch.compare(this.lastSnapshotObj, currentObj);
			if (forwardPatch.length === 0) return; // no real change
			// reverse patch for undo: current → lastSnapshot
			const reversePatch = jsonpatch.compare(currentObj, this.lastSnapshotObj);
			this.undoStack.push({ forwardPatch, reversePatch });

			if (this.undoStack.length > this.maxStackSize) {
				this.undoStack.shift();
			}
			this.redoStack = [];
		}

		this.lastSnapshotObj = currentObj;
	}

	// For critical operations: snapshot immediately (no debounce)
	takeSnapshotNow() {
		if (this.snapshotTimeout) {
			clearTimeout(this.snapshotTimeout);
		}
		this.scheduleSnapshot(0);
	}

	async undo() {
		if (this.undoStack.length === 0) return;

		this.isRestoring = true;
		const entry = this.undoStack.pop();
		this.redoStack.push(entry);

		if (entry.reversePatch.length > 10) {
			appState.loadingState.isLoading = true;
			appState.loadingState.loadingMsg = 'Undoing…';
		}

		applyPatchToCore(entry.reversePatch);

		this.lastSnapshotObj = snapshotCore();

		await tick();
		appState.loadingState.isLoading = false;
		this.isRestoring = false;
	}

	async redo() {
		if (this.redoStack.length === 0) return;

		this.isRestoring = true;
		const entry = this.redoStack.pop();
		this.undoStack.push(entry);

		if (entry.forwardPatch.length > 10) {
			appState.loadingState.isLoading = true;
			appState.loadingState.loadingMsg = 'Redoing…';
		}

		applyPatchToCore(entry.forwardPatch);

		this.lastSnapshotObj = snapshotCore();

		await tick();
		appState.loadingState.isLoading = false;
		this.isRestoring = false;
	}

	clear() {
		this.undoStack = [];
		this.redoStack = [];
		this.lastSnapshotObj = null;
	}

	// Derived state for UI
	canUndo = $derived(this.undoStack.length > 0);
	canRedo = $derived(this.redoStack.length > 0);
	undoCount = $derived(this.undoStack.length);
	redoCount = $derived(this.redoStack.length);
}

export const history = new HistoryManager();
