// End-to-end cover for what the import preview does with the CELLS of a file
// (review findings STAT-16, STAT-17 and ROB-23). Every test drives the real
// pipeline: file -> sniff -> PapaParse / xlsxLite -> preview -> Confirm Import ->
// Column, through the exported test seams, with files shaped like the ones users
// actually hand the app.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
	openImportModalWithFiles,
	_importPreviewState,
	_importTestActions
} from './ImportData.svelte';
import { core } from '$lib/core/core.svelte';
import { getColumnById } from '$lib/core/Column.svelte';

function makeFile(name, content) {
	return new File([content], name, { type: 'text/plain' });
}

/** The imported column called `name` from the most recent import. */
function importedColumn(name) {
	const cols = (core.data ?? []).filter((c) => c.name === name);
	return getColumnById(cols[cols.length - 1]?.id);
}

/** A genuine OOXML workbook (one sheet, shared strings), as Excel writes it. */
function makeWorkbook(rows) {
	const strings = [];
	const sIndex = (s) => {
		let i = strings.indexOf(s);
		if (i === -1) i = strings.push(s) - 1;
		return i;
	};
	const col = (i) => String.fromCharCode(65 + i);
	const sheetRows = rows
		.map((row, r) => {
			const cells = row
				.map((v, c) => {
					const ref = `${col(c)}${r + 1}`;
					return typeof v === 'number'
						? `<c r="${ref}"><v>${v}</v></c>`
						: `<c r="${ref}" t="s"><v>${sIndex(v)}</v></c>`;
				})
				.join('');
			return `<row r="${r + 1}">${cells}</row>`;
		})
		.join('');
	const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
	const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
	const files = {
		'[Content_Types].xml': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`
		),
		'_rels/.rels': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
		),
		'xl/workbook.xml': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`
		),
		'xl/_rels/workbook.xml.rels': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`
		),
		'xl/worksheets/sheet1.xml': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><dimension ref="A1:${col(rows[0].length - 1)}${rows.length}"/><sheetData>${sheetRows}</sheetData></worksheet>`
		)
	};
	files['xl/sharedStrings.xml'] = strToU8(
		`<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${ns}" count="${strings.length}" uniqueCount="${strings.length}">${strings
			.map((s) => `<si><t>${s}</t></si>`)
			.join('')}</sst>`
	);
	return zipSync(files);
}

const WORKBOOK_ROWS = [
	['time', 'activity'],
	['2024-03-04 00:00', 12],
	['2024-03-04 00:06', 15.5],
	['2024-03-04 00:12', 9]
];

function workbookFile(name, bytes) {
	return new File([bytes], name, {
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	});
}

beforeEach(() => {
	core.data = [];
});

