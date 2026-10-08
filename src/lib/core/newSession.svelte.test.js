// @ts-nocheck
// "New session" (Navbar button and Cmd/Ctrl+Alt+N): ask first when there is unsaved work, then
// empty the session through resetSession and hand back to the start screen.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import { core, appState } from './core.svelte.js';
import { resetSession } from './sessionLoad.svelte.js';
import {
	markSessionSaved,
	markSessionUnsaved,
	hasUnsavedChanges
} from './unsavedChanges.svelte.js';
import { history } from './opHistory.svelte.js';
import { startNewSession, NEW_SESSION_LABEL } from './newSession.svelte.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Start the action and let the dialog open (the watcher effect has to run once). Wrapped in an
 * object: an async function that returned the promise itself would wait for the user's answer.
 */
async function begin(onReset) {
	const done = startNewSession({ onReset });
	flushSync();
	await tick();
	return { done };
}

beforeEach(() => {
	resetSession();
	appState.showAYSModal = false;
	appState.AYScallback = null;
	appState.canvasSelectedNodeId = null;
	appState.canvasMultiSelectedNodeIds = [];
	appState.canvasMultiSelectedCount = 0;
	history.clear();
	markSessionSaved();
});

function withUnsavedWork() {
	core.data = [{ id: 3 }];
	core.notes = [{ id: 'note_1', text: 'mine' }];
	appState.canvasSelectedNodeId = 'note_1';
	appState.canvasMultiSelectedNodeIds = ['note_1'];
	appState.canvasMultiSelectedCount = 1;
	history.undoStack = [{ forward: [], reverse: [] }];
	markSessionUnsaved();
	expect(hasUnsavedChanges()).toBe(true);
}

describe('startNewSession', () => {
	it('asks first when there is unsaved work, and Cancel keeps everything', async () => {
		withUnsavedWork();
		const onReset = vi.fn();
		const { done: p } = await begin(onReset);

		expect(appState.showAYSModal).toBe(true);
		expect(appState.AYStext).toMatch(/discard/i);
		expect(appState.AYSoptions).toEqual([NEW_SESSION_LABEL, 'Cancel']);

		appState.AYScallback('Cancel');
		appState.showAYSModal = false;
		flushSync();

		expect(await p).toBe(false);
		expect(onReset).not.toHaveBeenCalled();
		expect(core.data).toEqual([{ id: 3 }]);
		expect(core.notes).toHaveLength(1);
		expect(history.undoStack).toHaveLength(1);
	});

	it('closing the dialog with Escape (no choice) also keeps everything', async () => {
		withUnsavedWork();
		const onReset = vi.fn();
		const { done: p } = await begin(onReset);
		appState.showAYSModal = false; // Escape closes the native dialog without a callback
		flushSync();
		expect(await p).toBe(false);
		expect(onReset).not.toHaveBeenCalled();
		expect(core.data).toHaveLength(1);
	});

	it('confirming empties the session, clears undo and selection, and calls onReset', async () => {
		withUnsavedWork();
		const onReset = vi.fn();
		const { done: p } = await begin(onReset);

		appState.AYScallback(NEW_SESSION_LABEL);
		appState.showAYSModal = false;
		flushSync();

		expect(await p).toBe(true);
		expect(onReset).toHaveBeenCalledTimes(1);
		expect(core.data).toEqual([]);
		expect(core.notes).toEqual([]);
		expect(history.undoStack).toEqual([]);
		expect(history.isLoading).toBe(false);
		expect(appState.canvasSelectedNodeId).toBeNull();
		expect(appState.canvasMultiSelectedNodeIds).toEqual([]);
		expect(appState.canvasMultiSelectedCount).toBe(0);
		// An empty session is never "unsaved", so closing the tab now does not prompt.
		expect(hasUnsavedChanges()).toBe(false);
	});

	it('does not ask when the open session is already saved', async () => {
		core.data = [{ id: 3 }];
		markSessionSaved();
		const onReset = vi.fn();
		const { done: p } = await begin(onReset);
		expect(appState.showAYSModal).toBe(false);
		expect(await p).toBe(true);
		expect(core.data).toEqual([]);
		expect(onReset).toHaveBeenCalledTimes(1);
	});

	it('the new session is measured from empty, so work that happens to match the old shape still counts', async () => {
		core.data = [{ id: 3 }];
		markSessionSaved();
		await (
			await begin()
		).done;
		// Same shape as the saved file of the PREVIOUS session, but it is new, unsaved work.
		core.data = [{ id: 3 }];
		expect(hasUnsavedChanges()).toBe(true);
	});

	it('does not ask on an empty session, and still hands back to the start screen', async () => {
		const onReset = vi.fn();
		expect(await (await begin(onReset)).done).toBe(true);
		expect(appState.showAYSModal).toBe(false);
		expect(onReset).toHaveBeenCalledTimes(1);
	});

	it('bumps the viewport epoch so a mounted canvas re-adopts the reset viewport', async () => {
		appState.workflowViewport = { x: 300, y: -40, z: 2 };
		appState.canvasOffset = { x: 10, y: 10 };
		appState.canvasScale = 3;
		const epoch = appState.viewportEpoch;
		await (
			await begin()
		).done;
		expect(appState.viewportEpoch).toBe(epoch + 1);
		expect(appState.workflowViewport).toEqual({ x: 0, y: 0, z: 1 });
		expect(appState.canvasOffset).toEqual({ x: 0, y: 0 });
		expect(appState.canvasScale).toBe(1);
	});
});
