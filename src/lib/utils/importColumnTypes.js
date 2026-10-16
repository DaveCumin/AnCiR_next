// @ts-nocheck
// Column type detection for imported tables, and the user's override of it.
//
// Order matters: numbers are checked BEFORE times. The cell typer has already
// turned "8.4" into the number 8.4, and a date guesser handed 8.4 happily
// answers "D.M" (8 April), which turned activity counts into a time column whose
// every value was missing. A column of JS numbers is therefore never given a time
// format automatically. Epoch timestamps are numbers too, so reading a numeric
// column as epoch seconds or milliseconds is an explicit choice in the preview.
//
// Cell typing is ours, not PapaParse's (see makeCellTyper): its dynamicTyping
// turned zone-qualified ISO timestamps into Date objects the time guesser could
// not read, and has no decimal-comma mode.
import {
	guessDateDetails,
	guessDateofArray,
	hasTimeFormat,
	isBlankCell
} from '$lib/utils/time/TimeUtils.js';
import { medianSamplingInterval } from '$lib/utils/periodogram.js';

// Text the importer treats as "no value" when picking the first real value.
const MISSING_TEXT = new Set(['NaN', 'NA', 'null']);

// Plausible epoch ranges (1 Jan 1990 to 1 Jan 2100), used only to SUGGEST the
// epoch options in the preview; nothing is converted without the user choosing.
const EPOCH_S_MIN = 631_152_000;
const EPOCH_S_MAX = 4_102_444_800;

// PapaParse's own number test (papaparse.js FLOAT, and its +/-2^53 bound), so a
// cell is a number here exactly when dynamicTyping would have made it one.
const FLOAT = /^\s*-?(\d+\.?|\.\d+|\d+\.\d+)([eE][-+]?\d+)?\s*$/;
const MAX_FLOAT = 2 ** 53;
// A decimal-comma number: "10,5", "-0,25", "1.234,5" (dots group thousands).
const DECIMAL_COMMA = /^\s*-?(\d+|\d{1,3}(\.\d{3})+),\d+\s*$/;

/**
 * The number a decimal-comma cell ("10,5", "1.234,5") stands for, or null.
 * @param {unknown} value
 * @returns {number | null}
 */
export function parseDecimalComma(value) {
	if (typeof value !== 'string' || !DECIMAL_COMMA.test(value)) return null;
	return Number(value.trim().replace(/\./g, '').replace(',', '.'));
}

/**
 * A PapaParse `transform` that types each cell as dynamicTyping did (numbers,
 * true/false, '' as null) except that ISO timestamps stay text, so the time
 * guesser can read them, and, with `decimalComma`, "10,5" is the number 10.5.
 * Use it with `dynamicTyping: false`.
 * @param {{ decimalComma?: boolean }} [opts]
 * @returns {(value: string) => unknown}
 */
export function makeCellTyper({ decimalComma = false } = {}) {
	return (value) => {
		if (typeof value !== 'string') return value;
		if (value === '') return null;
		if (value === 'true' || value === 'TRUE') return true;
		if (value === 'false' || value === 'FALSE') return false;
		if (FLOAT.test(value)) {
			const n = parseFloat(value);
			if (n > -MAX_FLOAT && n < MAX_FLOAT) return n;
		}
		if (decimalComma) {
			const n = parseDecimalComma(value);
			if (n !== null) return n;
		}
		return value;
	};
}

/**
 * Columns that look written with decimal commas: at least one "10,5" cell, and
 * every other non-blank cell a whole number (which reads the same either way) or
 * an explicit missing marker. A column with "1.5" in it is not one.
 * @param {Record<string, unknown[]>} columns parsed with decimal commas off
 * @returns {string[]}
 */
export function decimalCommaColumns(columns) {
	const out = [];
	for (const [name, values] of Object.entries(columns ?? {})) {
		let commas = 0;
		let fits = true;
		for (const v of values ?? []) {
			if (isBlankCell(v) || MISSING_TEXT.has(v)) continue;
			if (parseDecimalComma(v) !== null) commas++;
			else if (!(typeof v === 'number' && Number.isInteger(v))) {
				fits = false;
				break;
			}
		}
		if (fits && commas > 0) out.push(name);
	}
	return out;
}

/**
 * Non-blank cells of a number column that are not numbers (and are not one of
 * the importer's missing markers), which will be imported as missing.
 * @param {unknown[]} values
 * @returns {{ count: number, example: unknown }}
 */
export function countNonNumeric(values) {
	let count = 0;
	let example;
	for (const v of Array.isArray(values) ? values : []) {
		if (isBlankCell(v) || MISSING_TEXT.has(v)) continue;
		if (typeof v === 'number' && Number.isFinite(v)) continue;
		if (count === 0) example = v;
		count++;
	}
	return { count, example };
}

function firstValid(values) {
	for (const v of values) {
		if (v !== null && v !== undefined && v !== '' && !MISSING_TEXT.has(v)) return v;
	}
	return null;
}

