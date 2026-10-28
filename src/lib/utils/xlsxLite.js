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

// ── Limits for files a user did not make (SEC-U3) ────────────────────────────
//
// A workbook is a zip of XML parts, and every size in it is the file's own claim. Before
// these limits a 1 kB crafted file froze the tab (a <dimension> or a single cell claiming
// all 17 billion cells of a sheet), and a zip bomb was inflated in full even though the
// reader never looks at that part. xlsxLite.hostile.test.js has one case per limit.

/** Excel's own grid: 16,384 columns (XFD) by 1,048,576 rows. */
const MAX_COLS = 16384;

/** The most cells (rows x columns of the used range) a sheet may span. */
export const MAX_SHEET_CELLS = 50_000_000;

/**
 * The most bytes one XML part may unpack to. Just under V8's longest string (2^29 - 24
 * UTF-16 units), which TextDecoder could not exceed anyway. fflate inflates a part into a
 * buffer of its declared size, so a part that lies about its size is cut short there and
 * cannot grow past this.
 */
const MAX_PART_BYTES = 500_000_000;

/** The most bytes all the parts read may unpack to together. */
const MAX_TOTAL_BYTES = 1_000_000_000;

/** An error whose message the import dialog shows as is (ImportData describeImportError). */
function userError(message) {
	return Object.assign(new Error(message), { userMessage: message });
}

const fmtMB = (bytes) => `${Math.round(bytes / 1e6).toLocaleString('en-US')} MB`;

/**
 * Unpack only the named parts of the zip, refusing any whose declared size is past the
 * limits. Parts the reader never uses (images, pivot caches, padding) are never inflated.
 */
