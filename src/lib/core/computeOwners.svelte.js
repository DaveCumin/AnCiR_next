// @ts-nocheck
// Which nodes currently have a VISIBLE instance that computes them.
//
// Every analysis node (table process, free column process) computes inside its own
// component, and so does every plot that publishes metric output ports (Periodogram,
// FFT, Correlogram, Q-Q, Actogram). A node whose component is not mounted does not
// compute: its outputs keep whatever was last written (or whatever the session file
// held) while its inputs move on. That happens whenever the visible component is not
// on screen: a node collapsed on the canvas, a member of a collapsed composite, a plot
// hidden from the workspace, and, in the plots view, every node that is not selected.
//
// NodeComputeHost closes that gap by mounting a hidden, compute-only instance of the
// SAME component for every such node. To keep exactly one instance computing a node,
// the host must know which nodes are already mounted somewhere visible. That is this
// registry: each mount site that renders a node's computing instance (the canvas editor
// panel, the control panel, a plot preview, a workspace plot card, a facet generator's
// headless instance) claims the node's key for as long as it is mounted, and the host
// mounts its own instance only for keys nobody claims.
//
// Claims are COUNTED, not flagged: a table process expanded on the canvas AND selected
// in the control panel has two visible instances, and collapsing one of them must not
// make the host think the node went unmounted. Those two share one computation per
// input hash through the node memo (computeMemo.js); the host adds no third.
//
// Keys are the canvas node ids (`tableprocess_<id>`, `process_<id>`, `plot_<id>`), so
// the three id spaces cannot collide.
import { untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

/** key -> number of mounted visible instances */
const owners = new SvelteMap();

/** The registry key for a node of `kind` ('tableprocess' | 'process' | 'plot') with `id`. */
export function computeKey(kind, id) {
	return id == null ? null : `${kind}_${id}`;
}

/** True while at least one visible instance of `key` is mounted. Reactive. */
export function hasComputeOwner(key) {
	return (owners.get(key) ?? 0) > 0;
}

/** Number of visible instances claiming `key`. Reactive. For tests and diagnostics. */
export function computeOwnerCount(key) {
	return owners.get(key) ?? 0;
}

/**
 * Claim `key` for one visible instance. Returns the release function, which is safe
 * to call more than once (a teardown can run twice when an attachment re-runs).
 */
export function claimComputeOwner(key) {
	if (key == null) return () => {};
	// Untracked: claims are made from effects and attachments, and reading the count
	// there would make the claiming effect depend on the very entry it writes (an
	// effect_update_depth_exceeded loop).
	untrack(() => owners.set(key, (owners.get(key) ?? 0) + 1));
	let released = false;
	return () => {
		if (released) return;
		released = true;
		untrack(() => {
			const n = (owners.get(key) ?? 1) - 1;
			if (n <= 0) owners.delete(key);
			else owners.set(key, n);
		});
	};
}

/**
 * Attachment for a mount site: `<div {@attach computeOwner(key)}>` claims `key` while
 * the element is mounted and releases it on unmount (or when `key` changes).
 */
export function computeOwner(key) {
	return () => claimComputeOwner(key);
}

/** Test seam: forget every claim. */
export function _resetComputeOwners() {
	owners.clear();
}
