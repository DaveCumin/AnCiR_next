import { describe, it, expect } from 'vitest';
import dayjs from '$lib/utils/time/dayjsSetup.js';
import { formatTimeFromUNIX, guessDateofArray, getUNIXDate } from '$lib/utils/time/TimeUtils.js';
import {
	limitPreviewRows,
	splitAwdMarker,
	binTimeLabel,
	awdStartInstant,
	awdColumnNames
} from './ImportData.svelte';

// Regression cover for AWD (Actiwatch / MotionWatch) import.
//
// Bug 1 — "no data found": the AWD branch of parseFile() sets `previewIN = 0`
// so PapaParse reads the whole file (0 = unlimited), then reused that same
// value as a slice LENGTH to cap the preview. `slice(0, 0)` emptied the parsed
// rows, dealWithData() saw an empty array and cleared headers/parsedData, so a
// perfectly good file reported no data.
//
// Bug 2 — lost light readings: AWD marks participant event-button presses with
// a trailing "M" on the row ("300 , 4.94 M"). Left in place the field stays a
// string, so the reading is dropped from an otherwise numeric column.

describe('limitPreviewRows', () => {
	const rows = Array.from({ length: 120 }, (_, i) => [i]);

	it('treats a cap of 0 as "no cap", not "no rows"', () => {
		// The reported bug: PapaParse's preview:0 sentinel leaked in as a length.
		expect(limitPreviewRows(rows, 0)).toHaveLength(120);
	});

	it('caps to the requested number of rows', () => {
		expect(limitPreviewRows(rows, 50)).toHaveLength(50);
	});

	it('leaves shorter input untouched', () => {
		expect(limitPreviewRows(rows.slice(0, 10), 50)).toHaveLength(10);
	});

	it('ignores negative / non-finite caps rather than emptying the preview', () => {
		expect(limitPreviewRows(rows, -1)).toHaveLength(120);
		expect(limitPreviewRows(rows, NaN)).toHaveLength(120);
		expect(limitPreviewRows(rows, undefined)).toHaveLength(120);
	});

	it('passes non-array input straight through', () => {
		expect(limitPreviewRows(null, 10)).toBe(null);
	});
});

describe('splitAwdMarker', () => {
	it('recovers the numeric reading from a marked field', () => {
		expect(splitAwdMarker(' 4.94 M')).toEqual({ value: 4.94, marked: true });
		expect(splitAwdMarker('0.00 M')).toEqual({ value: 0, marked: true });
		expect(splitAwdMarker('53.58 M')).toEqual({ value: 53.58, marked: true });
	});

	it('passes through values PapaParse already typed as numbers', () => {
		expect(splitAwdMarker(8.74)).toEqual({ value: 8.74, marked: false });
		expect(splitAwdMarker(0)).toEqual({ value: 0, marked: false });
	});

	it('parses a plain numeric string', () => {
		expect(splitAwdMarker(' 12.5 ')).toEqual({ value: 12.5, marked: false });
	});

	it('leaves genuinely non-numeric text alone', () => {
		expect(splitAwdMarker('not a number')).toEqual({ value: 'not a number', marked: false });
	});

	it('handles null/undefined without throwing', () => {
		expect(splitAwdMarker(null)).toEqual({ value: null, marked: false });
		expect(splitAwdMarker(undefined)).toEqual({ value: undefined, marked: false });
	});
});

