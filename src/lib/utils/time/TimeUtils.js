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
// exactly, as in dayjs strict mode.
function roundTripsPadTolerant(input, dt, fmt) {
	let pattern = '';
	let last = 0;
	for (const m of fmt.matchAll(DAYJS_FORMAT_TOKENS)) {
		pattern += escapeRegExp(fmt.slice(last, m.index));
		last = m.index + m[0].length;
		if (m[1] !== undefined) {
			pattern += escapeRegExp(m[1]);
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

// return a format string that's the best guess for the daata
export function guessDateofArray(dates) {
	try {
		// get the guess of the first date
		let guessedlist = guessDateFormat(dates[0]);
		//If there is no guess, then return empty array
		if (guessedlist.length === 0) return guessedlist;
		//console.log('initial list', guessedlist, 'for ', dates[0]);

		//set up the dates to check - subsample if a large dataset
		let datesToCheck = dates;
		//subsample if there are more than 100k points, subsample to 5k
		if (dates.length > 100_000) {
			const idx = createSequenceArray(0, dates.length - 1, parseInt((dates.length - 1) / 5_000));
			datesToCheck = idx.map((i) => dates[i]);
		}

		// console.log('all N: ', dates.length, ' checking ', datesToCheck.length);

		//set up the Set of all possibleguesses
		let allGuesses = new Set();
		//fill it in
		for (let i = 0; i < datesToCheck.length; i++) {
			//make guess
			const guesses = guessDateFormat(datesToCheck[i]);
			//add the guess to Map or incresae counter
			for (let j = 0; j < guesses.length; j++) {
				allGuesses.add(guesses[j]);
			}
		}

		//Now get the best one (where there are most matches)
		const guessesArray = Array.from(allGuesses);
		//console.log('ALLGUESSES: ', guessesArray);
		let guessScore = guessesArray.map((guess) => {
			let score = 0;
			for (let i = 0; i < datesToCheck.length; i++) {
				// Strict parse so a token-mismatch counts as a miss for scoring.
				if (parseTimeStrict(datesToCheck[i], guess, { utc: false }).isValid()) {
					score++;
				}
			}
			return score;
		});

		// console.log('SCORE:', guessScore);
		// console.log('best idx:', guessScore.indexOf(Math.max(...guessScore)));
		// console.log('FINAL guess:', guessesArray[guessScore.indexOf(Math.max(...guessScore))]);

		//return that one
		return guessesArray[guessScore.indexOf(Math.max(...guessScore))];
	} catch {
		return -1;
	}
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
