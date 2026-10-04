import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Papa from 'papaparse';

vi.mock('$lib/core/core.svelte', () => ({ appState: { displayTimezone: 'utc' } }));
const notify = vi.fn();
vi.mock('$lib/core/notifications.svelte.js', () => ({ addNotification: (...a) => notify(...a) }));

import {
	detectColumnType,
	resolveImportType,
	typeChoicesFor,
	isNumericColumn,
	epochHint
} from './importColumnTypes.js';
import {
	guessDateofArray,
	getUNIXDate,
	countUnparsedTimes,
	shouldWarnUnparsedTimes,
	timeCellText
} from './time/TimeUtils.js';
import {
	auditTimeColumnParse,
	resetTimeParseAudit,
	TIME_PARSE_WARNING_DELAY_MS
} from './time/timeParseAudit.js';

// The reviewer's mouse_activity.csv (UI-1): DateTime, Activity; 2400 six-minute
// epochs from 01/03/2026 00:00, night activity such as 8.4, 9.2, 0, 2.2.
function mouseActivityCsv() {
	const lines = ['DateTime,Activity'];
	const acts = [8.4, 9.2, 2.3, 0, 0, 2.2, 14.1, 0.5];
	for (let i = 0; i < 2400; i++) {
		const t = new Date(Date.UTC(2026, 2, 1) + i * 6 * 60_000);
		const p = (n) => String(n).padStart(2, '0');
		const s = `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
		lines.push(`${s},${acts[i % acts.length]}`);
	}
	return lines.join('\n');
}

function parseColumns(csv) {
	const r = Papa.parse(csv, { header: true, dynamicTyping: true, skipEmptyLines: 'greedy' });
	const out = {};
	for (const f of r.meta.fields) out[f] = r.data.map((row) => row[f]);
	return out;
}

describe('UI-1: numeric activity is not guessed as time', () => {
	const cols = parseColumns(mouseActivityCsv());

	it('PapaParse hands the importer JS numbers for Activity', () => {
		expect(typeof cols.Activity[0]).toBe('number');
	});

	it('guessDateofArray offers no time format for a column of numbers', () => {
		expect(guessDateofArray(cols.Activity)).toEqual([]);
		expect(guessDateofArray([8.4, 9.2, 0, 2.2])).toEqual([]);
	});

	it('detects Activity as number and DateTime as time, from the full columns', () => {
		expect(detectColumnType(cols.Activity)).toMatchObject({ type: 'number', timeFormat: null });
		const dt = detectColumnType(cols.DateTime);
		expect(dt.type).toBe('time');
		const ms = cols.DateTime.map((v) => getUNIXDate(v, dt.timeFormat));
		expect(ms.every(Number.isFinite)).toBe(true);
	});

	it('the import path imports Activity as numbers with every value intact', () => {
		const r = resolveImportType(cols.Activity, null);
		expect(r.type).toBe('number');
		expect(r.values.slice(0, 4)).toEqual([8.4, 9.2, 2.3, 0]);
	});
});

describe('guessDateofArray builds candidates from values across the column', () => {
	it('a blank first row does not stop detection', () => {
		const fmt = guessDateofArray([null, '', '2020-01-01 09:00:00', '2020-01-01 10:00:00']);
		expect(Number.isFinite(getUNIXDate('2020-01-01 09:00:00', fmt))).toBe(true);
	});

	it('a day of 13 or more far down the column settles day/month order', () => {
		const rows = [];
		for (let d = 1; d <= 20; d++)
			for (let h = 0; h < 24; h++)
				rows.push(`${String(d).padStart(2, '0')}/03/2026 ${String(h).padStart(2, '0')}:00`);
		const fmt = guessDateofArray(rows);
		// Only D/M reads "13/03/2026"; M/D would turn row 300 onwards into missing.
		expect(rows.filter((r) => !Number.isFinite(getUNIXDate(r, fmt)))).toEqual([]);
		expect(new Date(getUNIXDate('02/03/2026 00:00', fmt)).getUTCMonth()).toBe(2);
	});

	it('a format only the later rows suggest is still a candidate', () => {
		// The first row is a lone value the guesser reads differently from the rest.
		const rows = ['9:00'];
		for (let i = 0; i < 50; i++) rows.push(`2020-01-01 ${String(i % 24).padStart(2, '0')}:00:00`);
		const fmt = guessDateofArray(rows);
		expect(Number.isFinite(getUNIXDate('2020-01-01 05:00:00', fmt))).toBe(true);
	});

	it('text where a minority looks like dates is not a time column', () => {
		const rows = ['A', 'B', 'C', 'D', '2020-01-01'];
		expect(guessDateofArray(rows)).toEqual([]);
	});
});

describe('import type choices and overrides', () => {
	it('suggests epoch seconds/ms only as options, never automatically', () => {
		const secs = [1_772_323_200, 1_772_323_560, 1_772_323_920];
		expect(detectColumnType(secs)).toMatchObject({ type: 'number', epoch: 's' });
		expect(epochHint(secs.map((s) => s * 1000))).toBe('ms');
		expect(epochHint([8.4, 9.2])).toBeNull();
		expect(typeChoicesFor(detectColumnType(secs), true).map((c) => c.value)).toEqual([
			'number',
			'epoch-s',
			'epoch-ms',
			'category'
		]);
	});

	it('an epoch-seconds override converts to epoch ms with no text format', () => {
		const r = resolveImportType([1_772_323_200, null], { choice: 'epoch-s' });
		expect(r).toEqual({ type: 'time', timeFormat: [], values: [1_772_323_200_000, null] });
		expect(getUNIXDate(r.values[0], r.timeFormat)).toBe(Date.UTC(2026, 2, 1));
	});

	it('a time override with a typed format uses that format', () => {
		const r = resolveImportType(['01/03/2026 00:00'], {
			choice: 'time',
			timeFormat: 'MM/DD/YYYY HH:mm'
		});
		expect(r.timeFormat).toBe('MM/DD/YYYY HH:mm');
		expect(new Date(getUNIXDate(r.values[0], r.timeFormat)).getUTCMonth()).toBe(0);
	});

	it('number and category overrides win over detection', () => {
		expect(resolveImportType(['2020-01-01', '2020-01-02'], { choice: 'category' }).type).toBe(
			'category'
		);
		expect(isNumericColumn([1, null, 2])).toBe(true);
		expect(isNumericColumn([1, 'x'])).toBe(false);
	});
});

describe('whole-column validation on first parse', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		notify.mockClear();
		resetTimeParseAudit();
	});
	afterEach(() => vi.useRealTimers());

	it('counts non-blank values that came out missing', () => {
		expect(countUnparsedTimes(['a', '', null, 'b', 'c'], [1, null, null, NaN, 3])).toEqual({
			nonBlank: 3,
			failed: 1,
			example: 'b'
		});
		expect(shouldWarnUnparsedTimes({ nonBlank: 2400, failed: 2 })).toBe(false);
		expect(shouldWarnUnparsedTimes({ nonBlank: 2400, failed: 3 })).toBe(true);
	});

	it('warns once, naming the column and the count, for a format that misses rows', () => {
		const raw = ['01/03/2026 00:00', '13/03/2026 00:00', '14/03/2026 00:00'];
		const col = {
			id: 7,
			name: 'DateTime',
			timeFormat: 'MM/DD/YYYY HH:mm',
			data: 7,
			rawDataVersion: 0
		};
		const parsed = raw.map((v) => Number(getUNIXDate(v, col.timeFormat)));
		auditTimeColumnParse(col, raw, parsed);
		vi.advanceTimersByTime(TIME_PARSE_WARNING_DELAY_MS + 1);
		// Later reads of the same parse (getData runs on every render) stay quiet.
		auditTimeColumnParse(col, raw, parsed);
		vi.advanceTimersByTime(TIME_PARSE_WARNING_DELAY_MS + 1);
		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify.mock.calls[0][0]).toContain('2 of 3 values in "DateTime"');
	});

	it('stays quiet when every value parses, and supersedes a pending warning', () => {
		const raw = ['01/03/2026 00:00', '13/03/2026 00:00'];
		const col = { id: 8, name: 'T', timeFormat: 'MM/DD/YYYY HH:mm', data: 8, rawDataVersion: 0 };
		auditTimeColumnParse(
			col,
			raw,
			raw.map((v) => Number(getUNIXDate(v, col.timeFormat)))
		);
		col.timeFormat = 'DD/MM/YYYY HH:mm'; // the user fixes the format before the toast
		auditTimeColumnParse(
			col,
			raw,
			raw.map((v) => Number(getUNIXDate(v, col.timeFormat)))
		);
		vi.advanceTimersByTime(TIME_PARSE_WARNING_DELAY_MS + 1);
		expect(notify).not.toHaveBeenCalled();
	});

	it('a read with the format cleared (epoch ms) also supersedes a pending warning', () => {
		// A Wide To Long time output saved with its source's text format: the first read
		// fails every value, then the node clears the format and the next read is fine.
		const raw = [1704067200000, 1704070800000, 1704074400000];
		const col = {
			id: 9,
			name: 'time_86',
			timeFormat: 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]',
			data: 9,
			rawDataVersion: 0
		};
		auditTimeColumnParse(
			col,
			raw,
			raw.map((v) => Number(getUNIXDate(v, col.timeFormat)))
		);
		col.timeFormat = null;
		auditTimeColumnParse(
			col,
			raw,
			raw.map((v) => Number(getUNIXDate(v, col.timeFormat)))
		);
		vi.advanceTimersByTime(TIME_PARSE_WARNING_DELAY_MS + 1);
		expect(notify).not.toHaveBeenCalled();
	});
});

describe('time cells never render missing as 1 Jan 1970', () => {
	it('renders a missing or unparsed value as a dash', () => {
		expect(timeCellText(8.4, NaN)).toBe('-');
		expect(timeCellText(null, null)).toBe('-');
		expect(timeCellText('garbage', NaN)).toBe('-');
		expect(timeCellText('', null)).toBe('-');
	});

	it('shows parsed text as typed and epoch ms as a date', () => {
		expect(timeCellText('01/03/2026 00:00', 1)).toBe('01/03/2026 00:00');
		expect(timeCellText(Date.UTC(2026, 2, 1), Date.UTC(2026, 2, 1))).toBe('01 Mar 2026 00:00:00');
	});
});