// Header words that make an epoch reading more likely. They only relax the ordering rule
// below; a name alone never makes a suggestion.
const EPOCH_NAME_HINT = /unix|epoch|posix|timestamp/i;
// Share of steps between consecutive values that must go forward (later or equal) for a
// column to read as times: a logger's clock, possibly with a few repeated or corrected
// samples. With a name hint, half is enough (an unsorted export of event times).
const EPOCH_MIN_FORWARD = 0.9;
const EPOCH_MIN_FORWARD_NAMED = 0.5;
// A clock column has a typical step of at most a month, and is not one constant value.
const EPOCH_MAX_MEDIAN_STEP_S = 31 * 24 * 3600;

/**
 * Which epoch unit a numeric column looks like ('s' for Unix seconds, 'ms' for
 * milliseconds), or null. Only a SUGGESTION for the import preview: nothing is
 * converted unless the user picks it.
 *
 * Conservative, so ordinary numbers (counts, IDs, byte totals) are not flagged: every
 * value must fall within 1990 to 2100 in that unit, the values must mostly run forward
 * in time with a typical step of at most a month and must not all be equal, and there
 * must be at least two values. A header such as "timestamp_unix" relaxes only the
 * ordering rule. Whole and fractional seconds both count (1774310656.0 reads as a whole
 * number, 1774310656.25 is a quarter second later).
 * @param {number[]} nums non-blank numeric values, in row order
 * @param {{ name?: string }} [opts] the column header, used as a hint
 * @returns {'s' | 'ms' | null}
 */
export function epochHint(nums, opts = {}) {
	if (!Array.isArray(nums) || nums.length < 2) return null;
	if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
	const named = EPOCH_NAME_HINT.test(String(opts.name ?? ''));
	const steps = [];
	let forward = 0;
	for (let i = 1; i < nums.length; i++) {
		const d = nums[i] - nums[i - 1];
		if (d >= 0) forward++;
		if (d > 0) steps.push(d);
	}
	if (steps.length === 0) return null; // one repeated value
	if (forward / (nums.length - 1) < (named ? EPOCH_MIN_FORWARD_NAMED : EPOCH_MIN_FORWARD)) {
		return null;
	}
	steps.sort((a, b) => a - b);
	const medianStep = steps[Math.floor(steps.length / 2)];
	for (const [unit, k] of [
		['s', 1],
		['ms', 1000]
	]) {
		if (!nums.every((n) => n >= EPOCH_S_MIN * k && n <= EPOCH_S_MAX * k)) continue;
		if (medianStep > EPOCH_MAX_MEDIAN_STEP_S * k) return null;
		return unit;
	}
	return null;
}

/**
 * Epoch seconds or milliseconds to epoch milliseconds, the value a time column with no
 * text format holds. Whole seconds convert exactly; at today's epoch a double holds
 * milliseconds to about 0.0002 ms, so a fractional second such as 1774310656.123 comes
 * back as the 1774310656123 ms written in the file.
 * @param {unknown} v
 * @param {'s' | 'ms'} unit
 * @returns {number | null}
 */
export function epochToMs(v, unit) {
	if (typeof v !== 'number' || !Number.isFinite(v)) return null;
	return unit === 's' ? v * 1000 : v;
}

/**
 * Detect a column's type from its values.
 *
 * `dayMonth` is the guesser's day/month verdict for a time column (see
 * guessDateDetails), else null. When it is ambiguous, `opts.order` picks the
 * reading `timeFormat` holds; without one it is the guesser's default.
 *
 * A column with no values at all (every cell blank or a missing marker such as
 * "NA") has nothing to detect from. It is reported as `empty: true` with type
 * 'number', the app's default column type, rather than 'category' on the
 * strength of nothing; the preview says so instead of offering a guess.
 * @param {unknown[]} values
 * `opts.name` (the column header) is only a hint for the epoch suggestion.
 * @param {{ order?: 'day' | 'month' | null, name?: string }} [opts]
 * @returns {{ type: 'time' | 'number' | 'category', timeFormat: string | string[] | null, epoch: 's' | 'ms' | null, dayMonth: object | null, empty: boolean }}
 */
