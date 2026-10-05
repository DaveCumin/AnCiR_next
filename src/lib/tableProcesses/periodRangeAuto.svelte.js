// @ts-nocheck
// A new free-period fit's period range follows its x (v80.1).
//
// The free-period fits (Cosinor, Rectangular wave, Double logistic, Fit waveform model) search
// for the period inside [minPeriod, maxPeriod]. The default, 1 to 48, assumes x is in hours.
// On a plain number x it is meaningless: on an x in days a 1-day rhythm sits exactly on the
// lower limit (the report that prompted this), and on an x in minutes the whole range is
// shorter than one cycle. So a NEW node's range follows its x: 1 to 48 h for a time column,
// and the Nyquist period to the record span for a number column (utils/periodUnits.js).
//
// WHICH NODES FOLLOW THEIR X. Only one carrying `periodRangeAuto: true`. That flag is NOT in
// the node's `defaults` Map (fillDefaults would then add it to every saved session's node on
// load, and the numbers of a session saved with no range, e.g. the shipped Rectangular wave
// and Double logistic demos, would silently change). It comes from the definition's
// `newNodeArgs`, which buildTableProcessDefaults applies when the palette or the in-app AI
// edit creates a node. A loaded node without the flag keeps the stored range, or the 1 to 48
// fillDefaults gives it, exactly as before (periodRangeLegacy.svelte.test.js).
//
// The compute functions, the MCP engine and the Python / R ports never read the flag: the
// node writes the resolved numbers into minPeriod / maxPeriod, so a saved session always
// carries the range its results came from. The first edit of either bound clears the flag;
// the range is the user's from then on.
import { untrack } from 'svelte';
import { autoPeriodRange } from '$lib/utils/periodUnits.js';

/**
 * The args a new free-period node starts with, on top of its defaults. An AI edit that names
 * a range keeps it: only a node created without one follows its x.
 * @param {object} [explicit]  args the creator set explicitly (an AI edit's params)
 */
export function newPeriodRangeArgs(explicit = {}) {
	return { periodRangeAuto: explicit?.minPeriod == null && explicit?.maxPeriod == null };
}

/**
 * Write the auto range into `args` when the node follows its x. Pure apart from the writes;
 * returns true when it changed anything. Only writes values that differ, so a remount over the
 * same data records nothing.
 * @param {object} args  the node's p.args
 * @param {object|null} xCol  the x column
 */
export function applyAutoPeriodRange(args, xCol) {
	if (!args?.periodRangeAuto || !xCol) return false;
	const r = autoPeriodRange(xCol);
	if (!r) return false;
	let changed = false;
	if (args.minPeriod !== r.minPeriod) {
		args.minPeriod = r.minPeriod;
		changed = true;
	}
	if (args.maxPeriod !== r.maxPeriod) {
		args.maxPeriod = r.maxPeriod;
		changed = true;
	}
	return changed;
}

/**
 * Component hook: keep a following node's range on its x. Re-runs when the flag, the x column,
 * its type or its data change; NOT when the range itself changes, so undoing the automatic
 * write does not re-trigger it (that would make the undo a no-op).
 * @param {{args: object}} p  the table process
 * @param {() => object|null} getXCol  returns the x column (reactive read)
 */
export function usePeriodRangeAuto(p, getXCol) {
	$effect(() => {
		if (!p.args.periodRangeAuto) return;
		const col = getXCol();
		if (!col) return;
		// Tracked reads: what the range is derived from.
		void col.type;
		void col.getDataHash;
		untrack(() => applyAutoPeriodRange(p.args, col));
	});
}

/** Call from a bound's onInput: an edit makes the range the user's. */
export function stopFollowingX(args) {
	if (args?.periodRangeAuto) args.periodRangeAuto = false;
}
