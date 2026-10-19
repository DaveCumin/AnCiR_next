// @ts-nocheck
// A user's edit to the session's appearance map (Settings > Data appearance), as ONE undo
// step and an unsaved change.
//
// The map's own helpers (appearanceIdentity.js: setEditedAppearance, releaseAppearance) are
// plain writes, because the pinning effect calls them on every pass and must never record
// anything. An edit the USER makes is different: it goes through this wrapper, which lets the
// helper write, puts the map back, and applies the difference as a `setAppearanceMaps`
// operation (operations.js), the same operation "Apply to all plots" records the map with.
//
// A colour-picker drag writes many times a second; those writes share a coalesceKey so a quick
// run on one row's colour is one step (opHistory merges keyed batches inside its window).
import { core } from '$lib/core/core.svelte.js';
import { applyOp } from '$lib/core/operations.js';

const clone = (v) => JSON.parse(JSON.stringify(v ?? {}));

/**
 * Run `mutate()` (writes onto core.seriesAppearance) and record what it changed.
 *
 * @param {() => void} mutate
 * @param {{ coalesceKey?: string }} [opts]
 * @returns the inverse operation, or null when nothing changed
 */
export function recordAppearanceEdit(mutate, { coalesceKey } = {}) {
	const before = clone(core.seriesAppearance);
	mutate();
	const after = clone(core.seriesAppearance);
	if (JSON.stringify(before) === JSON.stringify(after)) return null;
	core.seriesAppearance = before;
	const op = { kind: 'setAppearanceMaps', series: after };
	return applyOp(coalesceKey ? { kind: 'batch', ops: [op], coalesceKey } : op);
}
