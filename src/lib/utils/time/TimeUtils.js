// @ts-nocheck
import dayjs from './dayjsSetup.js';
import { guessFormat } from './guessTimeFormat';
import { getDisplayZone } from './displayTime.js';
import { min, max } from '$lib/utils/MathsStats';
import { createSequenceArray } from '$lib/utils/MathsStats';

const decimalPlaces = 4;

// Translate a legacy Luxon-style format string (saved by older sessions) into
// the moment/dayjs vocabulary that dayjs expects. New code should write
// dayjs-style strings directly, but stored column.timeFormat values from
// sessions saved on a previous version flow through here so they keep working.
//
// Luxon → dayjs differences:
//   yyyy/yy → YYYY/YY        (year)
//   LLLL/LLL/LL/L → MMMM/MMM/MM/M (month, both standalone and format)
//   dd/d → DD/D              (day-of-month)
//   a → a                    (am/pm — same)
//   S → SSS                  (Luxon "S" is fractional seconds; ours is ms)
//   'X' → [X]                (literals: Luxon uses single-quotes, dayjs uses [])
//
// `Z` (offset token) is the same in both — only its escaping differs.
export function normalizeTimeFormat(fmt) {
	if (!fmt || typeof fmt !== 'string') return fmt;

	// If it already uses dayjs-style literal brackets, assume it's been
	// authored against the new vocabulary and pass through unchanged.
	const usesBrackets = /\[[^\]]+\]/.test(fmt);
	const usesQuotes = /'[^']+'/.test(fmt);
	const looksLuxon = /\b(yyyy|yy|LL+|dd|^d$|S(?!S))\b/.test(fmt) || usesQuotes;
	if (usesBrackets && !usesQuotes && !looksLuxon) return fmt;

	let out = fmt;

	// 1) Convert single-quoted literal segments to bracketed literals first.
	//    Doing this before token replacement avoids accidentally rewriting
	//    tokens that live inside a literal string.
	out = out.replace(/'([^']*)'/g, (_, body) => `[${body}]`);

	// 2) Token replacements. Order matters: longer tokens before shorter ones
	//    so e.g. `LLLL` doesn't get partially eaten by `LL`.
	const replacements = [
		[/yyyy/g, 'YYYY'],
		[/yy/g, 'YY'],
		[/LLLL/g, 'MMMM'],
		[/LLL/g, 'MMM'],
		[/LL/g, 'MM'],
		[/\bL\b/g, 'M'],
		[/dd/g, 'DD'],
		[/\bd\b/g, 'D'],
		// A lone `s` is left alone: parseTimeStrict lets every single-width
		// numeric token take one or two digits, so `s` reads both "7" and "07".
		// Widening it to `ss` (as this used to) rejected unpadded seconds.
		// Luxon's single `S` is "fractional seconds (any precision)". Our
		// stored format has a literal `.S` followed by ms digits, so widen
		// to 3-digit milliseconds (`SSS`). If a user-saved format genuinely
		// wanted a single digit, this errs on the side of working for ISO
		// timestamps like ".894".
		[/(?<!S)S(?!S)/g, 'SSS']
	];
	for (const [re, to] of replacements) out = out.replace(re, to);

	return out;
}

// Single-width numeric tokens: "one or two digits". dayjs's customParseFormat
// already reads 1-2 digits for each of these, but its strict mode then formats
// the parsed date back with the same format string and compares the strings,
// so under `H` the value "09" fails because it formats as "9". Sessions saved by
// older versions carry formats such as 'YYYY-MM-DD H:mm:s' over zero-padded data,
// and that round-trip blanked every row from 00:00 to 09:59.
const PAD_TOLERANT_TOKENS = new Set(['H', 'h', 'm', 's', 'D', 'M']);
// The token grammar dayjs's own format() uses (dayjs/esm/constant REGEX_FORMAT),
// so the per-token round-trip below splits the format exactly as dayjs does.
const DAYJS_FORMAT_TOKENS =
	/\[([^\]]+)]|Y{1,4}|M{1,4}|D{1,2}|d{1,4}|H{1,2}|h{1,2}|a|A|m{1,2}|s{1,2}|Z{1,2}|SSS/g;

