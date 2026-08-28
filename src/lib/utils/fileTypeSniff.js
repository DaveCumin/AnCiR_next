// fileTypeSniff.js
//
// Decide what kind of data file the user handed us so import can accept ANY
// file, not just ones with a recognised extension.
//
// Kinds: 'csv' | 'awd' | 'json' | 'excel' | 'unknown'
//
// Precedence (sniffFileType):
//   1. A firm extension wins outright: .csv/.tsv → csv, .awd → awd,
//      .json → json, .xlsx/.xls → excel. These files must behave exactly as
//      they always have — no content-sniffing detour.
//   2. Everything else (.txt, .dat, no extension, …) is sniffed from a text
//      slice of the content, in order JSON → AWD → Excel(zip magic) → CSV.
//      The order runs strongest-signal first: JSON and AWD have structural
//      signatures; "delimiter-consistent lines" is the weakest test, so CSV
//      is checked last.
//   3. A .txt whose content is inconclusive still defaults to csv (that is
//      what .txt has always meant here); any other inconclusive file is
//      'unknown' and the caller decides (AnCiR falls back to a CSV attempt
//      with a visible warning).
//
// The AWD content check mirrors the real parser (awdTocsv in
// ImportData.svelte): a 7-line header where line 1 is a DD-MMM-YYYY (or
// DD-MMM-YY) start date, line 2 is an HH:mm start time, line 3 is a numeric
// interval, and lines 7+ are comma-separated numeric readings optionally
// carrying a trailing "M" event marker.

/** How much of the file the async helper reads for sniffing. */
export const SNIFF_SLICE_BYTES = 8192;

const FIRM_EXTENSIONS = new Map([
	['csv', 'csv'],
	['tsv', 'csv'],
	['awd', 'awd'],
	['json', 'json'],
	['xlsx', 'excel'],
	['xls', 'excel']
]);

/**
 * Kind implied by the filename alone, or null when the extension does not
 * pin one down (.txt is deliberately NOT firm: it is generic enough that AWD
 * or JSON content inside it should win — see sniffFileType).
 */
export function extensionKind(name) {
	const m = String(name ?? '')
		.toLowerCase()
		.match(/\.([a-z0-9]+)$/);
	if (!m) return null;
	return FIRM_EXTENSIONS.get(m[1]) ?? null;
}

/** True when the AWD parser's date line (strict DD-MMM-YYYY / DD-MMM-YY) would accept this. */
function looksLikeAwdDate(line) {
	return /^\d{1,2}-[A-Za-z]{3}-(\d{4}|\d{2})$/.test(String(line ?? '').trim());
}

/** One AWD data row: number, optionally more comma-separated numbers, optional trailing "M". */
const AWD_DATA_ROW_RE = /^\s*-?\d[\d.]*\s*(,\s*-?[\d.]*\d\s*M?\s*)*$/i;

function sniffAwd(lines) {
	// The parser needs the 7-line header plus at least one data row.
	if (lines.length < 8) return false;
	if (!looksLikeAwdDate(lines[1])) return false;
	if (!/^\s*\d{1,2}:\d{2}\s*$/.test(String(lines[2] ?? ''))) return false;
	const interval = Number(String(lines[3] ?? '').trim());
	if (!Number.isFinite(interval) || interval <= 0) return false;
	// Sample up to 10 data rows; require every sampled non-empty row to look
	// like a reading. (The last line of a truncated slice is dropped by the
	// caller, so a half-line cannot spoil this.)
	const sample = lines.slice(7, 17).filter((l) => String(l).trim() !== '');
	if (sample.length === 0) return false;
	return sample.every((l) => AWD_DATA_ROW_RE.test(l));
}

const CSV_DELIMITERS = [',', '\t', ';'];

function sniffCsv(lines) {
	const nonEmpty = lines.filter((l) => String(l).trim() !== '').slice(0, 25);
	if (nonEmpty.length === 0) return null;
	let best = null;
	for (const delim of CSV_DELIMITERS) {
		const counts = nonEmpty.map((l) => l.split(delim).length);
		// Modal column count across the sample.
		const freq = new Map();
		for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
		let modal = 0;
		let modalCount = 0;
		for (const [c, n] of freq) {
			if (n > modalCount) {
				modal = c;
				modalCount = n;
			}
		}
		if (modal < 2) continue; // one giant column is not evidence of a delimiter
		const consistency = modalCount / counts.length;
		if (consistency < 0.8) continue;
		if (!best || modalCount * modal > best.modalCount * best.modal) {
			best = { delim, modal, modalCount, consistency };
		}
	}
	return best;
}

const DELIMITER_NAMES = { ',': 'comma', '\t': 'tab', ';': 'semicolon' };

