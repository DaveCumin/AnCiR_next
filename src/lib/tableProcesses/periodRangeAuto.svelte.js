// @ts-nocheck
// A new free-period fit's period range follows its x (v80.1).
//
// The free-period fits (Cosinor, Rectangular wave, Double logistic, Fit waveform model) search
// for the period inside [minPeriod, maxPeriod]. The default, 1 to 48, assumes x is in hours.
// On a plain number x it is meaningless: on an x in days a 1-day rhythm sits exactly on the
// lower limit (the report that prompted this), and on an x in minutes the whole range is
// shorter than one cycle. So a NEW node's range follows its x: 1 to 30 h for a time column
// (NEW_NODE_TIME_PERIOD_RANGE, since v82.30; 1 to 48 h before), and the Nyquist period to the
// record span for a number column (utils/periodUnits.js).
//
// WHICH NODES FOLLOW THEIR X. Only one carrying `periodRangeAuto: true`. That flag is NOT in
// the node's `defaults` Map (fillDefaults would then add it to every saved session's node on
// load, and the numbers of a session saved with no range, e.g. the shipped Rectangular wave
// and Double logistic demos, would silently change). It comes from the definition's
// `newNodeArgs`, which buildTableProcessDefaults applies when the palette or the in-app AI
// edit creates a node. A loaded node without the flag keeps the stored range, or the 1 to 48
// fillDefaults gives it, exactly as before (periodRange.svelte.test.js). A node saved while
// following its x carries the flag AND the numbers it computed with, so a time-x node saved
// with 1 to 48 before v82.30 moves to 1 to 30 on its next mount (its range was the default,
// never the user's).
//
// The compute functions, the MCP engine and the Python / R ports never read the flag: the
// node writes the resolved numbers into minPeriod / maxPeriod, so a saved session always
// carries the range its results came from. The first edit of either bound clears the flag;
// the range is the user's from then on.
import { untrack } from 'svelte';
import { autoPeriodRange } from '$lib/utils/periodUnits.js';
import { FREE_PERIOD_DEFAULTS } from '$lib/utils/cosinor.js';

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

/** The free-period fits whose new nodes follow their x. */
export const FREE_PERIOD_FIT_NODES = Object.freeze([
	'Cosinor',
	'RectangularWave',
	'DoubleLogistic',
	'FitFunction'
]);

/**
 * Sessions saved while a node followed a TIME x at the old 1 to 48 h (v80.1 to v82.29) keep
 * that range. Before v82.30 a following node on a time x always stored 1 to 48; from v82.30
 * the same node would move to 1 to 30 on its first mount, silently changing a saved result
 * (and parting from the Python and R ports, which read the stored numbers). So on load such a
 * node stops following: the flag is cleared and 1 to 48 stays.
 *
 * No version check is needed: from v82.30 a node following a time x stores 1 to 30, never
 * 1 to 48, so a following time-x node at exactly 1 to 48 can only come from before. A node on
 * a number x is untouched (its range is the Nyquist period to the span, whatever release).
 *
 * Pure (JSON in, JSON out); the input is not mutated, a changed node is copied. Run by
 * importJson before anything is built.
 * @param {object} json  a saved session
 * @returns {{json: object, migrated: number}}
 */
export function migrateLegacyAutoPeriodRange(json) {
	const tps = Array.isArray(json?.tableProcesses) ? json.tableProcesses : null;
	if (!tps) return { json, migrated: 0 };
	const cols = Array.isArray(json.data) ? json.data : [];
	const isTimeCol = (id) => cols.some((c) => c?.type === 'time' && String(c.id) === String(id));
	let migrated = 0;
	const next = tps.map((tp) => {
		const a = tp?.args;
		if (!FREE_PERIOD_FIT_NODES.includes(tp?.name) || a?.periodRangeAuto !== true) return tp;
		if (!isTimeCol(a.xIN)) return tp;
		if (a.minPeriod !== FREE_PERIOD_DEFAULTS.minPeriod) return tp;
		if (a.maxPeriod !== FREE_PERIOD_DEFAULTS.maxPeriod) return tp;
		migrated++;
		return { ...tp, args: { ...a, periodRangeAuto: false } };
	});
	return migrated ? { json: { ...json, tableProcesses: next }, migrated } : { json, migrated };
}