function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Widen every single-width numeric token outside [literals] to its padded form.
function padSingleWidthTokens(fmt) {
	return fmt.replace(DAYJS_FORMAT_TOKENS, (tok) =>
		PAD_TOLERANT_TOKENS.has(tok) ? tok + tok : tok
	);
}

// Strict round-trip in which a single-width token may match its value with or
// without one leading zero. Double-width tokens and everything else must match
// exactly, as in dayjs strict mode. `offsetText`, when given, is what the zone
// offset tokens (Z, ZZ) must match: the offset exactly as the input wrote it.
function roundTripsPadTolerant(input, dt, fmt, offsetText) {
	let pattern = '';
	let last = 0;
	for (const m of fmt.matchAll(DAYJS_FORMAT_TOKENS)) {
		pattern += escapeRegExp(fmt.slice(last, m.index));
		last = m.index + m[0].length;
		if (m[1] !== undefined) {
			pattern += escapeRegExp(m[1]);
			continue;
		}
		if (offsetText !== undefined && (m[0] === 'Z' || m[0] === 'ZZ')) {
			pattern += escapeRegExp(offsetText);
			continue;
		}
		const text = dt.format(m[0]);
		pattern +=
			PAD_TOLERANT_TOKENS.has(m[0]) && text.length === 1
				? `0?${escapeRegExp(text)}`
				: escapeRegExp(text);
	}
	pattern += escapeRegExp(fmt.slice(last));
	return new RegExp(`^${pattern}$`).test(input);
}

// ─── Zone offsets ("2026-03-01T08:00:00+05:30") ─────────────────────────────
// dayjs reads the offset correctly, but its strict check formats the parsed
// instant back in the zone it parsed in (UTC, or the machine's own) and compares
// strings, so an offset other than that zone's never round-tripped and every such
// timestamp became missing. The check below compares in the offset the text
// itself carries instead.

/** Whether a format has a zone offset token (Z or ZZ) outside [literals]. */
function hasOffsetToken(fmt) {
	for (const m of fmt.matchAll(DAYJS_FORMAT_TOKENS)) {
		if (m[1] === undefined && (m[0] === 'Z' || m[0] === 'ZZ')) return true;
	}
	return false;
}

/**
 * The offset text the input carries where the format has its Z/ZZ token, or
 * null. dayjs accepts "+05:30", "+0530" and "Z" for either token.
 */
function offsetTextIn(input, fmt) {
	let pattern = '';
	let last = 0;
	for (const m of fmt.matchAll(DAYJS_FORMAT_TOKENS)) {
		pattern += escapeRegExp(fmt.slice(last, m.index));
		last = m.index + m[0].length;
		if (m[1] !== undefined) pattern += escapeRegExp(m[1]);
		else if (m[0] === 'Z' || m[0] === 'ZZ') pattern += '([+-]\\d{2}:?\\d{2}|Z)';
		else pattern += '.+?';
	}
	pattern += escapeRegExp(fmt.slice(last));
	return new RegExp(`^${pattern}$`).exec(input)?.[1] ?? null;
}

/** Minutes east of UTC for an offset text ("+05:30", "-0400", "Z"). */
function offsetMinutes(offsetText) {
	if (offsetText === 'Z') return 0;
	const m = /^([+-])(\d{2}):?(\d{2})$/.exec(offsetText);
	const minutes = Number(m[2]) * 60 + Number(m[3]);
	return m[1] === '-' ? -minutes : minutes;
}

/**
 * Strict parse of a value whose format carries a zone offset. Every other token
 * is checked against the wall clock IN THE WRITTEN OFFSET (pad-tolerant, as
 * elsewhere); the instant is the one the text names, returned in the caller's
 * parse zone.
 */
function parseWithOffset(text, fmt, make, invalid) {
	const offsetText = offsetTextIn(text, fmt);
	if (offsetText === null) return invalid;
	const loose = make(text, fmt);
	if (!loose.isValid()) return invalid;
	// utcOffset() reads a number of -16..16 as HOURS; whole-hour offsets are
	// passed as hours so the call is unambiguous either way.
	const mins = offsetMinutes(offsetText);
	const local = loose.utcOffset(mins % 60 === 0 ? mins / 60 : mins);
	return roundTripsPadTolerant(text, local, fmt, offsetText) ? make(loose.valueOf()) : invalid;
}

