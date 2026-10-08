// @ts-nocheck
// "New session": throw the open session away and go back to the start screen.
//
// Reached from the Navbar's New session button and Cmd/Ctrl+Alt+N (+page.svelte). The emptying
// itself is resetSession (sessionLoad.svelte.js), the same reset a session load runs, so a new
// session can never quietly keep a slice the reset forgot. What is particular to a new session
// is everything around it:
//
//   - It asks first, but only when there is UNSAVED work (hasUnsavedChanges). A session that is
//     already in a file loses nothing, and a prompt on every press teaches people to click
//     through it (the same reasoning as the close-tab guard).
//   - Undo is cleared: the previous session's ops would hit unrelated nodes once ids are reused.
//   - Selection, hidden plots and both viewports go back to a fresh page's values; user
//     preferences in appState (panels, view, timezone, palette) are kept.
//   - The caller's onReset runs last. +page uses it to re-arm the start screen, which a user may
//     have dismissed earlier in this session.
import { appState } from './core.svelte.js';
import { resetSession, confirmDiscard } from './sessionLoad.svelte.js';
import { hasUnsavedChanges, markSessionSaved } from './unsavedChanges.svelte.js';
import { history } from './opHistory.svelte.js';
import { paramDiffWatcher } from './paramDiffWatcher.svelte.js';

export const NEW_SESSION_LABEL = 'New session';

let inFlight = false;

/**
 * Ask (when there is unsaved work), then empty the session.
 *
 * @param {{ onReset?: () => void }} [opts]  called once the session is empty.
 * @returns {Promise<boolean>} true when the session was reset, false when the user cancelled.
 */
export async function startNewSession({ onReset } = {}) {
	// A second press while the question is up must not stack a second dialog.
	if (inFlight) return false;
	inFlight = true;
	try {
		if (hasUnsavedChanges()) {
			const ok = await confirmDiscard(
				'Start a new session? Unsaved changes will be discarded.',
				NEW_SESSION_LABEL
			);
			if (!ok) return false;
		}
		// Undo and recording are off while the session is torn down, exactly as for a load:
		// the teardown is not a user step, and the old stack cannot apply to what follows.
		history.beginLoad();
		try {
			resetSession();
			appState.canvasSelectedNodeId = null;
			appState.canvasMultiSelectedNodeIds = [];
			appState.canvasMultiSelectedCount = 0;
			appState.invisiblePlotIds = [];
			appState.canvasOffset = { x: 0, y: 0 };
			appState.canvasScale = 1;
			appState.workflowViewport = { x: 0, y: 0, z: 1 };
			// Tell an already mounted canvas to adopt the viewport above (see importJson).
			appState.viewportEpoch = (appState.viewportEpoch ?? 0) + 1;
			// Let the effects the reset sets off run inside the load window.
			await new Promise((r) => setTimeout(r, 0));
			paramDiffWatcher.rebaseSnapshot();
			history.clear();
		} finally {
			history.endLoad();
		}
		markSessionSaved();
		onReset?.();
		return true;
	} finally {
		inFlight = false;
	}
}
