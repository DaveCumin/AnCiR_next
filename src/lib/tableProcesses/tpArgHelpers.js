// @ts-nocheck
// Shared helpers for table-process argument handling. Every multi-Y table
// process needs the same three chores: migrate legacy scalar yIN args from old
// sessions, normalize yIN for reading, and backfill args that didn't exist when
// an old session was saved. Keeping them here stops the copies drifting apart.
import { expandColumnRefs } from '$lib/tableProcesses/columnSet.js';

/**
 * Normalize a `yIN` arg to an array of column ids for reading.
 * Handles the legacy scalar form (old sessions stored a single id, with -1
 * meaning "none") as well as the current array form, AND expands any Column Set
 * reference tokens (`{ setRef }`) to the referenced set's currently-selected
 * column ids — so every multi-Y `func` that reads through here transparently
 * receives real columns when a column set is wired in. Does not mutate.
 * @param {number|Array<number|{setRef:number}>|null|undefined} yIN
 * @returns {number[]}
 */
export function normalizeYInputs(yIN) {
	const arr = Array.isArray(yIN) ? yIN : yIN != null && yIN !== -1 ? [yIN] : [];
	return expandColumnRefs(arr);
}

/**
 * Migrate a legacy scalar `args.yIN` (sessions saved before multi-Y) to the
 * array form, in place. Call once when the component instantiates.
 * @param {object} args - the table process's `p.args`
 */
export function migrateLegacyYIN(args) {
	if (typeof args?.yIN === 'number') {
		args.yIN = args.yIN !== -1 ? [args.yIN] : [];
	}
}

/**
 * Backfill args that are absent from `args` (a session saved before the field
 * existed) with the definition defaults. Only entries shaped `{ val }` are
 * filled — structured entries like `out` (seeded by the TableProcess
 * constructor) are left alone. Object/array defaults are cloned so process
 * instances never share a default by reference.
 * @param {object} args - the table process's `p.args` (mutated in place)
 * @param {Map<string, {val: any}>} defaults - the definition's defaults Map
 */
export function fillDefaults(args, defaults) {
	for (const [key, def] of defaults) {
		if (!def || !Object.prototype.hasOwnProperty.call(def, 'val')) continue;
		if (args[key] !== undefined) continue;
		const v = def.val;
		args[key] = v !== null && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
	}
}