/**
 * Whether `fmt` is something a time value can be parsed with: a non-empty string,
 * or a non-empty array of them. `''` and `[]` both mean "no format yet".
 * @param {unknown} fmt
 */
export function hasTimeFormat(fmt) {
	if (typeof fmt === 'string') return fmt.trim() !== '';
	return (
		Array.isArray(fmt) &&
		fmt.length > 0 &&
		fmt.every((f) => typeof f === 'string' && f.trim() !== '')
	);
}

/**
 * Strictly parse `value` against a dayjs format string, as `dayjs(value, fmt, true)`
 * does, except that single-width numeric tokens (H h m s D M) accept a zero-padded
 * value too. Out-of-range values (hour 25, 30 February, month 13) are still
 * rejected rather than rolled over, so day/month disambiguation is unchanged.
 * The format is used as given; callers normalise legacy formats first.
 *
 * @param {string} value
 * @param {string} fmt dayjs format string
 * @param {{ utc?: boolean }} [opts] parse as UTC (default) or local wall-clock
 * @returns {import('dayjs').Dayjs} possibly-invalid dayjs instance
 */
export function parseTimeStrict(value, fmt, { utc = true } = {}) {
	const make = utc ? dayjs.utc : dayjs;
	// No format (Column.timeFormat defaults to [], and the guesser returns [] when
	// it recognises nothing): an invalid instant, not a throw from inside dayjs.
	if (!hasTimeFormat(fmt)) return make(NaN);
	if (Array.isArray(fmt)) {
		// dayjs accepts a list of formats; try each with the same padding rules.
		let first;
		for (const f of fmt) {
			const dt = parseTimeStrict(value, f, { utc });
			if (dt.isValid()) return dt;
			first ??= dt;
		}
		return first;
	}
	const text = normalizeMeridiemText(value);
	const exact = make(text, fmt, true);
	if (exact.isValid() || typeof text !== 'string' || typeof fmt !== 'string') return exact;
	if (hasOffsetToken(fmt)) return parseWithOffset(text, fmt, make, exact);
	const padded = padSingleWidthTokens(fmt);
	if (padded === fmt) return exact;
	// Fast path for the common case: every single-width token's value is padded.
	const widened = make(text, padded, true);
	if (widened.isValid()) return widened;
	// Mixed padding within one value, e.g. "09:5" under "H:m": neither the
	// format as given nor its fully padded form round-trips, so compare token
	// by token, letting each single-width token carry an optional leading zero.
	const loose = make(text, fmt);
	if (loose.isValid() && roundTripsPadTolerant(text, loose, fmt)) return loose;
	return exact;
}

// Accept dotted meridiem variants (a.m./p.m.) anywhere in imported text.
// Dayjs `a`/`A` tokens parse `am/pm` and `AM/PM`, so normalize input first.
function normalizeMeridiemText(value) {
	if (value == null) return value;
	if (typeof value !== 'string') return value;
	return value.replace(/(^|[^A-Za-z])([aApP])\.?m\.?([^A-Za-z]|$)/g, (_, pre, ap, post) => {
		const isUpper = ap === ap.toUpperCase();
		const meridiem = ap.toLowerCase() === 'a' ? (isUpper ? 'AM' : 'am') : isUpper ? 'PM' : 'pm';
		return `${pre}${meridiem}${post}`;
	});
}

export function formatDate(dateIN) {
	const dt = dayjs(dateIN);
	if (!dt.isValid()) return '';
	// Mirrors Luxon's DATETIME_MED ("Oct 14, 1983, 1:30 PM") via Intl, so the
	// output stays locale-aware without dragging in a localizedFormat plugin.
	return dt.toDate().toLocaleString(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	});
}

function guessDateFormat(dateString) {
	const theGuess = guessFormat(dateString);
	if (typeof theGuess === 'string') {
		return [theGuess]; //force the output to be an array
	}
	return theGuess;
}

/** A cell with nothing in it: null, undefined, NaN or whitespace-only text. */
export function isBlankCell(v) {
	if (v == null) return true;
	if (typeof v === 'number') return Number.isNaN(v);
	return typeof v === 'string' && v.trim() === '';
}