// ─── STAT-16: decimal commas and non-numeric cells ──────────────────────────
describe('decimal commas (STAT-16)', () => {
	// A semicolon-delimited export from a decimal-comma locale (Excel in NZ set
	// to German, a European actiwatch export, ...).
	const SEMICOLON_DECIMAL_COMMA = [
		'time;activity;light',
		'2024-03-04 00:00;10;1',
		'2024-03-04 00:06;10,5;2',
		'2024-03-04 00:12;8,25;3',
		'2024-03-04 00:18;0;4'
	].join('\n');

	it('suggests the decimal-comma option and reads "10,5" as 10.5 in the preview', async () => {
		await openImportModalWithFiles([makeFile('actiwatch-de.csv', SEMICOLON_DECIMAL_COMMA)]);
		const s = _importPreviewState();
		expect(s.decimalComma).toBe(true);
		expect(s.decimalCommaSuggestedFor).toEqual(['activity']);
		expect(s.parsedData.activity).toEqual([10, 10.5, 8.25, 0]);
		expect(s.columnTypes.activity.type).toBe('number');
		expect(s.columnTypes.activity.nonNumeric.count).toBe(0);
	});

	it('shows a value with a fractional part as the example, when every cell has a comma', async () => {
		// A whole-number "10,00" read as 10 would not show the user what the comma did.
		const csv = ['time;activity', '2024-03-04 00:00;10,00', '2024-03-04 00:06;10,50'].join('\n');
		await openImportModalWithFiles([makeFile('all-commas.csv', csv)]);
		const s = _importPreviewState();
		expect(s.decimalCommaSuggestedFor).toEqual(['activity']);
		expect(s.decimalCommaExample).toBe('10,50');
	});

	it('imports the decimal-comma values as numbers instead of missing', async () => {
		await openImportModalWithFiles([makeFile('actiwatch-de.csv', SEMICOLON_DECIMAL_COMMA)]);
		await _importTestActions().confirmImport();
		const col = importedColumn('activity');
		expect(col.type).toBe('number');
		expect(Array.from(col.getData())).toEqual([10, 10.5, 8.25, 0]);
	});

	it('with the option switched off, names the count of non-numeric cells in the column', async () => {
		await openImportModalWithFiles([makeFile('actiwatch-de.csv', SEMICOLON_DECIMAL_COMMA)]);
		await _importTestActions().setDecimalComma(false);
		const s = _importPreviewState();
		expect(s.decimalComma).toBe(false);
		expect(s.parsedData.activity).toEqual([10, '10,5', '8,25', 0]);
		expect(s.columnTypes.activity.type).toBe('number');
		expect(s.columnTypes.activity.nonNumeric).toEqual({ count: 2, example: '10,5' });
	});

	it('does not suggest decimal commas in a comma-delimited file', async () => {
		const csv = ['time,activity', '2024-03-04 00:00,10', '2024-03-04 00:06,"10,5"'].join('\n');
		await openImportModalWithFiles([makeFile('quoted.csv', csv)]);
		const s = _importPreviewState();
		expect(s.decimalComma).toBe(false);
		expect(s.columnTypes.activity.nonNumeric).toEqual({ count: 1, example: '10,5' });
	});

	it('warns about a stray text cell in a numeric column, preview and import', async () => {
		const csv = [
			'time,activity',
			'2024-03-04 00:00,12',
			'2024-03-04 00:06,n/a',
			'2024-03-04 00:12,9',
			'2024-03-04 00:18,NA'
		].join('\n');
		await openImportModalWithFiles([makeFile('stray.csv', csv)]);
		const s = _importPreviewState();
		expect(s.decimalComma).toBe(false);
		// "NA" is an explicit missing marker; "n/a" is not one the importer knows.
		expect(s.columnTypes.activity.nonNumeric).toEqual({ count: 1, example: 'n/a' });
		await _importTestActions().confirmImport();
		expect(_importPreviewState().lastImportWarnings).toEqual([
			{ column: 'activity', count: 1, example: 'n/a' }
		]);
	});
});

// ─── STAT-16: zone-qualified ISO timestamps ─────────────────────────────────
describe('zone-qualified ISO timestamps (STAT-16)', () => {
	it('reads +hh:mm offsets as time and imports the right instants', async () => {
		// +05:30 on purpose: it is neither UTC nor the zone of the machine running
		// the test, so neither of dayjs's parse zones can hide a wrong offset.
		const csv = [
			'timestamp,value',
			'2026-03-01T08:00:00+05:30,1',
			'2026-03-01T09:00:00+05:30,2',
			'2026-03-01T10:30:00+05:30,3'
		].join('\n');
		await openImportModalWithFiles([makeFile('offsets.csv', csv)]);
		const s = _importPreviewState();
		expect(s.parsedData.timestamp[0]).toBe('2026-03-01T08:00:00+05:30');
		expect(s.columnTypes.timestamp.type).toBe('time');
		await _importTestActions().confirmImport();
		const col = importedColumn('timestamp');
		expect(col.type).toBe('time');
		// 08:00 at +05:30 is 02:30 UTC.
		expect(Array.from(col.getData())).toEqual([
			Date.UTC(2026, 2, 1, 2, 30),
			Date.UTC(2026, 2, 1, 3, 30),
			Date.UTC(2026, 2, 1, 5, 0)
		]);
	});

	it('reads a negative offset and a mix of offsets (a DST change) as the right instants', async () => {
		const csv = [
			'timestamp,value',
			'2026-03-08T00:30:00-05:00,1',
			'2026-03-08T03:30:00-04:00,2'
		].join('\n');
		await openImportModalWithFiles([makeFile('dst.csv', csv)]);
		await _importTestActions().confirmImport();
		expect(Array.from(importedColumn('timestamp').getData())).toEqual([
			Date.UTC(2026, 2, 8, 5, 30),
			Date.UTC(2026, 2, 8, 7, 30)
		]);
	});

	it('reads UTC "Z" timestamps, with and without milliseconds, as time', async () => {
		const csv = [
			'timestamp,value',
			'2026-03-01T08:00:00.000Z,1',
			'2026-03-01T08:06:00.500Z,2',
			'2026-03-01T08:12:00.000Z,3'
		].join('\n');
		await openImportModalWithFiles([makeFile('utc.csv', csv)]);
		expect(_importPreviewState().columnTypes.timestamp.type).toBe('time');
		await _importTestActions().confirmImport();
		expect(Array.from(importedColumn('timestamp').getData())).toEqual([
			Date.UTC(2026, 2, 1, 8, 0),
			Date.UTC(2026, 2, 1, 8, 6, 0, 500),
			Date.UTC(2026, 2, 1, 8, 12)
		]);
	});
});

