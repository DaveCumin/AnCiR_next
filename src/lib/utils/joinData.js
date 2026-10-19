// @ts-nocheck
/**
 * Join Data, the maths: every row of A and every row of B on ONE time column.
 *
 * No matching, no merging, no tolerance, no grid (David, 2026-10-17, plan
 * "2026-10-17-merge-datasets-time-join-plan.md", the REVISED note). Rows that share a time stay
 * separate rows; the user bins as a next step (Bin Data), which combines them.
 *
 *  - Order: by time, ascending. Stable: at equal times A's rows come before B's, and each side
 *    keeps its own row order.
 *  - A row whose time is missing (isInvalidValue: null, blank, NaN) cannot be placed on the
 *    time axis, so it is DROPPED and counted (droppedA / droppedB); the node says so.
 *  - Values: a paired output (joinPairing.js) holds A's value on A's rows and B's on B's; an
 *    A-only output is blank (null) on B's rows, a B-only one on A's rows. A missing cell is null,
 *    never 0. A value column shorter than its time column reads blank past its end.
 *  - Time kinds: both real time (epoch ms), or both numbers (hours, days, any x) counting from
 *    the same origin in the same units. Mixed is refused: converting needs an origin the node
 *    cannot know. A `bin` column counts as a number (its getData() is bin centres); a category
 *    or text column is refused.
 *  - Shift: B's times move by `shiftB` before joining: hours for time columns (rounded to the
 *    whole millisecond, so the stored times stay integers), x units for numbers.
 *  - Size: more than MAX_JOIN_ROWS output rows is refused, with the shared limit wording.
 *
 * Zone-less text times parse as UTC (utils/time/TimeUtils.js parseTimeStrict), so a wall clock
 * has no daylight-saving jump inside the join: the node only compares the stored ms.
 *
 * Pure; the node (tableProcesses/JoinData.svelte) supplies the columns. No worker: a sort of
 * n + m numbers is milliseconds at the sizes the gate allows, so there is no worker path and
 * no worker size gate to cross.
 */
import { isInvalidValue } from './stats.js';
import { MAX_GRID_POINTS } from './interpolate.js';
import { isMissingCategory } from './chisquare.js';

/** The largest join, in output rows: the same limit as Interpolate's resample grid. */
export const MAX_JOIN_ROWS = MAX_GRID_POINTS;

/** Below this share of rows whose time also occurs in the other dataset, suggest Bin Data. */
export const RARE_SHARED_FRACTION = 0.1;

export const BIN_HINT =
	'A and B rarely share a time. To compare them row by row, add Bin Data after this node.';

export const NUMERIC_NOTE =
	'Numbers are joined as they are: both time columns must count from the same origin in the same units.';

/** 'time', 'number' (number or bin), or null for anything that cannot be a time axis. */
export function timeKind(type) {
	if (type === 'time') return 'time';
	if (type === 'number' || type === 'bin') return 'number';
	return null;
}

const KIND_WORD = { time: 'a time column', number: 'a number column' };

/** Why two time inputs cannot be joined, or null when they can. */
export function timeKindProblem(typeA, typeB) {
	const a = timeKind(typeA);
	const b = timeKind(typeB);
	if (!a) return `Time A is a ${typeA ?? 'unknown'} column. It needs times or numbers.`;
	if (!b) return `Time B is a ${typeB ?? 'unknown'} column. It needs times or numbers.`;
	if (a !== b) {
		return (
			`Time A is ${KIND_WORD[a]} and time B is ${KIND_WORD[b]}. Both must be times, or both ` +
			'numbers counting from the same origin in the same units; the node cannot convert between them.'
		);
	}
	return null;
}

/** The refusal for a join of `rows` rows, or null when it fits. */
export function joinTooLargeWarning(rows, maxRows = MAX_JOIN_ROWS) {
	if (!(rows > maxRows)) return null;
	return (
		`Nothing was joined: A and B together have ${rows.toLocaleString('en-US')} rows with a time, ` +
		`more than the limit of ${maxRows.toLocaleString('en-US')}. Bin or filter one of them first.`
	);
}

/** B's shift in the units its times are stored in. */
export function shiftAmount(shiftB, kind) {
	const s = Number(shiftB); // Number-ok: a parameter, not a data cell
	if (!Number.isFinite(s) || s === 0) return 0;
	return kind === 'time' ? Math.round(s * 3600000) : s;
}

/** Row indices with a time, sorted by time, ties in row order. */
function placedRows(times, shift) {
	const idx = [];
	const t = new Float64Array(times?.length ?? 0);
	for (let i = 0; i < (times?.length ?? 0); i++) {
		if (isInvalidValue(times[i])) continue;
		const v = Number(times[i]) + shift; // Number-ok: isInvalidValue checked above
		if (!Number.isFinite(v)) continue;
		t[i] = v;
		idx.push(i);
	}
	idx.sort((p, q) => t[p] - t[q] || p - q);
	return { idx, t, dropped: (times?.length ?? 0) - idx.length };
}