// Rows scored against each candidate format: every row up to 100,000, about 5,000
// evenly spaced rows beyond that.
const GUESS_FULL_SCAN_ROWS = 100_000;
const GUESS_SPARSE_SAMPLE = 5_000;
// Values the candidate formats are built from, spread evenly over the scored rows
// (first and last included) so a later row can contribute a format the first
// row does not suggest.
const GUESS_CANDIDATE_SOURCES = 200;

/** Up to `n` evenly spaced entries of `arr`, first and last included. */
function spread(arr, n) {
	if (arr.length <= n) return arr;
	const out = [];
	const step = (arr.length - 1) / (n - 1);
	for (let i = 0; i < n; i++) out.push(arr[Math.round(i * step)]);
	return out;
}

/**
 * The best time format for a column of values, or [] when it does not look like
 * text times.
 *
 * - Values PapaParse has already typed as JS numbers are never read as times: an
 *   activity count of 8.4 is not 8 April. A column with no non-blank text at all
 *   returns []; numeric epoch timestamps are an explicit choice for the user to make.
 * - Blank cells are skipped, so a blank first row does not decide anything.
 * - Candidate formats come from values spread across the column, and each is
 *   scored against every row (about 5,000 evenly spaced rows past 100,000), so a
 *   day of 13 or more anywhere settles day/month order.
 * - The winner must read more than half of the non-blank values it was scored on.
 *
 * - When the day and month could be either way round (every day value is 12 or
 *   less), `opts.order` ('day' or 'month') decides. Without it the earlier
 *   candidate wins, as it always has; the importer always passes an order and
 *   shows the user the ambiguity (see guessDateDetails).
 *
 * Returns -1 if the guesser throws.
 * @param {unknown[]} dates
 * @param {{ order?: 'day' | 'month' | null }} [opts]
 * @returns {string | string[] | -1}
 */
export function guessDateofArray(dates, opts = {}) {
	const details = guessDateDetails(dates);
	const dm = details.dayMonth;
	if (dm?.ambiguous && (opts.order === 'day' || opts.order === 'month')) {
		return opts.order === 'day' ? dm.dayFirst : dm.monthFirst;
	}
	return details.format;
}

// Numeric day and month tokens (D/DD, M/MM). MMM and Do are words or ordinals,
// so a format using them is never ambiguous.
const DAY_TOKENS = new Set(['D', 'DD']);
const MONTH_TOKENS = new Set(['M', 'MM']);

/**
 * The format with its numeric day and month tokens swapped, and which comes
 * first in the original, or null when the format does not have exactly one
 * numeric day token and one numeric month token.
 * @param {string} fmt
 * @returns {{ swapped: string, dayFirst: boolean, yearFirst: boolean } | null}
 */
function swapDayMonth(fmt) {
	const tokens = [...fmt.matchAll(DAYJS_FORMAT_TOKENS)].filter((m) => m[1] === undefined);
	const days = tokens.filter((m) => DAY_TOKENS.has(m[0]));
	const months = tokens.filter((m) => MONTH_TOKENS.has(m[0]));
	// "DDD" (day of year) lexes as DD + D, so it fails the one-day-token test.
	if (days.length !== 1 || months.length !== 1) return null;
	const year = tokens.find((m) => m[0].startsWith('Y'));
	const d = days[0];
	const m = months[0];
	let swapped = '';
	let last = 0;
	for (const t of [d, m].sort((a, b) => a.index - b.index)) {
		swapped += fmt.slice(last, t.index);
		swapped += t === d ? t[0].replace(/D/g, 'M') : t[0].replace(/M/g, 'D');
		last = t.index + t[0].length;
	}
	swapped += fmt.slice(last);
	return {
		swapped,
		dayFirst: d.index < m.index,
		yearFirst: year !== undefined && year.index < Math.min(d.index, m.index)
	};
}

/** Date cells another parser already turned into Date objects, back to ISO text. */
function datesToText(values) {
	return values.map((v) =>
		v instanceof Date && Number.isFinite(v.valueOf()) ? v.toISOString() : v
	);
}

