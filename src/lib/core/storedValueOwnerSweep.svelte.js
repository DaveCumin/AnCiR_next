// Releases stored values whose node or plot has been deleted while none of its
// buttons was mounted (see "THE NODE OWNS THE VALUE" in storedValueClaims.js).
//
// Reactive on the session's node and plot ids rather than hooked into each deletion
// path: nodes leave the session through the canvas, the Data view, undo/redo patches
// and session loads, and these share no code.
import { untrack } from 'svelte';
import { core } from './core.svelte.js';
import { sweepStoredValueOwners } from './storedValueClaims.js';

let started = false;

/**
 * Start the watcher once; storedValueClaims calls this when it first retains a value.
 * Deferred to a microtask: the call comes from a button's teardown, where no effect can
 * be created.
 */
export function ensureStoredValueOwnerSweep() {
	if (started) return;
	started = true;
	queueMicrotask(startWatcher);
}

function startWatcher() {
	$effect.root(() => {
		$effect(() => {
			// The dependency: every node and plot id in the session.
			for (const tp of core.tableProcesses ?? []) void tp?.id;
			for (const p of core.plots ?? []) void p?.id;
			untrack(() => sweepStoredValueOwners());
		});
	});
}
