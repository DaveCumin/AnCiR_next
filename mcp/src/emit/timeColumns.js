// Time columns in an MCP session: their text format, their zone, and how a session file's
// columns read on the clock (per-column time zone, phase 4; plan
// ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, sections 3.2, 3.9 and 5e).
//
// Pure and dependency-free like the normalizer (it runs in the Cloudflare Worker): the zone
// rules come from the app's own pure modules, so a zone is refused, stored and worded exactly
// as the app does it:
//   zoneNames.js        which strings are zones and their stored form ('+0530' → '+05:30')
//   zoneNotes.js        the Join Data warning and the mixed-zone plot notes
//   offsetFormat.js     whether a time format names instants (Z, +13:00) or a wall clock
//   zoneResolver.js     how a zone reads a wall clock: its repeated and skipped hours
//   dstCountWarnings.js what a column with such hours says
//
// Used by the normalizer (a draft's `columns`), by the engine's import_data (the same text
// rules), and by the Worker's check_draft and describe_session (reading a session file).

import {
	normalizeZone,
	zoneLabel,
	fixedOffsetMinutes,
	UTC_ZONE
} from '../../../src/lib/utils/time/zoneNames.js';
// Whether a format reads an offset (Z / ZZ, or a literal Z after the time: ISO's UTC designator),
// the app's own rule (TimeUtils.js formatHasOffset).
import { formatReadsOffset } from '../../../src/lib/utils/time/offsetFormat.js';
import {
	joinZoneNotes,
	actogramMixedZonesNote,
	axisMixedZonesNote
} from '../../../src/lib/utils/time/zoneNotes.js';
// The app's own wall-clock resolver and its daylight-saving wording (both pure, Intl only), so
// check_draft counts and words a column's skipped and repeated hours exactly as the app does.
import { resolveWallClocks } from '../../../src/lib/utils/time/zoneResolver.js';
import { dstCountWarnings } from '../../../src/lib/utils/time/dstCountWarnings.js';

// ISO 8601 as a time column takes it: a date, optionally a time (T or a space), optionally
// seconds and milliseconds (3 decimals, as toISOString writes them), and an offset (Z, ±HH:MM or ±HHMM) only after a time.
const ISO_RE =
	/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

const blank = (v) => v == null || v === '';
const isEpoch = (v) =>
	typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));

/**
 * The dayjs-style format of one ISO 8601 value (already matched by ISO_RE), in the vocabulary
 * the app's parser reads (utils/time/TimeUtils.js parseTimeStrict): two-digit fields,
 * milliseconds (SSS; the app reads a lone S as Luxon's, so only 3 decimals are taken), and an offset read by the Z token ("Z", "+13:00") or ZZ ("+1300").
 * "Z" is read as what it says, UTC, so such times are instants and a zone on the column only
 * names their clock. (The app's import guesser writes a trailing Z as a literal "[Z]", which the
 * app also reads as UTC: offsetFormat.js.)
 */
