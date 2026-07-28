// @ts-nocheck
// Shared output-column writers for table processes. Every TP that produces
// output columns repeats the same dance per column: look it up, stash the data
// in core.rawData, point col.data at itself, set the type, and stamp
// tableProcessGUId so downstream consumers see the change. These helpers are
// that dance — the surrounding logic (which data goes to which out key) stays
// in each node.
//
// NOTE (see .claude/skills/ancir-new-node): output-column CREATION/reconcile is
// a separate concern — use useMultiYTP (per-Y outputs) or an isCommitted()-gated
// bespoke reconcile. These helpers only WRITE into columns that already exist.
import { getColumnById } from '$lib/core/Column.svelte';
import { core } from '$lib/core/core.svelte';

/**
 * Element-wise equality for column data.
 *
 * `Object.is` rather than `===` so NaN equals NaN: analyses emit NaN for gaps
 * and failed fits, so `===` would report the most common analysis outputs as
 * changed on every single run, which is precisely the case this exists to catch.
 *
 * Caveat: a caller that mutates its array in place and then re-writes the SAME
 * reference reads as unchanged, because rawData already holds that array and
 * there is nothing left to compare against. No caller does this today (every
 * node builds a fresh array per run), and it was equally broken before.
 */
function sameColumnData(a, b) {
	if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
	return true;
}

/**
 * Write `data` into the output column `colId`. No-ops (returning false) for
 * unwired ports (null/-1) and missing columns, matching the guards every TP
 * hand-rolled before this existed.
 *
 * IDEMPOTENT: a write that would not change the column is skipped entirely.
 * This matters far more than it looks. `Column.getDataHash` is a monotonic
 * counter that only reports "a dependency of mine was touched" — it carries no
 * information about the data — and both `core.rawData.set` and the
 * `tableProcessGUId` stamp are such dependencies. Since every caller generates
 * `processHash` with a fresh `crypto.randomUUID()` per run, a node that
 * recomputed and produced byte-identical output used to invalidate every
 * consumer downstream, which recomputed and invalidated ITS consumers, and so
 * on. Comparing the data here is the one place the content is actually known,
 * and it costs a linear scan against a write that is already linear.
 *
 * @param {number} colId - the id stored in `args.out[key]`
 * @param {any[]} data - the column data to write
 * @param {object} [opts]
 * @param {string} [opts.type='number'] - column type ('number' | 'time' | ...)
 * @param {string} [opts.processHash] - stamped on col.tableProcessGUId so
 *   consumers' hashes change; share one hash across all of a run's outputs
 * @param {any} [opts.timeFormat] - set col.timeFormat when provided (pass null
 *   for raw-ms time columns); omitted = leave untouched
 * @returns {boolean} true if the column exists and now holds `data` — including
 *   when the write was skipped as redundant. Callers use it to tell a wired port
 *   from an unwired one, not to detect that bytes moved.
 */
export function writeOutputColumn(colId, data, { type = 'number', processHash, timeFormat } = {}) {
	if (colId == null || colId === -1) return false;
	const col = getColumnById(colId);
	if (!col) return false;
	// Every field the write would touch must already match, not just the data:
	// a type or timeFormat change alters how the same numbers are read.
	if (
		col.data === colId &&
		col.type === type &&
		(timeFormat === undefined || col.timeFormat === timeFormat) &&
		sameColumnData(core.rawData.get(colId), data)
	) {
		return true;
	}
	core.rawData.set(colId, data);
	col.data = colId;
	col.type = type;
	if (timeFormat !== undefined) col.timeFormat = timeFormat;
	if (processHash != null) col.tableProcessGUId = processHash;
	return true;
}

/**
 * Write a fit/analysis X output, converting hours-since-origin back to UNIX ms
 * when the source X was a time column (originTime_ms set). Matches the pattern
 * shared by Cosinor/TrendFit/FitFunction: time X → ms data + type 'time' +
 * timeFormat null; plain X → data as-is + type 'number'.
 * @param {number} colId - the id stored in the x out key
 * @param {number[]} xOutData - hours-since-origin (time X) or raw x values
 * @param {object} [opts]
 * @param {number|null} [opts.originTime_ms=null] - origin from the compute
 *   result; null/undefined means the X was not a time column
 * @param {string} [opts.processHash]
 * @returns {boolean} true if the column existed and was written
 */
export function writeXOutput(colId, xOutData, { originTime_ms = null, processHash } = {}) {
	const isTime = originTime_ms != null;
	const data = isTime ? xOutData.map((h) => originTime_ms + h * 3600000) : xOutData;
	return writeOutputColumn(colId, data, {
		type: isTime ? 'time' : 'number',
		timeFormat: isTime ? null : undefined,
		processHash
	});
}
