// cellEdit.js
//
// One committed edit of a Table plot data cell (the header cell, which renames the column, stays
// in Tableplot.svelte). Pure apart from the writes it is handed, so it is unit-testable without a
// session.
//
//   number / category  recorded as an Edit value process on the column, through the op history
//                      (`addProcess` / `setProcessArg`), so every edit is one undo step.
//   time               written into the column's raw series through the `setRawCell` op, so it
//                      is one undo step too.
//
// What is stored follows utils/cellEntry.js: a blank entry is null (missing), a number column
// only ever gets a finite number, a category keeps its text. An entry that cannot be stored is
// refused with a reason, and nothing is written.
import dayjs from '$lib/utils/time/dayjsSetup.js';
import { isBlankEntry, parseCellEntry, upsertEdit } from '$lib/utils/cellEntry.js';

/** The format the Table plot shows UNIX-ms time cells in, and so the one it reads back. */
export const TIME_CELL_FORMAT = 'DD MMM YYYY HH:mm:ss';

/**
 * @param {object} column        the Column being edited
 * @param {number} rowIndex      0-based row
 * @param {string} text          what the user committed
 * @param {{rawData: Map, addProcess: Function, setProcessArg: Function, setRawCell: Function}} deps
 *   `addProcess(columnId, name, args)`, `setProcessArg(columnId, procId, key, value)` and
 *   `setRawCell(columnId, row, value)` are the mutationService ops in the app. `rawData` is only
 *   read here.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function applyCellEdit(
	column,
	rowIndex,
	text,
	{ rawData, addProcess, setProcessArg, setRawCell }
) {
	if (column.type === 'time' && !column.isReferencial() && column.compression !== 'awd') {
		return editTimeCell(column, rowIndex, text, rawData, setRawCell);
	}

	const parsed = parseCellEntry(column.type, text);
	if (!parsed.ok) return parsed;

	const position = rowIndex + 1; // Edit value positions are 1-based row numbers
	const last = column.processes?.at(-1);
	if (last?.name === 'EditValue') {
		setProcessArg(
			column.id,
			last.id,
			'edits',
			upsertEdit(last.args?.edits, position, parsed.value)
		);
	} else {
		addProcess(column.id, 'EditValue', { edits: upsertEdit([], position, parsed.value) });
	}
	return { ok: true };
}

function editTimeCell(column, rowIndex, text, rawData, setRawCell) {
	const rawArr = rawData.get(column.data);
	if (!Array.isArray(rawArr) || rowIndex >= rawArr.length) return { ok: true };

	let value;
	if (isBlankEntry(text)) {
		value = null; // Column.getData keeps a blank time as a gap
	} else if (holdsUnixMs(rawArr)) {
		// UNIX ms (a node's time output): read the displayed format back to ms.
		const dt = dayjs.utc(String(text).trim(), TIME_CELL_FORMAT, true);
		if (!dt.isValid()) {
			return {
				ok: false,
				reason: `"${String(text).trim()}" is not a time this column can read. Enter it as ${TIME_CELL_FORMAT} (for example 01 Jan 2024 13:30:00), or clear the cell to mark it as missing.`
			};
		}
		value = dt.valueOf();
	} else {
		// Imported time text: store what was typed; the column parses it with its own format.
		value = String(text);
	}
	setRawCell(column.id, rowIndex, value);
	return { ok: true };
}

/** A series of UNIX ms, judged on its first present value (row 0 may have been cleared). */
function holdsUnixMs(arr) {
	const first = arr.find((v) => !isBlankEntry(v));
	return typeof first === 'number';
}

/**
 * Why the Table may not edit `column`'s cells, or null when it may (UI-17). Only data the user
 * owns is editable: an imported column, or a column built on one (whose own process chain an
 * Edit value process joins). A node's output is recomputed from its inputs, so an edit stored on
 * it (an Edit value process) would override the same row POSITION through every recompute and
 * reach every plot downstream; it is read-only, and the reason says where to change it instead.
 *
 * @param {object} column  the Column
 * @param {{kind: 'tableprocess' | 'plot', owner: object} | undefined} owner  the column's entry
 *   in buildColumnOwnerIndex (core/outputLabels.js), when a node outputs it
 * @returns {string | null}
 */
export function cellReadOnlyReason(column, owner) {
	if (!column) return null;
	if (column.type === 'bin') {
		return 'Bin cells are computed from the bin start and width, so they are read-only.';
	}
	if (owner?.kind === 'tableprocess') {
		const label = owner.owner?.displayName || owner.owner?.name || 'an analysis node';
		if (owner.owner?.name === 'BlankColumn') {
			return `Entered in the ${label} node: edit the values there.`;
		}
		return `Computed by ${label}: change its inputs or settings instead.`;
	}
	if (owner?.kind === 'plot') {
		return `Computed by ${owner.owner?.name || 'a plot'}: change its inputs or settings instead.`;
	}
	if (column.producerNodeId != null && column.refId == null && column.data == null) {
		return 'Computed by a process node: change its inputs or settings instead.';
	}
	return null;
}
