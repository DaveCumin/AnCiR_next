// @ts-nocheck
// Shared helpers for table-process argument handling. Every multi-Y table
// process needs the same three chores: migrate legacy scalar yIN args from old
// sessions, normalize yIN for reading, and backfill args that didn't exist when
// an old session was saved. Keeping them here stops the copies drifting apart.

/**
 * Normalize a `yIN` arg to an array of column ids for reading.
 * Handles the legacy scalar form (old sessions stored a single id, with -1
 * meaning "none") as well as the current array form. Pure — does not mutate.
 * @param {number|number[]|null|undefined} yIN
 * @returns {number[]}
 */
export function normalizeYInputs(yIN) {
	if (Array.isArray(yIN)) return yIN;
	return yIN != null && yIN !== -1 ? [yIN] : [];
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
 * Rename an output KEY in `args.out` while keeping its column id — the
 * anti-orphaning move for output REKEYING (metricOutputs.js names rekeying as
 * the classic hazard): wires point at `col_<colId>` ports, so as long as the
 * column id survives under the new key, every downstream consumer stays wired.
 * Idempotent, and a no-op when the new key already exists (a session saved
 * after the rename, or one that somehow carries both). Call it both where the
 * component instantiates AND at the top of the engine func, so headless
 * callers (MCP engine, doProcess) migrate old sessions too.
 * @param {object} args - the table process's `p.args` (mutated in place)
 * @param {string} oldKey
 * @param {string} newKey
 * @returns {boolean} true when a rename happened
 */
export function migrateRenamedOutKey(args, oldKey, newKey) {
	const out = args?.out;
	if (!out || typeof out !== 'object') return false;
	if (out[newKey] !== undefined || out[oldKey] === undefined) return false;
	out[newKey] = out[oldKey];
	delete out[oldKey];
	return true;
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
