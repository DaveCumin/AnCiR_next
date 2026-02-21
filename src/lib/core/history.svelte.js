// @ts-nocheck
import { tick } from 'svelte';
import { core, appState, getCoreAsPlainObject, applyPatchToCore } from './core.svelte';
import * as jsonpatch from 'fast-json-patch';

class HistoryManager {
	undoStack = $state([]);
	redoStack = $state([]);
	maxStackSize = 50;
	isRestoring = false;

	snapshotTimeout = null;
	lastSnapshotObj = null;
	lastSnapshotStr = null;
	lastCounts = null;

	// Initialize the automatic watching - must be called from a component
	init() {
		// Auto-watch core state with smart debouncing
		$effect(() => {
			if (this.isRestoring) return;

			// Access reactive state to track changes
			const dataCount = core.data.length;
			const tableCount = core.tables.length;
			const plotCount = core.plots.length;

			// Track changes to columns (data)
			core.data.forEach((d) => {
				d.name;
				d.refId;
				d.data;
				d.type;

				// Track process changes
				d.processes?.forEach((p) => {
					p.name;
					p.displayName;
					// Access args deeply to trigger on any arg change
					if (p.args) {
						Object.keys(p.args).forEach((key) => {
							p.args[key];
						});
					}
				});
			});

			// Track changes to tables
			core.tables.forEach((t) => {
				t.name;
				t.columnRefs;

				// Track table process changes
				t.processes?.forEach((tp) => {
					tp.name;
					tp.displayName;
					// Access args deeply to trigger on any arg change
					if (tp.args) {
						Object.keys(tp.args).forEach((key) => {
							const val = tp.args[key];
							// If it's an object (like 'out'), access its properties too
							if (val && typeof val === 'object') {
								Object.keys(val).forEach((subkey) => {
									val[subkey];
								});
							}
						});
					}
				});
			});

			// Track changes to plots
			core.plots.forEach((p) => {
				p.name;
				p.x;
				p.y;
				p.width;
				p.height;
				p.type;
				p.selected;

				// Track plot data references
				p.plot?.data?.forEach((d) => {
					// Access data properties to trigger on changes
					if (d && typeof d === 'object') {
						Object.keys(d).forEach((key) => {
							const val = d[key];
							if (val && typeof val === 'object' && val.refId !== undefined) {
								val.refId;
							}
						});
					}
				});
			});

			// Determine if this is a structural change (add/remove)
			const isStructuralChange = this.detectStructuralChange();

			// Structural changes get snapshotted quickly, property changes get debounced
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
		const currentObj = getCoreAsPlainObject();
		const currentStr = JSON.stringify(currentObj);

		// Don't save if identical to last snapshot
		if (currentStr === this.lastSnapshotStr) return;

		if (this.lastSnapshotObj !== null) {
			// compare(A, B) produces operations that transform A into B.
			// forwardPatch: lastSnapshot → current  (used by redo)
			const forwardPatch = jsonpatch.compare(this.lastSnapshotObj, currentObj);
			// reversePatch: current → lastSnapshot  (used by undo)
			const reversePatch = jsonpatch.compare(currentObj, this.lastSnapshotObj);
			this.undoStack.push({ forwardPatch, reversePatch });

			// Limit stack size
			if (this.undoStack.length > this.maxStackSize) {
				this.undoStack.shift();
			}

			// Clear redo stack on new action
			this.redoStack = [];
		}

		this.lastSnapshotObj = currentObj;
		this.lastSnapshotStr = currentStr;
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

		// Only show loading overlay for large patches
		if (entry.reversePatch.length > 10) {
			appState.loadingState.isLoading = true;
			appState.loadingState.loadingMsg = 'Undoing…';
		}

		// Apply reverse patch in-place
		applyPatchToCore(entry.reversePatch);

		// Update reference snapshot
		this.lastSnapshotObj = getCoreAsPlainObject();
		this.lastSnapshotStr = JSON.stringify(this.lastSnapshotObj);

		await tick();
		appState.loadingState.isLoading = false;
		this.isRestoring = false;
	}

	async redo() {
		if (this.redoStack.length === 0) return;

		this.isRestoring = true;
		const entry = this.redoStack.pop();
		this.undoStack.push(entry);

		// Only show loading overlay for large patches
		if (entry.forwardPatch.length > 10) {
			appState.loadingState.isLoading = true;
			appState.loadingState.loadingMsg = 'Redoing…';
		}

		// Apply forward patch in-place
		applyPatchToCore(entry.forwardPatch);

		// Update reference snapshot
		this.lastSnapshotObj = getCoreAsPlainObject();
		this.lastSnapshotStr = JSON.stringify(this.lastSnapshotObj);

		await tick();
		appState.loadingState.isLoading = false;
		this.isRestoring = false;
	}

	clear() {
		this.undoStack = [];
		this.redoStack = [];
		this.lastSnapshotObj = null;
		this.lastSnapshotStr = null;
	}

	// Derived state for UI
	canUndo = $derived(this.undoStack.length > 0);
	canRedo = $derived(this.redoStack.length > 0);
	undoCount = $derived(this.undoStack.length);
	redoCount = $derived(this.redoStack.length);
}

export const history = new HistoryManager();

