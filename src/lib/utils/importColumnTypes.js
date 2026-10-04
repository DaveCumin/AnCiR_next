// @ts-nocheck
// Column type detection for imported tables, and the user's override of it.
//
// Order matters: numbers are checked BEFORE times. PapaParse (dynamicTyping) has
// already turned "8.4" into the number 8.4, and a date guesser handed 8.4 happily
// answers "D.M" (8 April), which turned activity counts into a time column whose
// every value was missing. A column of JS numbers is therefore never given a time
// format automatically. Epoch timestamps are numbers too, so reading a numeric
// column as epoch seconds or milliseconds is an explicit choice in the preview.
import { guessDateofArray, hasTimeFormat, isBlankCell } from '$lib/utils/time/TimeUtils.js';

// Text the importer treats as "no value" when picking the first real value.
const MISSING_TEXT = new Set(['NaN', 'NA', 'null']);

// Plausible epoch ranges (1 Jan 1990 to 1 Jan 2100), used only to SUGGEST the
// epoch options in the preview; nothing is converted without the user choosing.
const EPOCH_S_MIN = 631_152_000;
const EPOCH_S_MAX = 4_102_444_800;

function firstValid(values) {
	for (const v of values) {
		if (v !== null && v !== undefined && v !== '' && !MISSING_TEXT.has(v)) return v;
	}
	return null;
}

/**
 * Which epoch unit a numeric column looks like, or null.
 * @param {number[]} nums non-blank numeric values
 * @returns {'s' | 'ms' | null}
 */
export function epochHint(nums) {
	if (nums.length === 0) return null;
	const inRange = (k) =>
		nums.every((n) => Number.isInteger(n) && n >= EPOCH_S_MIN * k && n <= EPOCH_S_MAX * k);
	if (inRange(1)) return 's';
	if (inRange(1000)) return 'ms';
	return null;
}

/**
 * Detect a column's type from its values.
 * @param {unknown[]} values
 * @returns {{ type: 'time' | 'number' | 'category', timeFormat: string | string[] | null, epoch: 's' | 'ms' | null }}
 */
export function detectColumnType(values) {
	const arr = Array.isArray(values) ? values : [];
	const nonBlank = arr.filter((v) => !isBlankCell(v));
	if (nonBlank.length > 0 && nonBlank.every((v) => typeof v === 'number' && Number.isFinite(v))) {
		return { type: 'number', timeFormat: null, epoch: epochHint(nonBlank) };
	}
	const fmt = guessDateofArray(arr);
	if (fmt !== -1 && hasTimeFormat(fmt)) return { type: 'time', timeFormat: fmt, epoch: null };
	const datum = firstValid(arr);
	if (typeof datum === 'number' && !Number.isNaN(datum)) {
		return { type: 'number', timeFormat: null, epoch: null };
	}
	return { type: 'category', timeFormat: null, epoch: null };
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
 * epoch milliseconds (what a time column with no format holds).
 * @param {unknown[]} values full column values
 * @param {{ choice: string, timeFormat?: string } | null | undefined} override
 * @returns {{ type: 'time' | 'number' | 'category', timeFormat: string | string[], values: unknown[] }}
 */
export function resolveImportType(values, override) {
	const choice = override?.choice;
	// Epoch choices apply to numbers only. A column that is text by now (binning
	// rewrites its time column as labels) falls through to detection.
	if ((choice === 'epoch-s' || choice === 'epoch-ms') && isNumericColumn(values)) {
		const k = choice === 'epoch-s' ? 1000 : 1;
		const out = values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v * k : null));
		return { type: 'time', timeFormat: [], values: out };
	}
	if (choice === 'time') {
		const fmt = override.timeFormat?.trim() ? override.timeFormat.trim() : guessDateofArray(values);
		return { type: 'time', timeFormat: fmt === -1 ? [] : fmt, values };
	}
	if (choice === 'number' || choice === 'category') {
		return { type: choice, timeFormat: [], values };
	}
	const d = detectColumnType(values);
	return { type: d.type, timeFormat: d.timeFormat ?? [], values };
}