// Bug 3 — binning threw "firstDt.plus is not a function". The bin time labels
// were rebuilt with Luxon's API (.plus/.toFormat) while every producer of
// `firstDt` hands back a dayjs object. This broke binning for ANY file with a
// time column; AWD only surfaced it once the preview stopped coming back empty.
describe('binTimeLabel', () => {
	it('offsets a dayjs instance by whole and fractional hours', () => {
		const first = dayjs('2026-07-13 12:00:00');
		expect(binTimeLabel(first, 0)).toBe('13 Jul 2026 12:00:00');
		expect(binTimeLabel(first, 1)).toBe('13 Jul 2026 13:00:00');
		expect(binTimeLabel(first, 0.25)).toBe('13 Jul 2026 12:15:00');
	});

	it('rolls over midnight correctly', () => {
		expect(binTimeLabel(dayjs('2026-07-13 23:30:00'), 1)).toBe('14 Jul 2026 00:30:00');
	});

	it('works on a UTC dayjs instance (the CSV path)', () => {
		expect(binTimeLabel(dayjs.utc('2026-07-13 12:00:00'), 2)).toBe('13 Jul 2026 14:00:00');
	});

	// The label is re-read by the import pipeline, so it must survive a
	// guess-then-parse round trip and come back as the same instant.
	it('round-trips through the format guesser', () => {
		const labels = Array.from({ length: 24 }, (_, h) =>
			binTimeLabel(dayjs.utc('2026-07-13 00:00:00'), h)
		);
		const fmt = guessDateofArray(labels);
		expect(fmt).toBe('DD MMM YYYY HH:mm:ss');
		const ms = Number(getUNIXDate(binTimeLabel(dayjs.utc('2026-07-13 00:00:00'), 12), fmt));
		expect(new Date(ms).toISOString()).toBe('2026-07-13T12:00:00.000Z');
		// …and renders as the same string the tables show.
		expect(formatTimeFromUNIX(ms)).toBe('13 Jul 2026 12:00:00');
	});
});

// Bug 5 — an AWD header time of "12:00" is 24-hour wall clock (midday). The
// start instant used to be built with a LOCAL dayjs, so on any machine east of
// UTC a midday start was stored as the previous midnight in UTC — the app's
// default display zone — and the column read 00:00.
describe('awdStartInstant', () => {
	it('reads 12:00 as midday, not midnight', () => {
		const dt = awdStartInstant('13-Jul-2026', '12:00');
		expect(dt.utc().hour()).toBe(12);
		expect(dt.toISOString()).toBe('2026-07-13T12:00:00.000Z');
	});

	it('renders as midday through the app display formatter', () => {
		// The user-visible check: default display zone is UTC.
		expect(formatTimeFromUNIX(awdStartInstant('13-Jul-2026', '12:00').valueOf())).toBe(
			'13 Jul 2026 12:00:00'
		);
	});

	it('keeps the full 24-hour range distinct', () => {
		expect(awdStartInstant('13-Jul-2026', '00:00').utc().hour()).toBe(0);
		expect(awdStartInstant('13-Jul-2026', '13:30').utc().hour()).toBe(13);
		expect(awdStartInstant('13-Jul-2026', '23:59').utc().hour()).toBe(23);
		// 00:00 and 12:00 must not collide — the whole point of 24-hour reading.
		expect(awdStartInstant('13-Jul-2026', '00:00').valueOf()).not.toBe(
			awdStartInstant('13-Jul-2026', '12:00').valueOf()
		);
	});

	it('accepts a 2-digit year', () => {
		expect(awdStartInstant('13-Jul-26', '12:00').toISOString()).toBe('2026-07-13T12:00:00.000Z');
	});

	it('falls back to midnight when the time line is unusable', () => {
		expect(awdStartInstant('13-Jul-2026', 'garbage').toISOString()).toBe(
			'2026-07-13T00:00:00.000Z'
		);
		expect(awdStartInstant('13-Jul-2026', '25:00').toISOString()).toBe('2026-07-13T00:00:00.000Z');
	});

	it('returns null when the date line is unusable', () => {
		expect(awdStartInstant('not-a-date', '12:00')).toBe(null);
		expect(awdStartInstant('', '12:00')).toBe(null);
	});
});

// The second AWD channel is the light (lux) sensor. It used to be called
// "Marker", which named it after the trailing "M" event flag that appears on
// individual rows (see splitAwdMarker) rather than after its own contents.
describe('awdColumnNames', () => {
	it('names the second data channel Light, not Marker', () => {
		expect(awdColumnNames(2)).toEqual(['DateTime', 'Activity', 'Light']);
	});

	it('handles an activity-only file', () => {
		expect(awdColumnNames(1)).toEqual(['DateTime', 'Activity']);
	});

	it('falls back to Extra… for any further channels', () => {
		expect(awdColumnNames(4)).toEqual(['DateTime', 'Activity', 'Light', 'Extra2', 'Extra3']);
	});

	it('tolerates a missing / nonsense column count', () => {
		expect(awdColumnNames(0)).toEqual(['DateTime', 'Activity']);
		expect(awdColumnNames(undefined)).toEqual(['DateTime', 'Activity']);
	});
});