/**
 * A value cell, or null when missing by its column's rule: the house rule (isInvalidValue)
 * everywhere except a category column, whose cells are labels (isMissingCategory), as Wide To
 * Long and Long To Wide read them.
 */
const cell = (data, i, type) => {
	if (!data || i >= data.length) return null;
	const v = data[i];
	return (type === 'category' ? isMissingCategory(v) : isInvalidValue(v)) ? null : v;
};

/**
 * Join A and B.
 * @param {object} p
 * @param {any[]} p.timeA  A's times (getData(): epoch ms or numbers)
 * @param {any[]} p.timeB
 * @param {'time'|'number'} p.kind  the shared time kind (checked by the caller with timeKindProblem)
 * @param {Record<string, any[]>} p.dataOf  column id -> its getData()
 * @param {Record<string, string>} [p.typeOf]  column id -> its type (picks the missing rule)
 * @param {{key:string, aId:number|null, bId:number|null}[]} p.outputs  from joinPairing.joinOutputs
 * @param {number} [p.shiftB]  hours (time) or x units (number)
 * @param {[string, string]} [p.sourceLabels]
 * @param {number} [p.maxRows]
 */
export function joinData({
	timeA,
	timeB,
	kind,
	dataOf = {},
	typeOf = {},
	outputs = [],
	shiftB = 0,
	sourceLabels = ['A', 'B'],
	maxRows = MAX_JOIN_ROWS
}) {
	const A = placedRows(timeA, 0);
	const B = placedRows(timeB, shiftAmount(shiftB, kind));
	const rows = A.idx.length + B.idx.length;
	const counts = {
		rows,
		fromA: A.idx.length,
		fromB: B.idx.length,
		droppedA: A.dropped,
		droppedB: B.dropped,
		sharedTimes: 0,
		sharedRows: 0
	};
	const tooLarge = joinTooLargeWarning(rows, maxRows);
	if (tooLarge) return { ok: false, error: tooLarge, counts };

	const time = new Array(rows);
	const source = new Array(rows);
	const columns = {};
	for (const o of outputs) columns[o.key] = new Array(rows);

	let i = 0;
	let j = 0;
	for (let r = 0; r < rows; r++) {
		const takeA = i < A.idx.length && (j >= B.idx.length || A.t[A.idx[i]] <= B.t[B.idx[j]]);
		if (takeA) {
			const row = A.idx[i++];
			time[r] = A.t[row];
			source[r] = sourceLabels[0];
			for (const o of outputs) {
				columns[o.key][r] = o.aId != null ? cell(dataOf[o.aId], row, typeOf[o.aId]) : null;
			}
		} else {
			const row = B.idx[j++];
			time[r] = B.t[row];
			source[r] = sourceLabels[1];
			for (const o of outputs) {
				columns[o.key][r] = o.bId != null ? cell(dataOf[o.bId], row, typeOf[o.bId]) : null;
			}
		}
	}

	// Times present in both, and the rows that carry one (the Bin Data hint reads these).
	const inA = new Map();
	for (const row of A.idx) inA.set(A.t[row], (inA.get(A.t[row]) ?? 0) + 1);
	const inB = new Map();
	for (const row of B.idx) inB.set(B.t[row], (inB.get(B.t[row]) ?? 0) + 1);
	for (const [t, n] of inB) {
		if (!inA.has(t)) continue;
		counts.sharedTimes++;
		counts.sharedRows += n + inA.get(t);
	}
	const rareShared =
		counts.fromA > 0 && counts.fromB > 0 && counts.sharedRows / rows < RARE_SHARED_FRACTION;

	return { ok: rows > 0, time, source, columns, counts, rareShared };
}

/** The panel's summary line, e.g. "580 rows: 290 from A, 290 from B; 30 times appear in both". */
export function joinSummary(counts) {
	if (!counts) return '';
	const n = (v) => v.toLocaleString('en-US');
	const plural = (v, one, many) => `${n(v)} ${v === 1 ? one : many}`;
	let s =
		`${plural(counts.rows, 'row', 'rows')}: ${n(counts.fromA)} from A, ${n(counts.fromB)} from B; ` +
		(counts.sharedTimes === 1
			? '1 time appears in both'
			: `${n(counts.sharedTimes)} times appear in both`);
	const dropped = [];
	if (counts.droppedA) dropped.push(`${n(counts.droppedA)} in A`);
	if (counts.droppedB) dropped.push(`${n(counts.droppedB)} in B`);
	if (dropped.length) {
		const total = counts.droppedA + counts.droppedB;
		s += `. ${total === 1 ? 'A row' : 'Rows'} with no time (${dropped.join(', ')}) ${total === 1 ? 'was' : 'were'} left out`;
	}
	return s + '.';
}

/** The Bin Data size for the hint: the coarser of the two median sampling intervals. */
export function suggestedBinSize(intervalA, intervalB) {
	const ok = [intervalA, intervalB].filter((v) => Number.isFinite(v) && v > 0);
	return ok.length ? Math.max(...ok) : 1;
}