function unzipParts(uint8, wanted, budget) {
	return unzipSync(uint8, {
		filter: (f) => {
			if (!wanted(f.name)) return false;
			if (f.originalSize > MAX_PART_BYTES || budget.used + f.originalSize > MAX_TOTAL_BYTES) {
				throw userError(
					`This workbook is too large to read: its part "${f.name}" unpacks to ` +
						`${fmtMB(f.originalSize)}, and AnCiR reads up to ${fmtMB(MAX_PART_BYTES)} per ` +
						`sheet and ${fmtMB(MAX_TOTAL_BYTES)} per workbook. Save the sheet you need as ` +
						`CSV and import that instead.`
				);
			}
			budget.used += f.originalSize;
			return true;
		}
	});
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse XML string into a Document (works in browser).
 *
 * A part with a DOCTYPE is refused before the parser sees it. OOXML parts never carry one
 * (ECMA-376 Part 2 forbids DTDs in package parts), and a DOCTYPE is how an XML file declares
 * the entities of an expansion attack ("billion laughs"). Chromium refuses that expansion
 * and returns a parse-error document, which used to make the header names vanish silently.
 */
function parseXML(text) {
	if (text.includes('<!DOCTYPE')) {
		throw userError(
			'This workbook contains an XML document type declaration (DOCTYPE), which Excel ' +
				'never writes, so AnCiR will not read it. Open it in Excel, save it as .xlsx or CSV, ' +
				'and try again.'
		);
	}
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

// ── Date/time helpers ────────────────────────────────────────────────────────

/**
 * Returns true if an Excel format code string represents a date or time format.
 * Strips quoted literals and bracket sequences before checking.
 */
function isDateFormat(fmt) {
	let stripped = fmt.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
	// y=year, m=month/minute, d=day, h=hour, s=second
	return /[yYmMdDhHsS]/.test(stripped);
}

/**
 * Parse xl/styles.xml to get the set of cell style indices (s attribute) that
 * correspond to date/time number formats.
 */
function parseDateStyles(files) {
	const raw = files['xl/styles.xml'];
	if (!raw) return new Set();

	const doc = parseXML(bytesToString(raw));

	// Excel built-in date/time numFmtIds
	const dateNumFmtIds = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

	// Add any custom numFmts whose format code looks like a date/time
	const numFmtNodes = doc.getElementsByTagName('numFmt');
	for (let i = 0; i < numFmtNodes.length; i++) {
		const id = parseInt(numFmtNodes[i].getAttribute('numFmtId') ?? '0', 10);
		const fmt = numFmtNodes[i].getAttribute('formatCode') ?? '';
		if (isDateFormat(fmt)) dateNumFmtIds.add(id);
	}

	// Walk cellXfs and flag style indices that use a date numFmtId
	const dateStyleIndices = new Set();
	const cellXfs = doc.getElementsByTagName('cellXfs')[0];
	if (!cellXfs) return dateStyleIndices;

	const xfNodes = cellXfs.getElementsByTagName('xf');
	for (let i = 0; i < xfNodes.length; i++) {
		const numFmtId = parseInt(xfNodes[i].getAttribute('numFmtId') ?? '0', 10);
		if (dateNumFmtIds.has(numFmtId)) dateStyleIndices.add(i);
	}

	return dateStyleIndices;
}

/** Convert a number of seconds into the day (0 to 86399) to an "HH:mm:ss" string. */
function secondsToTimeString(totalSecs) {
	const h = Math.floor(totalSecs / 3600);
	const m = Math.floor((totalSecs % 3600) / 60);
	const s = totalSecs % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Days from each date system's serial 0 to 1970-01-01. In the 1900 system serial 1 is
// 1900-01-01, and Excel also counts a 1900-02-29 that never happened (serial 60), so
// 25569 lands serial 61 and later on the right day and serials 1 to 59 need one day
// fewer. The 1904 system (old Mac Excel) has serial 0 = 1904-01-01 and no phantom day.
const EPOCH_OFFSET_1900 = 25569;
const EPOCH_OFFSET_1904 = 24107;

/**
 * Convert an Excel serial date number to an ISO-like string.
 * Returns the original text unchanged if it is not a valid number.
 * `date1904` is true for workbooks saved with the 1904 date system.
 */
function serialToDateString(raw, date1904 = false) {
	const num = parseFloat(raw);
	if (isNaN(num)) return raw;

	// Round the whole serial to the second before splitting it, so a time just short of
	// midnight rolls into the next day instead of printing as 24:00:00.
	const totalSecs = Math.round(num * 86400);
	const secsOfDay = ((totalSecs % 86400) + 86400) % 86400;

	// Time-only value (no date component)
	if (Math.floor(num) === 0) return secondsToTimeString(secsOfDay);

	const dayNum = (totalSecs - secsOfDay) / 86400;
	let datePart;
	if (!date1904 && dayNum === 60) {
		// The phantom leap day has no real date; keep the label Excel shows for it.
		datePart = '1900-02-29';
	} else {
		const offset = date1904
			? EPOCH_OFFSET_1904
			: dayNum < 60
				? EPOCH_OFFSET_1900 - 1
				: EPOCH_OFFSET_1900;
		const date = new Date((dayNum - offset) * 86400000);
		const yyyy = date.getUTCFullYear();
		const MM = String(date.getUTCMonth() + 1).padStart(2, '0');
		const dd = String(date.getUTCDate()).padStart(2, '0');
		datePart = `${yyyy}-${MM}-${dd}`;
	}

	if (secsOfDay > 0) {
		return `${datePart} ${secondsToTimeString(secsOfDay)}`;
	}
	return datePart;
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

/**
 * True when workbook.xml declares the 1904 date system (<workbookPr date1904="1"/>,
 * or "true", which some writers emit).
 */
function parseDate1904(files) {
	const raw = files['xl/workbook.xml'];
	if (!raw) return false;
	const pr = parseXML(bytesToString(raw)).getElementsByTagName('workbookPr')[0];
	const v = pr?.getAttribute('date1904');
	return v === '1' || v === 'true';
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
function parseSheet(bytes, sharedStrings, dateStyleIndices, date1904 = false) {
	const doc = parseXML(bytesToString(bytes));

	// Collect hidden columns
	const hiddenCols = new Set();
	const colNodes = doc.getElementsByTagName('col');
	for (let i = 0; i < colNodes.length; i++) {
		if (colNodes[i].getAttribute('hidden') === '1') {
			// Clamped to Excel's columns: a crafted max of 2^31 used to build a Set of that size.
			const minC = Math.max(1, parseInt(colNodes[i].getAttribute('min'), 10));
			const maxC = Math.min(MAX_COLS, parseInt(colNodes[i].getAttribute('max'), 10));
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
		const s = cellNode.getAttribute('s'); // style index
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
			// Check if this cell uses a date/time style
			const styleIdx = s != null ? parseInt(s, 10) : -1;
			if (dateStyleIndices && styleIdx >= 0 && dateStyleIndices.has(styleIdx)) {
				value = serialToDateString(vNode.textContent, date1904);
			} else {
				value = vNode.textContent ?? '';
			}
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
	} else if (ref) {
		// The <dimension> is the file's claim; the cells are what it holds. Trim a claimed
		// range that runs past the last cell (A1:XFD1048576 over six cells used to make the
		// CSV walk visit 17 billion cells), keeping where it starts.
		const dim = utils.decode_range(ref);
		const e =
			cells.size > 0 ? { r: Math.min(dim.e.r, maxRow), c: Math.min(dim.e.c, maxCol) } : dim.s;
		ref =
			`${indexToCol(dim.s.c)}${dim.s.r + 1}:` +
			`${indexToCol(Math.max(e.c, dim.s.c))}${Math.max(e.r, dim.s.r) + 1}`;
	}

	if (ref) {
		const { s, e } = utils.decode_range(ref);
		const rows = e.r - s.r + 1;
		const cols = e.c - s.c + 1;
		if (rows * cols > MAX_SHEET_CELLS) {
			throw userError(
				`This sheet's used range is ${rows.toLocaleString('en-US')} rows by ` +
					`${cols.toLocaleString('en-US')} columns, more than the ` +
					`${MAX_SHEET_CELLS.toLocaleString('en-US')} cells AnCiR can read. Something far ` +
					`from the data (a stray value or formatting) can stretch the range: delete the ` +
					`empty rows and columns past your data in Excel, or save the sheet as CSV, and ` +
					`try again.`
			);
		}
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
// eslint-disable-next-line no-unused-vars -- `_opts` keeps the SheetJS-compatible read(data, opts) signature that ImportData.svelte calls with { type: 'array' }; the options are not needed here
export function read(data, _opts) {
	const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data);
	// Two passes over the zip directory: the fixed parts first, then the sheets the
	// workbook's relationships name (so a sheet stored outside xl/worksheets/ is still found).
	const budget = { used: 0 };
	const FIXED = new Set([
		'xl/workbook.xml',
		'xl/_rels/workbook.xml.rels',
		'xl/sharedStrings.xml',
		'xl/styles.xml'
	]);
	const files = unzipParts(uint8, (name) => FIXED.has(name), budget);
	const sheetPaths = new Set(Object.values(parseWorkbookRels(files)));
	Object.assign(
		files,
		unzipParts(
			uint8,
			(name) =>
				!FIXED.has(name) && (sheetPaths.has(name) || /^xl\/worksheets\/[^/]+\.xml$/.test(name)),
			budget
		)
	);

	const sharedStrings = parseSharedStrings(files);
	const sheetNames = parseWorkbook(files);
	const rels = parseWorkbookRels(files);
	const dateStyleIndices = parseDateStyles(files);
	const date1904 = parseDate1904(files);

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
			Sheets[name] = parseSheet(sheetBytes, sharedStrings, dateStyleIndices, date1904);
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
