// Selecting several files together in Import data concatenates them on the columns
// every file shares. v76.4 (58679bc8, the lint clean-up) deleted the line that
// computed that intersection, so `commonColumns` stayed empty and every multi-file
// selection, even of files with byte-identical headers, was refused with "No
// columns are common across all selected files." Drives the real pipeline (files
// -> preview -> header check -> Confirm Import -> Columns) through the test seams.
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	openImportModalWithFiles,
	_importPreviewState,
	_importTestActions
} from './ImportData.svelte';
import { core } from '$lib/core/core.svelte';
import { getColumnById } from '$lib/core/Column.svelte';

const NO_COMMON = 'No columns are common across all selected files.';

function makeFile(name, content) {
	return new File([content], name, { type: 'text/plain' });
}

const p2 = (n) => String(n).padStart(2, '0');

/**
 * A day of activity export shaped like the ESF time series: unix seconds, a UTC
 * datetime string and numeric band columns, one row every `stepMin` minutes.
 */
function activityCsv({ day, rows, columns = ['all_data', 'band_10_25Hz'], stepMin = 10 }) {
	const lines = [['timestamp_unix', 'datetime_utc', ...columns].join(',')];
	const start = Date.UTC(2026, 2, day, 0, 4, 16);
	for (let i = 0; i < rows; i++) {
		const ms = start + i * stepMin * 60_000;
		const t = new Date(ms);
		const dt = `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}`;
		const values = columns.map((_, c) => (100 * (c + 1) + i + day / 100).toFixed(3));
		lines.push([(ms / 1000).toFixed(1), dt, ...values].join(','));
	}
	return lines.join('\n');
}

function importedColumns() {
	return (core.data ?? []).map((c) => getColumnById(c.id));
}

function importedByName(name) {
	return importedColumns().filter((c) => c.name === name);
}

beforeEach(() => {
	core.data = [];
});

describe('multi-file import, identical headers', () => {
	const files = () => [
		makeFile('day24.csv', activityCsv({ day: 24, rows: 30 })),
		makeFile('day25.csv', activityCsv({ day: 25, rows: 40 })),
		makeFile('day26.csv', activityCsv({ day: 26, rows: 25 }))
	];

	it('finds every column common, reports no error and offers Confirm Import', async () => {
		await openImportModalWithFiles(files());
		const s = _importPreviewState();
		expect(s.fileNames).toEqual(['day24.csv', 'day25.csv', 'day26.csv']);
		expect(s.checkingHeaders).toBe(false);
		expect(s.extraFileErrors).toEqual([]);
		expect(s.commonColumns).toEqual(['timestamp_unix', 'datetime_utc', 'all_data', 'band_10_25Hz']);
		expect(s.mismatchedColumns).toEqual([]);
		expect(s.canConfirm).toBe(true);
	});

	it('imports every row of every file, each column once', async () => {
		await openImportModalWithFiles(files());
		await _importTestActions().confirmImport();
		const s = _importPreviewState();
		expect(s.importError).toBe('');
		expect(s.showImportModal).toBe(false);

		const names = importedColumns().map((c) => c.name);
		expect([...names].sort()).toEqual(
			['all_data', 'band_10_25Hz', 'datetime_utc', 'timestamp_unix'].sort()
		);
		for (const name of names) {
			expect(importedByName(name)).toHaveLength(1);
			expect(importedByName(name)[0].getData()).toHaveLength(30 + 40 + 25);
		}
		// Rows from the last file arrive too, not only the reference file's.
		const allData = Array.from(importedByName('all_data')[0].getData());
		expect(allData).toContain(Number((100 + 24 + 26 / 100).toFixed(3)));
	});
});

describe('multi-file import, partly overlapping headers', () => {
	const files = () => [
		makeFile('a.csv', activityCsv({ day: 24, rows: 20, columns: ['all_data', 'band_a'] })),
		makeFile('b.csv', activityCsv({ day: 25, rows: 15, columns: ['all_data', 'band_b'] }))
	];

	it('keeps the intersection and lists the other columns as missing', async () => {
		await openImportModalWithFiles(files());
		const s = _importPreviewState();
		expect(s.extraFileErrors).toEqual([]);
		expect(s.commonColumns).toEqual(['timestamp_unix', 'datetime_utc', 'all_data']);
		expect(s.mismatchedColumns).toEqual([
			{ column: 'band_a', missingFrom: ['b.csv'] },
			{ column: 'band_b', missingFrom: ['a.csv'] }
		]);
		expect(s.canConfirm).toBe(true);
	});

	it('imports only the common columns, with the rows of both files', async () => {
		await openImportModalWithFiles(files());
		await _importTestActions().confirmImport();
		const names = importedColumns().map((c) => c.name);
		expect([...names].sort()).toEqual(['all_data', 'datetime_utc', 'timestamp_unix']);
		for (const name of names) expect(importedByName(name)[0].getData()).toHaveLength(35);
	});
});

describe('multi-file import, no shared header', () => {
	it('refuses with "No columns are common" and offers no Confirm Import', async () => {
		await openImportModalWithFiles([
			makeFile('x.csv', 'x,y\n1,2\n3,4'),
			makeFile('p.csv', 'p,q\n5,6\n7,8')
		]);
		const s = _importPreviewState();
		expect(s.commonColumns).toEqual([]);
		expect(s.extraFileErrors).toEqual([{ filename: 'all files', error: NO_COMMON }]);
		expect(s.canConfirm).toBe(false);
	});
});

// The files the regression was reported with. Local only: skipped where the folder
// does not exist (CI, other machines).
const REAL_DIR = '/Users/dcum007/Downloads/ESF_timeseries_combined';
const realFiles = existsSync(REAL_DIR)
	? readdirSync(REAL_DIR)
			.filter((f) => f.endsWith('.csv'))
			.sort()
			.slice(0, 2)
	: [];

describe.skipIf(realFiles.length < 2)('multi-file import of the reported ESF files', () => {
	it('imports two days of the real export concatenated', async () => {
		const texts = realFiles.map((f) => readFileSync(join(REAL_DIR, f), 'utf8'));
		const rowsIn = texts.map((t) => t.split(/\r?\n/).filter((l) => l.trim() !== '').length - 1);
		const header = texts[0].split(/\r?\n/)[0].split(',');

		await openImportModalWithFiles(realFiles.map((f, i) => makeFile(f, texts[i])));
		const s = _importPreviewState();
		expect(s.extraFileErrors).toEqual([]);
		expect(s.commonColumns).toEqual(header);
		expect(s.canConfirm).toBe(true);

		await _importTestActions().confirmImport();
		expect(_importPreviewState().importError).toBe('');
		// Each day's file runs 1 h 36 min into the next day: those shared times are merged
		// into one row each by default (ImportData.multiFileOverlap.test.js), so one row per
		// distinct time.
		const times = new Set(
			texts.flatMap((t) =>
				t
					.split(/\r?\n/)
					.slice(1)
					.filter((l) => l.trim() !== '')
					.map((l) => l.split(',')[0])
			)
		);
		expect(times.size).toBe(rowsIn[0] + rowsIn[1] - 10);
		const ts = importedByName('timestamp_unix');
		expect(ts).toHaveLength(1);
		expect(ts[0].getData()).toHaveLength(times.size);
		expect(importedByName('all_data')[0].getData()).toHaveLength(times.size);
	});
});