/**
 * The best time format for a column (see guessDateofArray), plus whether its
 * day and month order is settled by the values.
 *
 * `dayMonth` is null when the format has no numeric day and month; otherwise
 * `{ ambiguous, dayFirst, monthFirst }`, the two readings of the column, and
 * `ambiguous` is true when both read exactly as many values (every day value
 * is 12 or less). Year-first dates are read year-month-day, as ISO 8601 has
 * them, and are never ambiguous.
 * @param {unknown[]} dates
 * @returns {{ format: string | string[] | -1, dayMonth: { ambiguous: boolean, dayFirst: string, monthFirst: string } | null }}
 */
export function guessDateDetails(dates) {
	const none = { format: [], dayMonth: null };
	try {
		if (!Array.isArray(dates) || dates.length === 0) return none;

		let rows = datesToText(dates);
		if (rows.length > GUESS_FULL_SCAN_ROWS) {
			const idx = createSequenceArray(
				0,
				rows.length - 1,
				Math.floor((rows.length - 1) / GUESS_SPARSE_SAMPLE)
			);
			rows = idx.map((i) => rows[i]);
		}
		const nonBlank = rows.filter((v) => !isBlankCell(v));
		const text = nonBlank.filter((v) => typeof v === 'string');
		if (text.length === 0) return none;

		const candidates = new Set();
		for (const v of spread(text, GUESS_CANDIDATE_SOURCES)) {
			for (const g of guessDateFormat(v)) candidates.add(g);
		}
		if (candidates.size === 0) return none;

		// Strict parse so a token mismatch counts as a miss.
		const scoreOf = (guess) => {
			let score = 0;
			for (const v of text) {
				if (parseTimeStrict(v, guess, { utc: false }).isValid()) score++;
			}
			return score;
		};
		const scores = new Map();
		let best = null;
		let bestScore = 0;
		for (const guess of candidates) {
			const score = scoreOf(guess);
			scores.set(guess, score);
			// Ties keep the earlier candidate (first-row order), as before.
			if (score > bestScore) {
				best = guess;
				bestScore = score;
			}
		}
		// Non-text values (numbers among the text) count as misses here.
		if (best == null || bestScore * 2 <= nonBlank.length) return none;

		let dayMonth = null;
		const swap = typeof best === 'string' ? swapDayMonth(best) : null;
		if (swap) {
			const swappedScore = scores.get(swap.swapped) ?? scoreOf(swap.swapped);
			const pair = swap.dayFirst
				? { dayFirst: best, monthFirst: swap.swapped }
				: { dayFirst: swap.swapped, monthFirst: best };
			if (swap.yearFirst) {
				// YYYY-MM-DD on a tie; otherwise whichever reads more values.
				if (swap.dayFirst ? swappedScore >= bestScore : swappedScore > bestScore) {
					best = swap.swapped;
				}
			} else if (swappedScore === bestScore) {
				dayMonth = { ambiguous: true, ...pair };
			} else {
				if (swappedScore > bestScore) best = swap.swapped;
				dayMonth = { ambiguous: false, ...pair };
			}
		}
		return { format: best, dayMonth };
	} catch {
		return { format: -1, dayMonth: null };
	}
}

/**
 * The first value that only one of the two readings accepts, which settles the
 * column's day/month order, or null when every value reads both ways (or
 * neither). Scans every value, unlike the guesser's sample of a very long column.
 * @param {unknown[]} values
 * @param {string} dayFirst
 * @param {string} monthFirst
 * @returns {{ order: 'day' | 'month', index: number, value: string } | null}
 */
export function settleDayMonthOrder(values, dayFirst, monthFirst) {
	if (!Array.isArray(values)) return null;
	for (let i = 0; i < values.length; i++) {
		const v = values[i];
		if (typeof v !== 'string' || v.trim() === '') continue;
		const d = parseTimeStrict(v, dayFirst).isValid();
		const m = parseTimeStrict(v, monthFirst).isValid();
		if (d !== m) return { order: d ? 'day' : 'month', index: i, value: v };
	}
	return null;
}