/**
 * Sniff a text slice of a file's content.
 *
 * @param {string} slice - the first few KB of the file, decoded as text.
 * @param {{complete?: boolean}} [opts] - complete=false means the slice was
 *   truncated (the file is bigger), so a failed JSON.parse of the slice does
 *   not disprove JSON and the final (possibly half) line is untrustworthy.
 * @returns {{kind: 'csv'|'awd'|'json'|'excel'|'unknown', reason: string}}
 */
export function sniffContent(slice, opts = {}) {
	const complete = opts.complete ?? true;
	const text = String(slice ?? '');
	if (text.trim() === '') return { kind: 'unknown', reason: 'file is empty' };

	// Binary detection first: an .xlsx is a zip ("PK\x03\x04"); any NUL or a
	// run of replacement chars means this was never text.
	if (text.startsWith('PK')) {
		return { kind: 'excel', reason: 'zip container (xlsx)' };
	}
	const head = text.slice(0, 512);
	if (head.includes('\u0000') || (head.match(/�/g)?.length ?? 0) > 8) {
		return { kind: 'unknown', reason: 'binary content' };
	}

	// JSON: structural start plus either a clean parse (complete slice) or a
	// plausible token following the opener (truncated slice).
	const trimmed = text.trim();
	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		let parses = false;
		try {
			JSON.parse(trimmed);
			parses = true;
		} catch {
			parses = false;
		}
		if (parses) return { kind: 'json', reason: 'content parses as JSON' };
		if (!complete && /^[{[]\s*(["{[\]}]|-?\d|true|false|null)/.test(trimmed)) {
			return { kind: 'json', reason: 'starts like JSON (slice truncated before the end)' };
		}
		// A complete file starting with { or [ that does not parse falls
		// through — it might be a CSV whose first cell happens to open a bracket.
	}

	let lines = text.split(/\r\n|\r|\n/);
	// A truncated slice almost certainly cut the last line in half.
	if (!complete && lines.length > 1) lines = lines.slice(0, -1);

	if (sniffAwd(lines)) {
		return { kind: 'awd', reason: 'AWD header (date / time / interval lines) + numeric readings' };
	}

	const csv = sniffCsv(lines);
	if (csv) {
		return {
			kind: 'csv',
			reason: `${DELIMITER_NAMES[csv.delim]}-separated, ${csv.modal} columns over ${csv.modalCount} sampled lines`
		};
	}

	return { kind: 'unknown', reason: 'no JSON / AWD / delimited-text structure found' };
}

/**
 * Decide the import kind for a file from its name and a content slice.
 *
 * @returns {{kind: string, via: 'extension'|'content'|'default', reason: string}}
 */
export function sniffFileType(name, slice, opts = {}) {
	const ek = extensionKind(name);
	if (ek)
		return {
			kind: ek,
			via: 'extension',
			reason: `.${String(name).split('.').pop().toLowerCase()} extension`
		};

	const c = sniffContent(slice, opts);
	if (c.kind !== 'unknown') return { kind: c.kind, via: 'content', reason: c.reason };

	if (/\.txt$/i.test(String(name ?? ''))) {
		// .txt has always meant "delimited text" here; keep that meaning even
		// when the content is too ragged for the CSV sniff to be confident.
		return { kind: 'csv', via: 'default', reason: '.txt with inconclusive content' };
	}
	return { kind: 'unknown', via: 'content', reason: c.reason };
}

/**
 * Does parsed JSON look like an AnCiR SESSION (as written by outputCoreAsJson)
 * rather than arbitrary data? Sessions are objects with a `data` array plus at
 * least one of the other core fields; a bare array or a data-shaped object is
 * NOT a session.
 */
export function looksLikeSession(parsed) {
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
	if (!Array.isArray(parsed.data)) return false;
	return (
		'version' in parsed ||
		'appState' in parsed ||
		Array.isArray(parsed.plots) ||
		Array.isArray(parsed.tableProcesses)
	);
}

// Per-File cache so preview, row-count and full-load passes all agree on one
// verdict without re-reading the slice.
const sniffCache = new WeakMap();

/**
 * Async convenience: read the first SNIFF_SLICE_BYTES of a File/Blob and sniff
 * it. Cached per File object.
 * @param {File} file
 */
export async function sniffFile(file) {
	if (!file) return { kind: 'unknown', via: 'content', reason: 'no file' };
	const cached = sniffCache.get(file);
	if (cached) return cached;
	const complete = file.size <= SNIFF_SLICE_BYTES;
	let slice = '';
	try {
		slice = await file.slice(0, SNIFF_SLICE_BYTES).text();
	} catch {
		slice = '';
	}
	const result = sniffFileType(file.name, slice, { complete });
	sniffCache.set(file, result);
	return result;
}
