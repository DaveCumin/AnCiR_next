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
 * Write `data` into the output column `colId`. No-ops (returning false) for
 * unwired ports (null/-1) and missing columns, matching the guards every TP
 * hand-rolled before this existed.
 * @param {number} colId - the id stored in `args.out[key]`
 * @param {any[]} data - the column data to write
 * @param {object} [opts]
 * @param {string} [opts.type='number'] - column type ('number' | 'time' | ...)
 * @param {string} [opts.processHash] - stamped on col.tableProcessGUId so
 *   consumers' hashes change; share one hash across all of a run's outputs
 * @param {any} [opts.timeFormat] - set col.timeFormat when provided (pass null
 *   for raw-ms time columns); omitted = leave untouched
 * @returns {boolean} true if the column existed and was written
 */
export function writeOutputColumn(colId, data, { type = 'number', processHash, timeFormat } = {}) {
	if (colId == null || colId === -1) return false;
	const col = getColumnById(colId);
	if (!col) return false;
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
