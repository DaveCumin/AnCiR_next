// @ts-nocheck
// A new binned periodogram's bin size follows its x (v80.1, SPEC-8).
//
// Chi-squared and Enright average the data into bins of `pgBinSize` hours before folding. The
// flat 0.25 h default suits 15 min data and nothing else: on hourly data three of every four
// bins are empty, and on 1 min data fifteen samples are averaged into each bin. So a NEW
// Rhythmicity Analysis or Moving Analysis node starts with the series' median sampling
// interval (one sample per bin), written into `pgBinSize` once its x is known.
//
// WHICH NODES FOLLOW THEIR X. Only one carrying `pgBinSizeAuto: true`, which comes from the
// definition's `newNodeArgs` (buildTableProcessDefaults: the palette and the in-app AI edit),
// never from `defaults` (fillDefaults would stamp it onto every saved session's node on load
// and silently change its spectrum). A loaded node without the flag keeps its stored bin size,
// or the 0.25 h that fillDefaults gives one saved without it, exactly as before.
//
// The compute functions, the MCP engine and the Python / R ports never read the flag: the node
// writes the resolved number into `pgBinSize`, so a saved session always carries the bin size
// its results came from. The first edit of the bin size clears the flag. Same design as the
// free-period fits' periodRangeAuto (periodRangeAuto.svelte.js); the Periodogram plot does
// the same per series (PeriodogramDataclass.binSizeAuto).
import { untrack } from 'svelte';
import { medianSamplingInterval } from '$lib/utils/periodogram.js';

/**
 * The args a new node starts with, on top of its defaults. An AI edit that names a bin size
 * keeps it: only a node created without one follows its x.
 * @param {object} [explicit]  args the creator set explicitly (an AI edit's params)
 */
export function newBinSizeArgs(explicit = {}) {
	return { pgBinSizeAuto: explicit?.pgBinSize == null };
}

/**
 * The x a node's analyses see, in hours for a time column (as the compute functions use it).
 * @param {object|null} xCol
 */
function xHours(xCol) {
	if (!xCol) return [];
	return (xCol.type === 'time' ? xCol.hoursSinceStart : xCol.getData?.()) ?? [];
}

/**
 * Write the median sampling interval into `args.pgBinSize` when the node follows its x.
 * Returns true when it changed anything; a remount over the same data writes nothing.
 * @param {object} args  the node's p.args
 * @param {object|null} xCol  the x column
 */
export function applyAutoBinSize(args, xCol) {
	if (!args?.pgBinSizeAuto || !xCol) return false;
	const dt = medianSamplingInterval(xHours(xCol));
	if (!(dt > 0) || !Number.isFinite(dt) || args.pgBinSize === dt) return false;
	args.pgBinSize = dt;
	return true;
}

/**
 * Component hook: keep a following node's bin size on its x. Re-runs when the flag, the x
 * column, its type or its data change; NOT when the bin size itself changes, so undoing the
 * automatic write does not re-trigger it.
 * @param {{args: object}} p  the table process
 * @param {() => object|null} getXCol  returns the x column (reactive read)
 */
export function useBinSizeAuto(p, getXCol) {
	$effect(() => {
		if (!p.args.pgBinSizeAuto) return;
		const col = getXCol();
		if (!col) return;
		void col.type;
		void col.getDataHash;
		untrack(() => applyAutoBinSize(p.args, col));
	});
}

/** Call from the bin size input's onInput: an edit makes the bin size the user's. */
export function stopFollowingSampling(args) {
	if (args?.pgBinSizeAuto) args.pgBinSizeAuto = false;
}