/**
 * Whether the locale writes numeric dates day before month ('day', as in New
 * Zealand and most of the world) or month before day ('month', as in the US, and
 * in year-first locales such as Japan). Falls back to 'day' when Intl cannot say.
 * @param {string | string[]} [locale] defaults to the browser's
 * @returns {'day' | 'month'}
 */
export function localeDayMonthOrder(locale) {
	try {
		const parts = new Intl.DateTimeFormat(locale, {
			day: 'numeric',
			month: 'numeric',
			year: 'numeric',
			timeZone: 'UTC'
		}).formatToParts(new Date(Date.UTC(2024, 10, 22)));
		const types = parts.map((p) => p.type);
		return types.indexOf('month') < types.indexOf('day') ? 'month' : 'day';
	} catch {
		return 'day';
	}
}

/**
 * How many non-blank raw time values came out of parsing as missing. `parsed` is
 * the epoch-ms array Column.getData produced from `raw`, index for index.
 * @param {unknown[]} raw
 * @param {unknown[]} parsed
 * @returns {{ nonBlank: number, failed: number, example: unknown }}
 */
export function countUnparsedTimes(raw, parsed) {
	let nonBlank = 0;
	let failed = 0;
	let example;
	if (!Array.isArray(raw) || !Array.isArray(parsed)) return { nonBlank, failed, example };
	for (let i = 0; i < raw.length; i++) {
		if (isBlankCell(raw[i])) continue;
		nonBlank++;
		const v = parsed[i];
		if (v == null || !Number.isFinite(Number(v))) {
			failed++;
			if (failed === 1) example = raw[i];
		}
	}
	return { nonBlank, failed, example };
}

/**
 * Whether a parse-failure count is worth telling the user about: at least one
 * value, and at least one in a thousand of the non-blank values (so a stray footer
 * cell in a million-row file stays quiet).
 */
export function shouldWarnUnparsedTimes({ nonBlank, failed }) {
	return failed > 0 && failed >= nonBlank * 0.001;
}

/**
 * Display text for one cell of a time column: the raw text when it parsed, a
 * formatted date when the stored value is epoch ms, and '-' when the value is
 * missing or did not parse. Never renders a missing value as 1 Jan 1970.
 * @param {unknown} raw the stored value (text, or epoch ms)
 * @param {unknown} parsedMs the value Column.getData produced for it
 * @returns {string}
 */
export function timeCellText(raw, parsedMs) {
	if (isBlankCell(raw)) return '-';
	const ms = Number(parsedMs);
	if (parsedMs == null || !Number.isFinite(ms)) return '-';
	return typeof raw === 'number' ? formatTimeFromUNIX(ms) : String(raw);
}

// `dateFormat` is a moment-style token string (e.g. 'YYYY-MM-DD HH:mm:ss')
// — the same vocabulary saved sessions store, since `convertFormat` (which
// previously translated to Luxon tokens) has been removed.
export function calculateTimeDifference(start, end, dateFormat) {
	if (start === null || end === null || start === undefined || end === undefined) {
		return null;
	}
	const fmt = normalizeTimeFormat(dateFormat);
	const startDt = parseTimeStrict(start, fmt, { utc: false });
	const endDt = parseTimeStrict(end, fmt, { utc: false });
	// dayjs.diff returns a number; pass `true` for fractional hours.
	return endDt.diff(startDt, 'hour', true).toFixed(decimalPlaces);
}

//get the minimum period and if all the steps are the same
export function getPeriod(timeData, timefmt) {
	let diffs = new Array(timeData.length - 1);
	for (let i = 1; i < timeData.length; i++) {
		diffs[i - 1] = calculateTimeDifference(timeData[i - 1], timeData[i], timefmt);
	}

	return {
		minDiff: min(diffs),
		constant: min(diffs) === max(diffs)
	};
}

// Takes in an inputted value (ISO format) and the first time and format of
//data. Calculates the offset for actograms (and other plots).
export function getstartTimeOffset(inputTime, firstTime, timeFormat) {
	const start = dayjs(inputTime);
	const end = parseTimeStrict(firstTime, normalizeTimeFormat(timeFormat), { utc: false });
	return end.diff(start, 'hour', true).toFixed(decimalPlaces);
}

