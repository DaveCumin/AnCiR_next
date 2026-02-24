// @ts-nocheck
/**
 * Lightweight XLSX parser using fflate for zip decompression
 * and DOMParser for XML parsing.
 *
 * Replaces the heavy 'xlsx' (SheetJS) package with a minimal
 * implementation covering only the features used in this project:
 *   - read(data, { type: 'array' })
 *   - utils.decode_range(ref)
 *   - utils.sheet_to_csv(sheet, { skipHidden, blankrows })
 */

import { unzipSync } from 'fflate';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse XML string into a Document (works in browser). */
function parseXML(text) {
	return new DOMParser().parseFromString(text, 'application/xml');
}

/** Decode bytes to UTF-8 string. */
function bytesToString(bytes) {
	return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Convert a column string like "A", "Z", "AA", "AZ" to a 0-based index.
 */
function colToIndex(col) {
	let n = 0;
	for (let i = 0; i < col.length; i++) {
		n = n * 26 + (col.charCodeAt(i) - 64); // A=65 → 1
	}
	return n - 1;
}

/**
 * Convert a 0-based column index to a column letter string.
 */
function indexToCol(idx) {
	let s = '';
	idx += 1; // 1-based
	while (idx > 0) {
		idx -= 1;
		s = String.fromCharCode(65 + (idx % 26)) + s;
		idx = Math.floor(idx / 26);
	}
	return s;
}

/**
 * Parse a cell reference like "A1" into { c, r } (0-based).
 */
function parseRef(ref) {
	const m = ref.match(/^([A-Z]+)(\d+)$/);
	if (!m) return { c: 0, r: 0 };
	return { c: colToIndex(m[1]), r: parseInt(m[2], 10) - 1 };
}

// ── Shared strings ───────────────────────────────────────────────────────────

function parseSharedStrings(files) {
	const raw = files['xl/sharedStrings.xml'];
	if (!raw) return [];

	const doc = parseXML(bytesToString(raw));
	const items = doc.getElementsByTagName('si');
	const result = [];

	for (let i = 0; i < items.length; i++) {
		// Concatenate all <t> text nodes inside this <si>
		const tNodes = items[i].getElementsByTagName('t');
		let text = '';
		for (let j = 0; j < tNodes.length; j++) {
			text += tNodes[j].textContent ?? '';
		}
		result.push(text);
	}
	return result;
}

// ── Workbook (sheet names) ───────────────────────────────────────────────────

function parseWorkbook(files) {
	const raw = files['xl/workbook.xml'];
	if (!raw) return [];

	const doc = parseXML(bytesToString(raw));
	const sheets = doc.getElementsByTagName('sheet');
	const names = [];
	for (let i = 0; i < sheets.length; i++) {
		names.push(sheets[i].getAttribute('name') ?? `Sheet${i + 1}`);
	}
	return names;
}

// ── Worksheet relationships (to map rId → sheet file path) ───────────────────

function parseWorkbookRels(files) {
	const raw = files['xl/_rels/workbook.xml.rels'];
	if (!raw) return {};

	const doc = parseXML(bytesToString(raw));
	const rels = doc.getElementsByTagName('Relationship');
	const map = {};
	for (let i = 0; i < rels.length; i++) {
		const id = rels[i].getAttribute('Id');
		const target = rels[i].getAttribute('Target');
		if (id && target) {
			// Target is relative to xl/, e.g. "worksheets/sheet1.xml"
			map[id] = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
		}
	}
	return map;
}

// ── Sheet parsing ────────────────────────────────────────────────────────────

/**
 * Parse a worksheet XML into an internal sheet representation.
 * Returns: { cells: Map<string, value>, ref: string, hiddenRows: Set, hiddenCols: Set }
 */
function parseSheet(bytes, sharedStrings) {
	const doc = parseXML(bytesToString(bytes));

	// Collect hidden columns
	const hiddenCols = new Set();
	const colNodes = doc.getElementsByTagName('col');
	for (let i = 0; i < colNodes.length; i++) {
		if (colNodes[i].getAttribute('hidden') === '1') {
			const minC = parseInt(colNodes[i].getAttribute('min'), 10);
			const maxC = parseInt(colNodes[i].getAttribute('max'), 10);
			for (let c = minC; c <= maxC; c++) hiddenCols.add(c - 1); // 0-based
		}
	}

	// Collect hidden rows
	const hiddenRows = new Set();
	const rowNodes = doc.getElementsByTagName('row');
	for (let i = 0; i < rowNodes.length; i++) {
		if (rowNodes[i].getAttribute('hidden') === '1') {
			hiddenRows.add(parseInt(rowNodes[i].getAttribute('r'), 10) - 1); // 0-based
		}
	}

	// Get sheet reference
	const dimNode = doc.getElementsByTagName('dimension')[0];
	let ref = dimNode ? dimNode.getAttribute('ref') : null;

	// Parse cells
	const cells = new Map();
	const cellNodes = doc.getElementsByTagName('c');
	let maxRow = 0;
	let maxCol = 0;

	for (let i = 0; i < cellNodes.length; i++) {
		const cellNode = cellNodes[i];
		const r = cellNode.getAttribute('r'); // e.g. "A1"
		const t = cellNode.getAttribute('t'); // type: s=shared string, b=boolean, inlineStr, etc.
		const vNode = cellNode.getElementsByTagName('v')[0];
		const isNode = cellNode.getElementsByTagName('is')[0]; // inline string

		let value = '';
		if (t === 's' && vNode) {
			// Shared string
			const idx = parseInt(vNode.textContent, 10);
			value = sharedStrings[idx] ?? '';
		} else if (t === 'inlineStr' && isNode) {
			const tNodes = isNode.getElementsByTagName('t');
			for (let j = 0; j < tNodes.length; j++) {
				value += tNodes[j].textContent ?? '';
			}
		} else if (t === 'b' && vNode) {
			value = vNode.textContent === '1' ? 'TRUE' : 'FALSE';
		} else if (vNode) {
			value = vNode.textContent ?? '';
		}

		if (r) {
			cells.set(r, value);
			const parsed = parseRef(r);
			if (parsed.r > maxRow) maxRow = parsed.r;
			if (parsed.c > maxCol) maxCol = parsed.c;
		}
	}

	if (!ref && cells.size > 0) {
		ref = `A1:${indexToCol(maxCol)}${maxRow + 1}`;
	}

	return {
		'!ref': ref || 'A1',
		_cells: cells,
		_hiddenRows: hiddenRows,
		_hiddenCols: hiddenCols
	};
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Read an XLSX file from a Uint8Array.
 * Returns { SheetNames: string[], Sheets: { [name]: sheet } }
 */
export function read(data, _opts) {
	const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data);
	const files = unzipSync(uint8);

	const sharedStrings = parseSharedStrings(files);
	const sheetNames = parseWorkbook(files);
	const rels = parseWorkbookRels(files);

	// Map sheet names to their rIds from workbook.xml
	const workbookDoc = parseXML(bytesToString(files['xl/workbook.xml']));
	const sheetElements = workbookDoc.getElementsByTagName('sheet');

	const Sheets = {};
	for (let i = 0; i < sheetElements.length; i++) {
		const name = sheetElements[i].getAttribute('name');
		const rId = sheetElements[i].getAttribute('r:id');

		// Try to find the file path from relationships
		let filePath = rels[rId];
		if (!filePath) {
			// Fallback: try common naming convention
			filePath = `xl/worksheets/sheet${i + 1}.xml`;
		}

		const sheetBytes = files[filePath];
		if (sheetBytes && name) {
			Sheets[name] = parseSheet(sheetBytes, sharedStrings);
		}
	}

	return { SheetNames: sheetNames, Sheets };
}

export const utils = {
	/**
	 * Decode a range reference like "A1:Z100" into { s: {c, r}, e: {c, r} }.
	 */
	decode_range(ref) {
		if (!ref) return { s: { c: 0, r: 0 }, e: { c: 0, r: 0 } };
		const parts = ref.split(':');
		const s = parseRef(parts[0]);
		const e = parts.length > 1 ? parseRef(parts[1]) : { ...s };
		return { s, e };
	},

	/**
	 * Convert a sheet to CSV string.
	 * Options: { skipHidden: boolean, blankrows: boolean }
	 */
	sheet_to_csv(sheet, opts = {}) {
		const skipHidden = opts.skipHidden ?? false;
		const blankrows = opts.blankrows ?? true;

		const range = utils.decode_range(sheet['!ref']);
		const rows = [];

		for (let r = range.s.r; r <= range.e.r; r++) {
			if (skipHidden && sheet._hiddenRows && sheet._hiddenRows.has(r)) continue;

			const cells = [];
			let hasValue = false;

			for (let c = range.s.c; c <= range.e.c; c++) {
				if (skipHidden && sheet._hiddenCols && sheet._hiddenCols.has(c)) continue;
				const ref = indexToCol(c) + (r + 1);
				const val = sheet._cells ? (sheet._cells.get(ref) ?? '') : '';
				if (val !== '') hasValue = true;
				// CSV-escape values containing commas, quotes, or newlines
				if (
					typeof val === 'string' &&
					(val.includes(',') || val.includes('"') || val.includes('\n'))
				) {
					cells.push('"' + val.replace(/"/g, '""') + '"');
				} else {
					cells.push(val);
				}
			}

			if (!blankrows && !hasValue) continue;
			rows.push(cells.join(','));
		}

		return rows.join('\n');
	}
};