function isoFormat(text) {
	const m =
		/^(\d{4}-\d{2}-\d{2})(?:([T ])\d{2}:\d{2}(?::\d{2}(?:\.(\d{3}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
			text
		);
	if (!m) return null;
	let fmt = 'YYYY-MM-DD';
	if (m[2]) {
		fmt += m[2] === 'T' ? '[T]HH:mm' : ' HH:mm';
		const afterMinutes = text.slice(16);
		if (afterMinutes.startsWith(':')) fmt += ':ss';
		if (m[3]) fmt += '.SSS';
	}
	if (m[4]) fmt += m[4] === 'Z' || m[4].includes(':') ? 'Z' : 'ZZ';
	return fmt;
}

/**
 * The `timeFormat` a time column's values need, the way the app's import reads them.
 *
 * Epoch ms (numbers, or numeric text) need none: `{ format: null }`, unchanged from before.
 * ISO 8601 text gets its exact format (`isoFormat`), one per distinct shape (a list when the
 * shapes differ, which the app tries in turn). Without
 * a format the app reads text times as blanks, so text that is not ISO 8601, or that mixes
 * epoch numbers with text, or times with and without an offset, is refused.
 *
 * @param {string} name
 * @param {unknown[]} values
 * @returns {{ format: string|string[]|null } | { error: string }}
 */
export function timeTextFormat(name, values) {
	let epoch = 0;
	const formats = new Map(); // shape → format
	for (let i = 0; i < values.length; i++) {
		const v = values[i];
		if (blank(v)) continue;
		if (isEpoch(v)) {
			epoch++;
			continue;
		}
		const text = typeof v === 'string' ? v.trim() : v;
		if (typeof text !== 'string' || !ISO_RE.test(text)) {
			return {
				error: `Column "${name}" is type "time" but values[${i}] is ${JSON.stringify(v)}. Write times as ISO 8601 text ("2024-04-01T13:00:00", seconds and milliseconds optional, optionally ending in "Z" or an offset such as "+13:00") or as epoch milliseconds.`
			};
		}
		const shape = text.replace(/\d/g, '9').replace(/[+-](?=99:?99$)/, '±');
		if (!formats.has(shape)) formats.set(shape, isoFormat(text));
	}
	if (formats.size === 0) return { format: null };
	if (epoch > 0) {
		return {
			error: `Column "${name}" mixes epoch numbers and text times. Use one or the other.`
		};
	}
	const list = [...new Set(formats.values())];
	const withOffset = list.filter(formatReadsOffset).length;
	if (withOffset > 0 && withOffset < list.length) {
		return {
			error: `Column "${name}" has some times with an offset (such as "Z" or "+13:00") and some without. Write them all one way.`
		};
	}
	return { format: list.length === 1 ? list[0] : list };
}

/**
 * The zone a column asks for (`time_zone`, or `timeZone` as a session file spells it), as the
 * app stores it: null when none is given or it is 'utc' (the app's import saves no zone for
 * 'utc', so the column saves as before), else the canonical zone. A zone the app does not know,
 * or a zone on a column that is not a time column, is refused.
 *
 * @param {{ name?: string, type?: string, time_zone?: unknown, timeZone?: unknown }} c
 * @returns {{ zone: string|null } | { error: string }}
 */
export function columnZoneOf(c) {
	const raw = c?.time_zone ?? c?.timeZone;
	if (raw == null || raw === '') return { zone: null };
	const name = c?.name ?? 'unnamed';
	if ((c?.type ?? 'number') !== 'time') {
		return {
			error: `Column "${name}": time_zone is only for a time column (type "time"), not "${c?.type ?? 'number'}".`
		};
	}
	const z = normalizeZone(raw);
	if (!z) {
		return {
			error: `Column "${name}": time_zone ${JSON.stringify(raw)} is not a time zone. Use an IANA name such as "Pacific/Auckland" (follows daylight saving), a fixed offset such as "+12:00" (never changes), or "utc".`
		};
	}
	return { zone: z === UTC_ZONE ? null : z };
}

// ─── Reading a session file ─────────────────────────────────────────────────

const MAX_DEPTH = 64;

/** Whether a source column's stored text names no instant (app: readsWallClockText). */
function readsWallClockText(col, session) {
	if (col.compression === 'awd') return true;
	const raw = session.rawData?.[col.data] ?? session.rawData?.[col.id];
	const first = Array.isArray(raw) ? raw.find((v) => v != null && v !== '') : undefined;
	if (typeof first === 'number') return false;
	const fmts = (Array.isArray(col.timeFormat) ? col.timeFormat : [col.timeFormat]).filter(
		(f) => typeof f === 'string' && f.trim()
	);
	return !fmts.some(formatReadsOffset);
}

const isColumnId = (v) => Number.isInteger(v) && v >= 0;

/** An `out` value as a column id (a number, or digits as text), else null (app: outIdOf). */
function outIdOf(v) {
	if (typeof v === 'number') return isColumnId(v) ? v : null;
	if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
	return null;
}

// Which analysis outputs the app types 'time' when it computes them. In a draft (and in a
// session the Worker stores) they are pre-allocated as number columns with no data, so a
// session file alone does not say which are times: these rules do, as each node's compute
// writes them. Pinned against the real nodes by mcp/test/emit.timezone.app.test.js, which runs
// every node in the registry and compares.
//
//   FIT_X      the fitted curve's x: time when the x input is time, or when "Specify output x"
//              names a time column (column mode; utils/outputXSequence.js resolveOutputX and
//              utils/phaseReference.js fitTimeFrame give it a time origin either way).
//   X_FOLLOWS  an x output that is time exactly when the x input is (Bin Data, Smooth,
//              Interpolate, Moving Analysis, Crossing's crossing times).
//   PER_INPUT  outputs keyed by the input column they copy, typed as that column is: Sort's
//              sortedy_<id>, Split's <id>_<n>, Collect Columns' col_<id>, Join Data's joined_<id>.
//   Join Data's jointime (both time inputs are times), Long To Wide's and Wide To Long's time
//   (the time input's type) and value outputs (the value input's type) are spelled out below.
const FIT_X = {
	Cosinor: 'cosinorx',
	FitFunction: 'fitx',
	DoubleLogistic: 'dlogx',
	RectangularWave: 'rectwavex',
	TrendFit: 'trendx'
};
const X_FOLLOWS = {
	BinnedData: 'binnedx',
	SmoothedData: 'smoothedx',
	Interpolate: 'interpx',
	MovingAnalysis: 'movex',
	Crossing: 'crossing'
};
const PER_INPUT = {
	Sort: /^sortedy_(\d+)$/,
	Split: /^(\d+)_\d+$/,
	CollectColumns: /^col_(\d+)$/,
	JoinData: /^joined_(\d+)$/
};

/** The column whose values a fit's output x takes in column mode, or null (outputXColumnId). */
function fitOutputXColumn(args) {
	const specified = args?.outputX != null && args.outputX !== -1;
	return specified && args.outputXMode !== 'sequence' ? args.outputX : null;
}

/**
 * Whether the analysis `tp` types its output `key` as time, given which columns are times.
 * @param {object} tp a session table process
 * @param {string} key an `out` key
 * @param {(id: unknown) => boolean} isTime
 */
function outputIsTime(tp, key, isTime) {
	const a = tp?.args ?? {};
	const name = tp?.name;
	if (FIT_X[name] === key) return isTime(a.xIN) || isTime(fitOutputXColumn(a));
	if (X_FOLLOWS[name] === key) return isTime(a.xIN);
	const m = PER_INPUT[name]?.exec(key);
	if (m) return isTime(Number(m[1]));
	if (name === 'JoinData' && key === 'jointime') return isTime(a.aTimeIN) && isTime(a.bTimeIN);
	if ((name === 'LongToWide' || name === 'WideToLong') && key === 'time') return isTime(a.timeIN);
	if (name === 'LongToWide' && key.startsWith('value_')) return isTime(a.valueIN);
	if (name === 'WideToLong' && key === 'value') {
		const first = Array.isArray(a.valueColIds) ? a.valueColIds[0] : a.valueColIds;
		return isTime(first);
	}
	return false;
}

const typerCache = new WeakMap();

/**
 * `isTime(id)` for a session file: whether column `id` is a time column once the app has
 * loaded and computed the session. A column typed 'time' in the file is; a reference reads its
 * target's type (Column.type); an analysis output is when its node writes it as time
 * (`outputIsTime`, which may in turn ask about an output upstream).
 * @param {object} session
 * @returns {(id: unknown) => boolean}
 */
export function sessionTimeTyper(session) {
	const hit = typerCache.get(session);
	if (hit) return hit;
	const byId = new Map((session.data ?? []).map((c) => [c.id, c]));
	const owner = new Map(); // output column id → { tp, key }
	for (const tp of session.tableProcesses ?? []) {
		for (const [key, v] of Object.entries(tp?.args?.out ?? {})) {
			const id = outIdOf(v);
			if (id != null && !owner.has(id)) owner.set(id, { tp, key });
		}
	}
	const memo = new Map();
	const isTime = (raw) => {
		const id = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
		if (!isColumnId(id)) return false;
		if (memo.has(id)) return memo.get(id);
		memo.set(id, false); // a cycle reads as not time
		const col = byId.get(id);
		let r = false;
		if (!col) r = false;
		else if (col.refId != null) r = col.refId !== -1 && isTime(col.refId);
		else if (col.type === 'time') r = true;
		else {
			const o = owner.get(id);
			r = o ? outputIsTime(o.tp, o.key, isTime) : false;
		}
		memo.set(id, r);
		return r;
	};
	if (session && typeof session === 'object') typerCache.set(session, isTime);
	return isTime;
}

/** The analysis whose `out` writes column `id`, or null (app: owningTableProcess). */
function owningAnalysis(session, id) {
	for (const tp of session.tableProcesses ?? []) {
		for (const v of Object.values(tp?.args?.out ?? {})) if (outIdOf(v) === id) return tp;
	}
	return null;
}

/** The input column a free process output derives from (app: producerInputColId). */
function producerInputId(session, producerNodeId, producerPort) {
	const m = /^process_(\d+)$/.exec(typeof producerNodeId === 'string' ? producerNodeId : '');
	if (!m) return null;
	const proc = (session.orphanProcesses ?? []).find((p) => p?.id === Number(m[1]));
	if (!proc) return null;
	const port = /^out_(\d+)$/.exec(producerPort || 'output');
	if (port) return Number(port[1]);
	const inIN = proc.args?.inIN;
	return Array.isArray(inIN) ? (inIN.length ? inIN[0] : null) : (inIN ?? null);
}

/**
 * The column whose own zone a session column's clock follows, as the app decides it
 * (core/columnTimeZone.js timeZoneSource): itself for a source column; a reference's target;
 * a free process output's input; an analysis output's FIRST time input in argument order
 * (Join Data's output takes A's zone), counting inputs that become times when computed.
 * Null when the chain is broken (a generator's time output has no time input: as written, UTC).
 */
function zoneSource(session, col) {
	const byId = new Map((session.data ?? []).map((c) => [c.id, c]));
	const isTime = sessionTimeTyper(session);
	const seen = new Set();
	let cur = col;
	for (let depth = 0; cur && depth < MAX_DEPTH; depth++) {
		if (seen.has(cur.id)) return null;
		seen.add(cur.id);
		if (cur.refId != null) {
			if (cur.refId === -1) return null;
			cur = byId.get(cur.refId) ?? null;
			continue;
		}
		if (cur.producerNodeId != null) {
			cur = byId.get(producerInputId(session, cur.producerNodeId, cur.producerPort)) ?? null;
			continue;
		}
		const tp = owningAnalysis(session, cur.id);
		if (tp) {
			let next = null;
			for (const [key, value] of Object.entries(tp.args ?? {})) {
				if (!key.endsWith('IN')) continue;
				for (const v of Array.isArray(value) ? value : [value]) {
					if (!isColumnId(v)) continue;
					const c = byId.get(v);
					if (c && isTime(v)) {
						next = c;
						break;
					}
				}
				if (next) break;
			}
			cur = next;
			continue;
		}
		return cur;
	}
	return null;
}

/**
 * How a session column reads on the clock: `{ named, wall, legacy, from }`, the shape the app's
 * `columnClock` gives (core/columnTimeZone.js) for a session with no legacy zone (an MCP
 * session never has one). `named` the zone, `wall` true when the times are text with no zone
 * kept "as written" (UTC), `from` the source column when the zone is inherited.
 * @param {object} session a session file (`data`, `rawData`, `tableProcesses`)
 * @param {number} id a column id
 */
export function sessionColumnClock(session, id) {
	return clockAndSource(session, id).clock;
}

function clockAndSource(session, id) {
	const col = (session.data ?? []).find((c) => c.id === id);
	const src = col ? zoneSource(session, col) : null;
	if (!src || !sessionTimeTyper(session)(src.id)) {
		return { clock: { named: UTC_ZONE, wall: true, legacy: false, from: null }, src: null };
	}
	const named = normalizeZone(src.timeZone) ?? UTC_ZONE;
	const wall = named === UTC_ZONE && readsWallClockText(src, session);
	return {
		clock: { named, wall, legacy: false, from: src !== col ? src.name : null },
		src
	};
}

/**
 * A time column's zone for describe_session: `{ timeZone, times, from? }`. `times` says how
 * its stored times relate to the zone:
 *   'as written'    text with no zone, left in UTC: shown exactly as written
 *   'wall clock'    text with no zone, read in its zone (daylight saving included)
 *   'instants'      epoch ms or text with offsets: the zone only names the clock
 * @param {object} session
 * @param {object} col a column of `session.data`
 */
export function describeColumnZone(session, col) {
	const { clock, src } = clockAndSource(session, col.id);
	let times;
	if (clock.wall) times = 'as written';
	else if (src && readsWallClockText(src, session)) times = 'wall clock';
	else times = 'instants';
	return { timeZone: clock.named, times, ...(clock.from ? { from: clock.from } : {}) };
}

/** describe_session's words for one time column's zone. */
export function columnZoneText(z) {
	const label = zoneLabel(z.timeZone);
	const how =
		z.times === 'as written'
			? 'as written (no zone, read as UTC)'
			: z.times === 'wall clock'
				? `${label}: written times read in that zone`
				: `${label}: instants`;
	return z.from ? `${how}, from ${z.from}` : how;
}

/**
 * check_draft's warnings when one Join Data or one plot mixes zones, worded exactly as the
 * app's Join Data warning and the actogram / scatterplot notes (utils/time/zoneNotes.js).
 * @param {object} session
 * @returns {string[]}
 */
export function mixedZoneWarnings(session) {
	const out = [];
	const byId = new Map((session.data ?? []).map((c) => [c.id, c]));
	// A time column once computed: Bin Data's binnedx, Cosinor's cosinorx, Join Data's jointime
	// and the like are number columns in a draft (sessionTimeTyper).
	const isTime = sessionTimeTyper(session);
	const clock = (id) => sessionColumnClock(session, id);
	for (const tp of session.tableProcesses ?? []) {
		if (tp?.name !== 'JoinData') continue;
		const a = byId.get(tp.args?.aTimeIN);
		const b = byId.get(tp.args?.bTimeIN);
		if (!a || !b || !isTime(a.id) || !isTime(b.id)) continue;
		const { warning } = joinZoneNotes(clock(a.id), clock(b.id), tp.args?.shiftB);
		if (warning) out.push(`Join Data: ${warning}`);
	}
	for (const p of session.plots ?? []) {
		const note =
			p?.type === 'actogram'
				? actogramMixedZonesNote
				: p?.type === 'scatterplot'
					? (zone) => axisMixedZonesNote(zoneLabel(zone))
					: null;
		if (!note) continue;
		const zones = (p.plot?.data ?? [])
			.map((s) => byId.get(s?.x?.refId))
			.filter((c) => c && isTime(c.id))
			.map((c) => clock(c.id).named);
		if (zones.some((z) => z !== zones[0])) {
			out.push(`Plot "${p.name ?? p.type}": ${note(zones[0])}`);
		}
	}
	return out;
}

/**
 * check_draft's daylight-saving warnings for the session's zoned zone-less time columns, in the
 * app's words (dstCountWarnings.js): times in a skipped hour, and times in a repeated hour that do not
 * step back through it in order. A repeated hour written in order is not warned.
 * @param {object} session
 * @returns {string[]}
 */
export function daylightSavingWarnings(session) {
	const out = [];
	for (const col of session.data ?? []) {
		if (col?.type !== 'time' || col.refId != null || col.producerNodeId != null) continue;
		// The only kind the app resolves a wall clock for: 'utc' stores no zone (as written) and
		// a fixed offset has no daylight saving.
		const zone = normalizeZone(col.timeZone);
		if (!zone || zone === UTC_ZONE || fixedOffsetMinutes(zone) != null) continue;
		if (!readsWallClockText(col, session)) continue;
		const raw = session.rawData?.[col.data] ?? session.rawData?.[col.id];
		if (!Array.isArray(raw) || raw.length === 0) continue;
		const counts = wallClockCounts(raw.map(wallClockMs), zone);
		for (const w of dstCountWarnings({ zone, ...counts })) out.push(`Column "${col.name}": ${w}`);
	}
	return out;
}

/**
 * The counts the app's resolver gives a column of wall clocks in `zone` (zoneResolver.js
 * resolveWallClocks): `{ repeated, secondPass, unordered, skipped }`. An unknown zone counts
 * nothing (the app reads such a column as written and warns about the zone instead).
 * @param {ArrayLike<unknown>} walls wall clocks as ms read as UTC, in row order
 * @param {string} zone
 */
export function wallClockCounts(walls, zone) {
	if (!normalizeZone(zone)) return { repeated: 0, secondPass: 0, unordered: 0, skipped: 0 };
	// eslint-disable-next-line no-unused-vars
	const { instants, ...counts } = resolveWallClocks(walls, zone);
	return counts;
}

// ISO 8601 with no offset, the shapes a draft's time column takes (ISO_RE above).
const WALL_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{3}))?)?)?$/;

/** A zone-less ISO time as its wall clock read as UTC (ms), or NaN (parseTimeStrict, utc). */
export function wallClockMs(value) {
	if (typeof value !== 'string') return NaN;
	const m = WALL_ISO_RE.exec(value.trim());
	if (!m) return NaN;
	const [, y, mo, d, h = '0', mi = '0', s = '0', ms = '0'] = m;
	const t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, +ms);
	// dayjs strict parsing refuses a date that does not exist (2024-02-30).
	const back = new Date(t);
	if (back.getUTCMonth() !== +mo - 1 || back.getUTCDate() !== +d) return NaN;
	return t;
}
