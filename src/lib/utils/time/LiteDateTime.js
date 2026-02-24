// @ts-nocheck
/**
 * Lightweight DateTime utility replacing Luxon's DateTime.
 *
 * Only implements the subset of Luxon's API actually used in this project:
 *   Constructors: fromISO, fromMillis, fromFormat, fromSQL, now
 *   Output:       toISO, toMillis, toFormat, toLocaleString, toUTC
 *   Manipulation: plus, diff, set, startOf
 *   Properties:   isValid, invalid
 */

const MONTHS_SHORT = [
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

// Luxon-compatible DATETIME_MED format
const DATETIME_MED = {
	year: 'numeric',
	month: 'short',
	day: 'numeric',
	hour: 'numeric',
	minute: '2-digit'
};

/**
 * The main DateTime class – a thin immutable wrapper around a JS Date.
 */
class LiteDateTime {
	/** @type {Date} */
	_d;
	/** @type {boolean} */
	_valid;
	/** @type {string} */
	_zone; // 'utc' or 'local'

	constructor(date, zone = 'local') {
		if (date instanceof Date && !isNaN(date.getTime())) {
			this._d = date;
			this._valid = true;
		} else {
			this._d = new Date(NaN);
			this._valid = false;
		}
		this._zone = zone;
	}

	// ── Properties ─────────────────────────────────────────────────────────

	/** True if the DateTime represents a valid date. */
	get isValid() {
		return this._valid;
	}

	/** null when valid, an object when invalid (mirrors Luxon's convention). */
	get invalid() {
		return this._valid ? null : { reason: 'invalid date' };
	}

	// ── Output ─────────────────────────────────────────────────────────────

	/** Return Unix epoch milliseconds. */
	toMillis() {
		return this._d.getTime();
	}

	/** Return an ISO 8601 string (always UTC when zone='utc'). */
	toISO() {
		if (!this._valid) return null;
		if (this._zone === 'utc') {
			return this._d.toISOString();
		}
		// For local zone, build an ISO-like string with offset
		const d = this._d;
		const pad = (n, w = 2) => String(n).padStart(w, '0');
		const off = -d.getTimezoneOffset();
		const sign = off >= 0 ? '+' : '-';
		const absOff = Math.abs(off);
		return (
			`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
			`T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}` +
			`${sign}${pad(Math.floor(absOff / 60))}:${pad(absOff % 60)}`
		);
	}

	/** Return a UTC version of this DateTime. */
	toUTC() {
		return new LiteDateTime(new Date(this._d.getTime()), 'utc');
	}

	/**
	 * Format using Luxon-style tokens.
	 * Supported tokens: yyyy, yy, LL, L, dd, d, HH, H, mm, m, ss, s, a, MMM, MMMM
	 */
	toFormat(fmt) {
		if (!this._valid) return 'Invalid DateTime';
		const d = this._zone === 'utc' ? _utcAccessor(this._d) : _localAccessor(this._d);
		return _applyFormat(fmt, d);
	}

	/**
	 * Locale-aware string (mirrors luxon's toLocaleString).
	 * @param {object} formatObj – Intl.DateTimeFormat options (e.g. DateTime.DATETIME_MED)
	 */
	toLocaleString(formatObj) {
		if (!this._valid) return 'Invalid DateTime';
		if (this._zone === 'utc') {
			return new Intl.DateTimeFormat('en-US', { ...formatObj, timeZone: 'UTC' }).format(this._d);
		}
		return new Intl.DateTimeFormat('en-US', formatObj).format(this._d);
	}

	// ── Manipulation ───────────────────────────────────────────────────────

	/**
	 * Return a new DateTime with the given duration added.
	 * @param {{ hours?: number, minutes?: number, seconds?: number, milliseconds?: number, days?: number }} dur
	 */
	plus(dur) {
		if (!this._valid) return this;
		let ms = this._d.getTime();
		if (dur.hours) ms += dur.hours * 3_600_000;
		if (dur.minutes) ms += dur.minutes * 60_000;
		if (dur.seconds) ms += dur.seconds * 1_000;
		if (dur.milliseconds) ms += dur.milliseconds;
		if (dur.days) ms += dur.days * 86_400_000;
		return new LiteDateTime(new Date(ms), this._zone);
	}

	/**
	 * Calculate the difference between this DateTime and another.
	 * Returns an object with the requested unit (e.g. { hours: 2.5 }).
	 * @param {LiteDateTime} other
	 * @param {string} unit – 'hours' | 'minutes' | 'seconds' | 'milliseconds'
	 */
	diff(other, unit = 'milliseconds') {
		const diffMs = this._d.getTime() - other._d.getTime();
		const divisors = {
			hours: 3_600_000,
			minutes: 60_000,
			seconds: 1_000,
			milliseconds: 1
		};
		const val = diffMs / (divisors[unit] ?? 1);
		return { [unit]: val };
	}

	/**
	 * Return a new DateTime with specific fields overridden.
	 * @param {{ year?: number, month?: number, day?: number, hour?: number, minute?: number, second?: number, millisecond?: number }} values
	 */
	set(values) {
		if (!this._valid) return this;
		const d = new Date(this._d.getTime());
		if (this._zone === 'utc') {
			if (values.year !== undefined) d.setUTCFullYear(values.year);
			if (values.month !== undefined) d.setUTCMonth(values.month - 1);
			if (values.day !== undefined) d.setUTCDate(values.day);
			if (values.hour !== undefined) d.setUTCHours(values.hour);
			if (values.minute !== undefined) d.setUTCMinutes(values.minute);
			if (values.second !== undefined) d.setUTCSeconds(values.second);
			if (values.millisecond !== undefined) d.setUTCMilliseconds(values.millisecond);
		} else {
			if (values.year !== undefined) d.setFullYear(values.year);
			if (values.month !== undefined) d.setMonth(values.month - 1);
			if (values.day !== undefined) d.setDate(values.day);
			if (values.hour !== undefined) d.setHours(values.hour);
			if (values.minute !== undefined) d.setMinutes(values.minute);
			if (values.second !== undefined) d.setSeconds(values.second);
			if (values.millisecond !== undefined) d.setMilliseconds(values.millisecond);
		}
		return new LiteDateTime(d, this._zone);
	}

	/**
	 * Return a new DateTime set to the start of the given unit.
	 * @param {'day'|'hour'|'minute'|'second'} unit
	 */
	startOf(unit) {
		if (!this._valid) return this;
		const d = new Date(this._d.getTime());
		if (this._zone === 'utc') {
			if (unit === 'day' || unit === 'hour' || unit === 'minute' || unit === 'second')
				d.setUTCMilliseconds(0);
			if (unit === 'day' || unit === 'hour' || unit === 'minute') d.setUTCSeconds(0);
			if (unit === 'day' || unit === 'hour') d.setUTCMinutes(0);
			if (unit === 'day') d.setUTCHours(0);
		} else {
			if (unit === 'day' || unit === 'hour' || unit === 'minute' || unit === 'second')
				d.setMilliseconds(0);
			if (unit === 'day' || unit === 'hour' || unit === 'minute') d.setSeconds(0);
			if (unit === 'day' || unit === 'hour') d.setMinutes(0);
			if (unit === 'day') d.setHours(0);
		}
		return new LiteDateTime(d, this._zone);
	}
}

// ── Static constructors (exported as the DateTime namespace) ─────────────────

/** Create from an ISO 8601 string. */
function fromISO(str, opts = {}) {
	if (str == null) return new LiteDateTime(new Date(NaN));
	const zone = opts.zone ?? 'local';
	const d = new Date(str);
	return new LiteDateTime(d, zone);
}

/** Create from Unix milliseconds. */
function fromMillis(ms, opts = {}) {
	const zone = opts.zone ?? 'local';
	return new LiteDateTime(new Date(ms), zone);
}

/** Current date/time. */
function now() {
	return new LiteDateTime(new Date(), 'local');
}

/**
 * Parse a date string using a Luxon-style format string.
 * Supports tokens: yyyy, yy, MMMM, MMM, MM, M, LL, L, dd, d, HH, H, hh, h, mm, m, ss, s, a
 *
 * @param {string} str – the date string to parse
 * @param {string} fmt – the Luxon format string
 * @param {{ locale?: string, zone?: string }} opts
 */
function fromFormat(str, fmt, opts = {}) {
	if (str == null || fmt == null) return new LiteDateTime(new Date(NaN));
	const zone = opts.zone ?? 'local';

	try {
		const parts = _parseWithFormat(str, fmt);
		if (!parts) return new LiteDateTime(new Date(NaN));

		let { year, month, day, hour, minute, second, millisecond } = parts;

		// Handle 2-digit years
		if (year !== undefined && year < 100) {
			year += year < 50 ? 2000 : 1900;
		}

		// Handle AM/PM
		if (parts.ampm !== undefined) {
			const ap = parts.ampm.toLowerCase();
			if (ap === 'pm' && hour < 12) hour += 12;
			if (ap === 'am' && hour === 12) hour = 0;
		}

		let d;
		if (zone === 'utc') {
			d = new Date(
				Date.UTC(
					year ?? 1970,
					(month ?? 1) - 1,
					day ?? 1,
					hour ?? 0,
					minute ?? 0,
					second ?? 0,
					millisecond ?? 0
				)
			);
		} else {
			d = new Date(
				year ?? 1970,
				(month ?? 1) - 1,
				day ?? 1,
				hour ?? 0,
				minute ?? 0,
				second ?? 0,
				millisecond ?? 0
			);
		}

		return new LiteDateTime(d, zone);
	} catch {
		return new LiteDateTime(new Date(NaN));
	}
}

/**
 * Parse an SQL-style datetime string ("2023-10-15 14:30:00").
 */
function fromSQL(str, opts = {}) {
	if (str == null) return new LiteDateTime(new Date(NaN));
	const zone = opts.zone ?? 'local';
	// Replace space with T for ISO compatibility
	const iso = str.trim().replace(' ', 'T');
	const d = new Date(iso);
	return new LiteDateTime(d, zone);
}

// ── Internal format parsing helpers ──────────────────────────────────────────

/**
 * Build a tokenized regex from a Luxon format string and extract date parts.
 */
function _parseWithFormat(str, fmt) {
	// Token definitions: token → { regex, handler }
	const tokens = [
		{ tok: 'yyyy', re: '(\\d{4})', key: 'year', parse: (v) => parseInt(v, 10) },
		{ tok: 'yy', re: '(\\d{2})', key: 'year', parse: (v) => parseInt(v, 10) },
		{
			tok: 'MMMM',
			re: '([A-Za-z]+)',
			key: 'month',
			parse: (v) => _monthNameToNum(v)
		},
		{
			tok: 'MMM',
			re: '([A-Za-z]+)',
			key: 'month',
			parse: (v) => _monthNameToNum(v)
		},
		{ tok: 'MM', re: '(\\d{2})', key: 'month', parse: (v) => parseInt(v, 10) },
		{ tok: 'M', re: '(\\d{1,2})', key: 'month', parse: (v) => parseInt(v, 10) },
		{ tok: 'LL', re: '(\\d{2})', key: 'month', parse: (v) => parseInt(v, 10) },
		{ tok: 'L', re: '(\\d{1,2})', key: 'month', parse: (v) => parseInt(v, 10) },
		{ tok: 'dd', re: '(\\d{2})', key: 'day', parse: (v) => parseInt(v, 10) },
		{ tok: 'd', re: '(\\d{1,2})', key: 'day', parse: (v) => parseInt(v, 10) },
		{ tok: 'HH', re: '(\\d{2})', key: 'hour', parse: (v) => parseInt(v, 10) },
		{ tok: 'H', re: '(\\d{1,2})', key: 'hour', parse: (v) => parseInt(v, 10) },
		{ tok: 'hh', re: '(\\d{2})', key: 'hour', parse: (v) => parseInt(v, 10) },
		{ tok: 'h', re: '(\\d{1,2})', key: 'hour', parse: (v) => parseInt(v, 10) },
		{ tok: 'mm', re: '(\\d{2})', key: 'minute', parse: (v) => parseInt(v, 10) },
		{ tok: 'm', re: '(\\d{1,2})', key: 'minute', parse: (v) => parseInt(v, 10) },
		{ tok: 'ss', re: '(\\d{2})', key: 'second', parse: (v) => parseInt(v, 10) },
		{ tok: 's', re: '(\\d{1,2})', key: 'second', parse: (v) => parseInt(v, 10) },
		{
			tok: 'SSS',
			re: '(\\d{3})',
			key: 'millisecond',
			parse: (v) => parseInt(v, 10)
		},
		{ tok: 'a', re: '([AaPp][Mm])', key: 'ampm', parse: (v) => v }
	];

	// Sort tokens longest first to avoid partial matches
	tokens.sort((a, b) => b.tok.length - a.tok.length);

	// Build regex from format string
	let regexStr = '';
	const handlers = [];
	let i = 0;

	while (i < fmt.length) {
		// Check for quoted literals (e.g. 'T')
		if (fmt[i] === "'") {
			let j = i + 1;
			while (j < fmt.length && fmt[j] !== "'") j++;
			const literal = fmt.substring(i + 1, j);
			regexStr += _escapeRegex(literal);
			i = j + 1;
			continue;
		}

		// Try matching a token
		let matched = false;
		for (const t of tokens) {
			if (fmt.startsWith(t.tok, i)) {
				regexStr += t.re;
				handlers.push(t);
				i += t.tok.length;
				matched = true;
				break;
			}
		}

		if (!matched) {
			// Literal character
			regexStr += _escapeRegex(fmt[i]);
			i++;
		}
	}

	const regex = new RegExp('^' + regexStr + '$');
	const match = str.match(regex);
	if (!match) return null;

	const result = {};
	for (let g = 0; g < handlers.length; g++) {
		const val = handlers[g].parse(match[g + 1]);
		if (val === undefined || val === null || (typeof val === 'number' && isNaN(val))) return null;
		result[handlers[g].key] = val;
	}

	return result;
}

function _monthNameToNum(name) {
	const lower = name.toLowerCase().substring(0, 3);
	const idx = MONTHS_SHORT.findIndex((m) => m.toLowerCase() === lower);
	return idx >= 0 ? idx + 1 : undefined;
}

function _escapeRegex(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Format output helpers ────────────────────────────────────────────────────

/** Accessor for UTC date components. */
function _utcAccessor(d) {
	return {
		year: d.getUTCFullYear(),
		month: d.getUTCMonth() + 1,
		day: d.getUTCDate(),
		hour: d.getUTCHours(),
		minute: d.getUTCMinutes(),
		second: d.getUTCSeconds(),
		ms: d.getUTCMilliseconds()
	};
}

/** Accessor for local date components. */
function _localAccessor(d) {
	return {
		year: d.getFullYear(),
		month: d.getMonth() + 1,
		day: d.getDate(),
		hour: d.getHours(),
		minute: d.getMinutes(),
		second: d.getSeconds(),
		ms: d.getMilliseconds()
	};
}

/** Apply a Luxon format string to date parts. */
function _applyFormat(fmt, p) {
	const pad = (n, w = 2) => String(n).padStart(w, '0');

	const tokenMap = {
		yyyy: () => String(p.year),
		yy: () => pad(p.year % 100),
		MMMM: () => {
			const names = [
				'January',
				'February',
				'March',
				'April',
				'May',
				'June',
				'July',
				'August',
				'September',
				'October',
				'November',
				'December'
			];
			return names[p.month - 1];
		},
		MMM: () => MONTHS_SHORT[p.month - 1],
		MM: () => pad(p.month),
		M: () => String(p.month),
		LL: () => pad(p.month),
		L: () => String(p.month),
		dd: () => pad(p.day),
		d: () => String(p.day),
		HH: () => pad(p.hour),
		H: () => String(p.hour),
		hh: () => pad(p.hour > 12 ? p.hour - 12 : p.hour || 12),
		h: () => String(p.hour > 12 ? p.hour - 12 : p.hour || 12),
		mm: () => pad(p.minute),
		m: () => String(p.minute),
		ss: () => pad(p.second),
		s: () => String(p.second),
		SSS: () => String(p.ms).padStart(3, '0'),
		a: () => (p.hour < 12 ? 'AM' : 'PM')
	};

	// Sort token keys longest first
	const sortedTokens = Object.keys(tokenMap).sort((a, b) => b.length - a.length);

	let result = '';
	let i = 0;
	while (i < fmt.length) {
		// Handle quoted literals
		if (fmt[i] === "'") {
			let j = i + 1;
			while (j < fmt.length && fmt[j] !== "'") j++;
			result += fmt.substring(i + 1, j);
			i = j + 1;
			continue;
		}

		let matched = false;
		for (const tok of sortedTokens) {
			if (fmt.startsWith(tok, i)) {
				result += tokenMap[tok]();
				i += tok.length;
				matched = true;
				break;
			}
		}

		if (!matched) {
			result += fmt[i];
			i++;
		}
	}

	return result;
}

// ── Export the DateTime namespace ─────────────────────────────────────────────

export const DateTime = {
	fromISO,
	fromMillis,
	fromFormat,
	fromSQL,
	now,
	DATETIME_MED
};