export function detectColumnType(values, opts = {}) {
	const arr = Array.isArray(values) ? values : [];
	const nonBlank = arr.filter((v) => !isBlankCell(v));
	if (!nonBlank.some((v) => !MISSING_TEXT.has(v))) {
		return { type: 'number', timeFormat: null, epoch: null, dayMonth: null, empty: true };
	}
	if (nonBlank.every((v) => typeof v === 'number' && Number.isFinite(v))) {
		return {
			type: 'number',
			timeFormat: null,
			epoch: epochHint(nonBlank, { name: opts.name }),
			dayMonth: null,
			empty: false
		};
	}
	const { format, dayMonth } = guessDateDetails(arr);
	if (format !== -1 && hasTimeFormat(format)) {
		let timeFormat = format;
		if (dayMonth?.ambiguous && (opts.order === 'day' || opts.order === 'month')) {
			timeFormat = opts.order === 'day' ? dayMonth.dayFirst : dayMonth.monthFirst;
		}
		return { type: 'time', timeFormat, epoch: null, dayMonth, empty: false };
	}
	const datum = firstValid(arr);
	if (typeof datum === 'number' && !Number.isNaN(datum)) {
		return { type: 'number', timeFormat: null, epoch: null, dayMonth: null, empty: false };
	}
	return { type: 'category', timeFormat: null, epoch: null, dayMonth: null, empty: false };
}

/**
 * Fewest non-blank values a column needs in the preview rows for the preview to
 * detect its type from them. A column with fewer (blank for its first rows, as a
 * logger that starts a sensor late writes it) is detected from a larger sample.
 */
export const MIN_PREVIEW_VALUES = 5;

/** How many values in a column are neither blank nor a missing marker. */
export function countValues(values) {
	let n = 0;
	for (const v of Array.isArray(values) ? values : []) {
		if (!isBlankCell(v) && !MISSING_TEXT.has(v)) n++;
	}
	return n;
}

/**
 * The sampling interval of a time column in minutes: the median positive gap
 * between its times (see medianSamplingInterval), or null with fewer than two
 * distinct times.
 * @param {ArrayLike<number | null>} timesMs times in epoch milliseconds
 * @returns {number | null}
 */
export function samplingIntervalMinutes(timesMs) {
	const ms = medianSamplingInterval(timesMs);
	return Number.isFinite(ms) && ms > 0 ? ms / 60_000 : null;
}

/**
 * The type choices the import preview offers for a column. `value` is what the
 * selector stores; the detected choice is listed first.
 * @param {{ type: string, timeFormat: unknown, epoch: string | null }} detected
 * @param {boolean} numeric whether every non-blank value is a number
 */
export function typeChoicesFor(detected, numeric) {
	const choices = [];
	if (numeric) {
		choices.push({ value: 'number', label: 'Number' });
		choices.push({ value: 'epoch-s', label: 'Time (epoch seconds)' });
		choices.push({ value: 'epoch-ms', label: 'Time (epoch milliseconds)' });
		choices.push({ value: 'category', label: 'Category' });
	} else {
		choices.push({ value: 'time', label: 'Time' });
		choices.push({ value: 'number', label: 'Number' });
		choices.push({ value: 'category', label: 'Category' });
	}
	const first = detectedChoice(detected);
	const i = choices.findIndex((c) => c.value === first);
	if (i > 0) choices.unshift(...choices.splice(i, 1));
	return choices;
}

/** The selector value for a detection result. */
export function detectedChoice(detected) {
	return detected?.type ?? 'category';
}

/** Whether every non-blank value in the column is a finite JS number. */
export function isNumericColumn(values) {
	const nonBlank = (Array.isArray(values) ? values : []).filter((v) => !isBlankCell(v));
	return nonBlank.length > 0 && nonBlank.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/**
 * Resolve the type a column is imported with: the user's override when there is
 * one, otherwise detection on the full values. Epoch seconds are converted to
 * epoch milliseconds (what a time column with no format holds). `opts.order`
 * settles an ambiguous day/month order (see guessDateofArray); Date objects
 * from another parser are stored as their ISO text.
 * @param {unknown[]} values full column values
 * @param {{ choice: string, timeFormat?: string } | null | undefined} override
 * @param {{ order?: 'day' | 'month' | null }} [opts]
 * @returns {{ type: 'time' | 'number' | 'category', timeFormat: string | string[], values: unknown[] }}
 */
export function resolveImportType(values, override, opts = {}) {
	if (Array.isArray(values) && values.some((v) => v instanceof Date)) {
		values = values.map((v) =>
			v instanceof Date && Number.isFinite(v.valueOf()) ? v.toISOString() : v
		);
	}
	const choice = override?.choice;
	// Epoch choices apply to numbers only. A column that is text by now (binning
	// rewrites its time column as labels) falls through to detection.
	if ((choice === 'epoch-s' || choice === 'epoch-ms') && isNumericColumn(values)) {
		const unit = choice === 'epoch-s' ? 's' : 'ms';
		const out = values.map((v) => epochToMs(v, unit));
		return { type: 'time', timeFormat: [], values: out };
	}
	if (choice === 'time') {
		const fmt = override.timeFormat?.trim()
			? override.timeFormat.trim()
			: guessDateofArray(values, opts);
		return { type: 'time', timeFormat: fmt === -1 ? [] : fmt, values };
	}
	if (choice === 'number' || choice === 'category') {
		return { type: choice, timeFormat: [], values };
	}
	const d = detectColumnType(values, opts);
	return { type: d.type, timeFormat: d.timeFormat ?? [], values };
}