// ─── STAT-17: ambiguous day/month order ─────────────────────────────────────
describe('ambiguous day/month dates (STAT-17)', () => {
	// Every day value is 12 or less, so the file itself cannot say which is which.
	const AMBIGUOUS = ['date,value', '03/04/2024,1', '03/05/2024,2', '03/06/2024,3'].join('\n');

	// The browser's locale, as Intl reports it, without touching the machine's.
	function withLocale(locale, run) {
		const RealDTF = Intl.DateTimeFormat;
		// A function, not an arrow: the code under test calls it with `new`.
		const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (_loc, opts) {
			return new RealDTF(locale, opts);
		});
		return run().finally(() => spy.mockRestore());
	}

	it('marks the column ambiguous in the preview and defaults the order from the locale', async () => {
		await withLocale('en-US', async () => {
			await openImportModalWithFiles([makeFile('ambiguous.csv', AMBIGUOUS)]);
			const t = _importPreviewState().columnTypes.date;
			expect(t.type).toBe('time');
			expect(t.dayMonth.ambiguous).toBe(true);
			expect(t.dayMonth.order).toBe('month');
			expect(t.timeFormat).toBe('MM/DD/YYYY');
		});
		await withLocale('en-NZ', async () => {
			await openImportModalWithFiles([makeFile('ambiguous.csv', AMBIGUOUS)]);
			const t = _importPreviewState().columnTypes.date;
			expect(t.dayMonth.ambiguous).toBe(true);
			expect(t.dayMonth.order).toBe('day');
			expect(t.timeFormat).toBe('DD/MM/YYYY');
		});
	});

	it('imports month-first when the user chooses month first', async () => {
		await openImportModalWithFiles([makeFile('ambiguous.csv', AMBIGUOUS)]);
		_importTestActions().setDateOrder('date', 'month');
		expect(_importPreviewState().columnTypes.date.timeFormat).toBe('MM/DD/YYYY');
		await _importTestActions().confirmImport();
		expect(Array.from(importedColumn('date').getData())).toEqual([
			Date.UTC(2024, 2, 4),
			Date.UTC(2024, 2, 5),
			Date.UTC(2024, 2, 6)
		]);
	});

	it('imports day-first when the user chooses day first', async () => {
		await openImportModalWithFiles([makeFile('ambiguous.csv', AMBIGUOUS)]);
		_importTestActions().setDateOrder('date', 'day');
		await _importTestActions().confirmImport();
		expect(Array.from(importedColumn('date').getData())).toEqual([
			Date.UTC(2024, 3, 3),
			Date.UTC(2024, 4, 3),
			Date.UTC(2024, 5, 3)
		]);
	});

	// Hourly month-first data from 1 March: the first 288 rows (1 to 12 March)
	// all have a day of 12 or less, so the 50-row preview alone cannot settle it.
	// Row 289 (03/13/2024 00:00) does.
	function hourly(firstDay, days, fmt) {
		const lines = ['datetime,activity'];
		for (let d = 0; d < days; d++) {
			for (let h = 0; h < 24; h++) {
				const day = String(firstDay + d).padStart(2, '0');
				const hh = String(h).padStart(2, '0');
				lines.push(`${fmt(day)} ${hh}:00,${(d * 24 + h) % 17}`);
			}
		}
		return lines.join('\n');
	}

	it('settles month-first from a later row past the preview, without asking', async () => {
		const csv = hourly(1, 14, (day) => `03/${day}/2024`);
		await openImportModalWithFiles([makeFile('us-hourly.csv', csv)]);
		const t = _importPreviewState().columnTypes.datetime;
		expect(t.dayMonth.ambiguous).toBe(false);
		expect(t.dayMonth.order).toBe('month');
		expect(t.dayMonth.settledByRow).toBe(289);
		await _importTestActions().confirmImport();
		const ms = Array.from(importedColumn('datetime').getData());
		expect(ms[0]).toBe(Date.UTC(2024, 2, 1, 0));
		expect(ms[24]).toBe(Date.UTC(2024, 2, 2, 0));
		expect(ms[288]).toBe(Date.UTC(2024, 2, 13, 0));
	});

	it('settles day-first from a later row past the preview, without asking', async () => {
		const csv = hourly(1, 14, (day) => `${day}/03/2024`);
		await openImportModalWithFiles([makeFile('nz-hourly.csv', csv)]);
		const t = _importPreviewState().columnTypes.datetime;
		expect(t.dayMonth.ambiguous).toBe(false);
		expect(t.dayMonth.order).toBe('day');
		await _importTestActions().confirmImport();
		const ms = Array.from(importedColumn('datetime').getData());
		expect(ms[24]).toBe(Date.UTC(2024, 2, 2, 0));
	});
});

