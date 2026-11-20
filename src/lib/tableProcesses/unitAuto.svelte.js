// @ts-nocheck
// A new Rayleigh test reads the unit of its angles from the data.
//
// `unit` says what the wired values are: radians, degrees or clock hours. The flat default,
// radians, is wrong for the commonest input (acrophases in clock hours), and nothing about the
// result says so. So a NEW node starts with the unit its values most likely are in
// (utils/angleUnit.js inferAngleUnit), written into `unit` once its columns hold data.
//
// WHICH NODES FOLLOW THEIR DATA. Only one carrying `unitAuto: true`, which comes from the
// definition's `newNodeArgs` (buildTableProcessDefaults: the palette and the in-app AI edit),
// never from `defaults` (fillDefaults would stamp it onto every saved session's node on load
// and silently change its results). A loaded node without the flag keeps its stored unit, or
// the radians that fillDefaults gives one saved without it, exactly as before. A node created
// with an explicit unit (an AI edit or an MCP call that names one) does not follow either.
//
// The compute function, the MCP engine and the Python / R ports never read the flag: the node
// writes the resolved unit into `unit`, so a saved session always carries the unit its results
// came from. The first time the user picks a unit the flag is cleared, and it is never set
// again. Same design as the binned periodograms' bin size (binSizeAuto.svelte.js).
//
// With a time column wired the values are weights, not angles, and `unit` is not used: nothing
// is inferred then.
import { untrack } from 'svelte';
import { inferAngleUnit } from '$lib/utils/angleUnit.js';
import { mutationService } from '$lib/core/mutationService.js';
import { paramDiffWatcher } from '$lib/core/paramDiffWatcher.svelte.js';

/**
 * The args a new node starts with, on top of its defaults. A creator that names a unit keeps
 * it: only a node created without one follows its data.
 * @param {object} [explicit]  args the creator set explicitly (an AI edit's params)
 */
export function newUnitArgs(explicit = {}) {
	return { unitAuto: explicit?.unit == null };
}

/**
 * Write the inferred unit into `args.unit` when the node follows its data. Returns true when
 * it changed anything; a remount over the same data writes nothing.
 * @param {object} args  the node's p.args
 * @param {object[]} yCols  the wired angle columns
 * @param {boolean} [timed=false]  a time column is wired (the values are then not angles)
 */
export function applyAutoUnit(args, yCols, timed = false) {
	if (!args?.unitAuto || timed || !yCols?.length) return false;
	const unit = inferAngleUnit(
		yCols.map((c) => c?.getData?.() ?? []),
		args.period
	);
	if (!unit || args.unit === unit) return false;
	args.unit = unit;
	return true;
}

/**
 * Component hook: keep a following node's unit on its data. Re-runs when the flag, the wired
 * columns, their data or the period change; NOT when the unit itself changes, so undoing the
 * automatic write does not re-trigger it.
 * @param {{args: object}} p  the table process
 * @param {() => object[]} getYCols  returns the wired angle columns (reactive read)
 * @param {() => boolean} isTimed  whether a time column is wired (reactive read)
 */
export function useUnitAuto(p, getYCols, isTimed) {
	$effect(() => {
		if (!p.args.unitAuto) return;
		if (isTimed()) return;
		const cols = getYCols();
		for (const col of cols) void col?.getDataHash;
		void p.args.period;
		untrack(() => {
			// The node's own write, not an edit: no undo step of its own (undoing the wiring
			// that caused it is the step, and the unit is read again on the next wiring).
			if (applyAutoUnit(p.args, cols)) paramDiffWatcher.followOwnWrite(p.id, 'unit');
		});
	});
}

/**
 * The user picks a unit on a node that was following its data: from then on the unit is
 * theirs. The choice and the end of the following are one undo step, so one undo gives back
 * both the unit and the following.
 * @param {{id: number, args: object}} p  the table process
 * @param {string} unit
 */
export function takeOverUnit(p, unit) {
	mutationService.atomicBatch([
		{ kind: 'setFreeTableProcessArg', tpId: p.id, key: 'unitAuto', value: false },
		{ kind: 'setFreeTableProcessArg', tpId: p.id, key: 'unit', value: unit }
	]);
}