export function makeTimeProcessedData(rawData) {
	let guessedFormat = guessDateofArray(rawData);
	const dataout = rawData.map((date) => {
		calculateTimeDifference(rawData[0], date, guessedFormat);
	});
	return dataout;
}

export function getGuessedFormat(dataIN) {
	//get the format
	let guessedFormat = guessDateofArray(dataIN);

	return guessedFormat;
}

export function forceFormat(dataIN, formatIN) {
	const dataout = dataIN.map((date) => calculateTimeDifference(dataIN[0], date, formatIN));
	return dataout;
}

export function formatTimeFromUNIX(timeUNIX) {
	if (timeUNIX == null || !Number.isFinite(Number(timeUNIX))) return '';
	const zone = getDisplayZone();
	const dt = zone === 'utc' ? dayjs.utc(timeUNIX) : dayjs(timeUNIX).tz(zone);
	if (!dt.isValid()) return '';
	// Hand off to formatTimeFromISO so any external consumers of the wire
	// format ("DD MMM YYYY HH:mm:ss") see exactly the same string.
	return formatTimeFromISO(dt.format('YYYY-MM-DDTHH:mm:ss.SSS'));
}

// Reformat an ISO-ish "YYYY-MM-DDTHH:mm[:ss[.SSS]]" string as
// "DD MMM YYYY HH:mm:ss". Returns '' for any input we can't parse cleanly,
// rather than throwing — table plots iterate over millions of cells, so a
// single malformed value mustn't take the whole render down.
export function formatTimeFromISO(timeString) {
	if (typeof timeString !== 'string' || !timeString) return '';
	const [datePart, timePart] = timeString.split('T');
	if (!datePart || !timePart) return '';
	const [year, month, day] = datePart.split('-');
	if (year == null || month == null || day == null) return '';
	const timeParts = timePart.split(':');
	if (timeParts.length < 2) return '';
	const hours = timeParts[0];
	const minutes = timeParts[1];
	const seconds = timeParts[2] ? timeParts[2].split('.')[0] : '00';

	const monthLookup = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec'
	];
	const monthText = monthLookup[+month - 1];

	return `${day} ${monthText} ${year} ${hours}:${minutes}:${seconds}`;
}
// Both return the input unchanged when there is no format ('' or []), so numeric
// epoch-ms values pass through and text becomes NaN at the caller's Number().
export function getISODate(stringIN, formatIN) {
	if (!hasTimeFormat(formatIN)) return stringIN;
	return parseTimeStrict(stringIN, normalizeTimeFormat(formatIN)).toISOString();
}
export function getUNIXDate(stringIN, formatIN) {
	if (!hasTimeFormat(formatIN)) return stringIN;
	return parseTimeStrict(stringIN, normalizeTimeFormat(formatIN)).valueOf();
}

/**
 * A user-facing explanation of why a text time column will show blanks, or null
 * when its format reads every sampled value. Samples at most `maxSample` non-empty
 * text values so it stays cheap on large columns.
 * @param {unknown[]} values raw column values
 * @param {unknown} fmt the column's timeFormat
 * @param {number} [maxSample]
 * @returns {string | null}
 */
export function describeTimeFormatProblem(values, fmt, maxSample = 200) {
	if (!Array.isArray(values)) return null;
	const sample = [];
	for (const v of values) {
		if (typeof v === 'string' && v.trim() !== '') sample.push(v);
		if (sample.length >= maxSample) break;
	}
	if (sample.length === 0) return null;
	if (!hasTimeFormat(fmt)) {
		return `No time format was recognised for values like "${sample[0]}". Type one here (for example YYYY-MM-DD H:mm:ss) so they can be read as times; until then they are blank.`;
	}
	const normalized = Array.isArray(fmt) ? fmt.map(normalizeTimeFormat) : normalizeTimeFormat(fmt);
	const bad = sample.filter((v) => !parseTimeStrict(v, normalized).isValid());
	if (bad.length === 0) return null;
	const scope = sample.length === maxSample ? 'sampled values' : 'values';
	return `${bad.length} of ${sample.length} ${scope} (e.g. "${bad[0]}") do not match this format and will be blank.`;
}
export function addTime(start, hoursIN) {
	return formatTimeFromISO(dayjs(start).add(hoursIN, 'hour').toISOString());
}