// ─── ROB-23: a file that cannot be read must not leave the modal spinning ─────
describe('unreadable files (ROB-23)', () => {
	it('a real workbook still previews and imports (fflate 0.8.3)', async () => {
		await openImportModalWithFiles([workbookFile('activity.xlsx', makeWorkbook(WORKBOOK_ROWS))]);
		const s = _importPreviewState();
		expect(s.importError).toBe('');
		expect(s.headers).toEqual(['time', 'activity']);
		expect(s.importReady).toBe(true);
		await _importTestActions().confirmImport();
		expect(Array.from(importedColumn('activity').getData())).toEqual([12, 15.5, 9]);
	});

	it('a truncated .xlsx stops the spinner and shows an error in the modal', async () => {
		const bytes = makeWorkbook(WORKBOOK_ROWS);
		const truncated = bytes.slice(0, Math.floor(bytes.length / 2));
		await openImportModalWithFiles([workbookFile('half-copied.xlsx', truncated)]);
		const s = _importPreviewState();
		expect(s.awaitingPreview).toBe(false);
		expect(s.importReady).toBe(false);
		expect(s.showImportModal).toBe(true);
		expect(s.importError).toMatch(/half-copied\.xlsx/);
		expect(s.importError).toMatch(/Excel workbook/);
	});

	it('a binary file renamed .csv stops the spinner and shows an error in the modal', async () => {
		// A workbook saved with the wrong extension: zip bytes, NUL bytes and all.
		await openImportModalWithFiles([makeFile('data.csv', makeWorkbook(WORKBOOK_ROWS))]);
		const s = _importPreviewState();
		expect(s.awaitingPreview).toBe(false);
		expect(s.importReady).toBe(false);
		expect(s.importError).toMatch(/data\.csv/);
		expect(s.importError).toMatch(/not a text/);
	});

	it('a new, readable file clears the previous error', async () => {
		await openImportModalWithFiles([makeFile('data.csv', makeWorkbook(WORKBOOK_ROWS))]);
		expect(_importPreviewState().importError).not.toBe('');
		await openImportModalWithFiles([makeFile('ok.csv', 'a,b\n1,2\n3,4\n')]);
		expect(_importPreviewState().importError).toBe('');
		expect(_importPreviewState().importReady).toBe(true);
	});
});
