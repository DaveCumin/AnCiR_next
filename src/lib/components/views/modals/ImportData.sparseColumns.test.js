// The import preview on a hive logger file: number columns blank for their first
// rows (the sensor started late), a 15-minute time column, and more rows than the
// binning threshold. Drives the real pipeline (file -> sniff -> PapaParse ->
// preview -> Confirm Import -> Column) through the exported test seams.
import { describe, it, expect, beforeEach } from 'vitest';
import {
	defaultImportBinning,
	openImportModalWithFiles,
	_importPreviewState,
	_importTestActions
} from './ImportData.svelte';
import { core } from '$lib/core/core.svelte';
import { getColumnById } from '$lib/core/Column.svelte';

function makeFile(name, content) {
	return new File([content], name, { type: 'text/plain' });
}

function importedColumn(name) {
	const cols = (core.data ?? []).filter((c) => c.name === name);
	return getColumnById(cols[cols.length - 1]?.id);
}

const p2 = (n) => String(n).padStart(2, '0');

/**
 * The shape of the reported file: local_time, days_since_start, hive_power_linear,
 * temperature_C; one row every 15 minutes; hive_power_linear blank for the first
 * 82 rows and temperature_C for the first 40.
 */
function hiveCsv({ rows = 15_745, powerBlank = 82, tempBlank = 40, emptyColumn = false } = {}) {
	const lines = [
		'local_time,days_since_start,hive_power_linear,temperature_C' + (emptyColumn ? ',notes' : '')
	];
	const start = Date.UTC(2025, 9, 1, 0, 0);
	for (let i = 0; i < rows; i++) {
		const t = new Date(start + i * 15 * 60_000);
		const time = `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:00`;
		const days = (i * 15) / 1440;
		const power = i < powerBlank ? '' : (0.5 + 0.3 * Math.sin(i / 20)).toFixed(4);
		const temp = i < tempBlank ? '' : (20 + 5 * Math.sin(i / 96)).toFixed(2);
		lines.push(`${time},${days},${power},${temp}` + (emptyColumn ? ',' : ''));
	}
	return lines.join('\n');
}

beforeEach(() => {
	core.data = [];
});

describe('number columns blank for the first preview rows', () => {
	it('detects them as numbers from a larger sample, not Category', async () => {
		await openImportModalWithFiles([makeFile('hive.csv', hiveCsv())]);
		const s = _importPreviewState();
		// The preview rows themselves are blank in both columns.
		expect(s.parsedData.hive_power_linear.every((v) => v == null)).toBe(true);
		expect(s.parsedData.temperature_C.slice(0, 40).every((v) => v == null)).toBe(true);
		expect(s.columnTypes.local_time.type).toBe('time');
		expect(s.columnTypes.days_since_start.type).toBe('number');
		expect(s.columnTypes.hive_power_linear).toMatchObject({ type: 'number', empty: false });
		expect(s.columnTypes.temperature_C).toMatchObject({ type: 'number', empty: false });
		// Read past the preview, and not the whole 15,745-row file.
		expect(s.columnTypes.hive_power_linear.sampledRows).toBeGreaterThan(82);
		expect(s.columnTypes.hive_power_linear.sampledRows).toBeLessThan(1000);
		// Columns with values in the preview are detected from the preview alone.
		expect(s.columnTypes.days_since_start.sampledRows).toBe(null);
	});

	it('imports them as number columns', async () => {
		await openImportModalWithFiles([makeFile('hive.csv', hiveCsv({ rows: 400 }))]);
		await _importTestActions().confirmImport();
		const power = importedColumn('hive_power_linear');
		expect(power.type).toBe('number');
		const data = Array.from(power.getData());
		expect(data.slice(0, 82).every((v) => v == null || Number.isNaN(v))).toBe(true);
		expect(data[82]).toBeCloseTo(0.5 + 0.3 * Math.sin(82 / 20), 4);
	});

	it('says a column with no values in the whole sample is empty, not Category', async () => {
		await openImportModalWithFiles([
			makeFile('hive.csv', hiveCsv({ rows: 400, emptyColumn: true }))
		]);
		const s = _importPreviewState();
		expect(s.columnTypes.notes).toMatchObject({ type: 'number', empty: true, wholeFile: true });
	});

	it('marks a column blank in every preview row of a short file as empty', async () => {
		// The preview holds the whole file, so no sample is read.
		const csv = ['t,a,b', '1,,x', '2,,y', '3,,z'].join('\n');
		await openImportModalWithFiles([makeFile('short.csv', csv)]);
		const s = _importPreviewState();
		expect(s.columnTypes.a).toMatchObject({ type: 'number', empty: true, wholeFile: true });
		expect(s.columnTypes.b.type).toBe('category');
	});
});

describe('binning estimate', () => {
	it('detects the 15-minute interval of the time column', async () => {
		await openImportModalWithFiles([makeFile('hive.csv', hiveCsv())]);
		const s = _importPreviewState();
		expect(s.totalRowCount).toBe(15_745);
		expect(s.dataIntervalMin).toBe(15);
	});

	it('has no interval once the time column is set to another type', async () => {
		// Time column at 30-minute steps; days_since_start would read as 1 min if it were used.
		const lines = ['local_time,days_since_start,v'];
		for (let i = 0; i < 40; i++) {
			const m = i * 30;
			lines.push(`2025-10-01 ${p2(Math.floor(m / 60))}:${p2(m % 60)}:00,${i / 1440},${i}`);
		}
		await openImportModalWithFiles([makeFile('half-hour.csv', lines.join('\n'))]);
		const s = _importPreviewState();
		expect(s.columnTypes.local_time.type).toBe('time');
		expect(s.dataIntervalMin).toBe(30);
		_importTestActions().setColumnTypeChoice('local_time', 'category');
		expect(_importPreviewState().dataIntervalMin).toBe(null);
	});
});

/** `rows` rows sampled every `stepMin` minutes: a time column and one value column. */
function steppedCsv(rows, stepMin) {
	const lines = ['time,v'];
	const start = Date.UTC(2025, 9, 1, 0, 0);
	for (let i = 0; i < rows; i++) {
		const t = new Date(start + i * stepMin * 60_000);
		const time = `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}`;
		lines.push(`${time},${i % 7}`);
	}
	return lines.join('\n');
}

describe('binning default', () => {
	it('is not ticked for the hive file, whose 15-minute rows a 15-minute bin would not reduce', async () => {
		await openImportModalWithFiles([makeFile('hive.csv', hiveCsv())]);
		const s = _importPreviewState();
		expect(s.totalRowCount).toBe(15_745);
		expect(s.dataIntervalMin).toBe(15);
		expect(s.binningEnabled).toBe(false);
		// Ticking it offers a bin that does reduce the rows.
		expect(s.binIntervalMin).toBe(30);
	});

	it('is ticked at 5 minutes for a 1-minute file over the row threshold', async () => {
		await openImportModalWithFiles([makeFile('minute.csv', steppedCsv(20_000, 1))]);
		const s = _importPreviewState();
		expect(s.totalRowCount).toBe(20_000);
		expect(s.dataIntervalMin).toBe(1);
		expect(s.binningEnabled).toBe(true);
		expect(s.binIntervalMin).toBe(5);
		expect(s.estimatedBinnedRows).toBe(4_000);
	});

	it('is not ticked for a 1-minute file under the row threshold', async () => {
		await openImportModalWithFiles([makeFile('minute.csv', steppedCsv(14_000, 1))]);
		expect(_importPreviewState().binningEnabled).toBe(false);
	});

	it('keeps the 15-minute tick when the file has no time column', async () => {
		const lines = ['a,b'];
		for (let i = 0; i < 16_000; i++) lines.push(`${i},${i % 3}`);
		await openImportModalWithFiles([makeFile('no-time.csv', lines.join('\n'))]);
		const s = _importPreviewState();
		expect(s.dataIntervalMin).toBe(null);
		expect(s.binningEnabled).toBe(true);
		expect(s.binIntervalMin).toBe(15);
	});

	it('keeps an untick when the interval re-detects', async () => {
		await openImportModalWithFiles([makeFile('minute.csv', steppedCsv(20_000, 1))]);
		_importTestActions().setBinningEnabled(false);
		// With the time column read as Category the interval is unknown, which on its
		// own would suggest the 15-minute fallback, ticked.
		_importTestActions().setColumnTypeChoice('time', 'category');
		const s = _importPreviewState();
		expect(s.dataIntervalMin).toBe(null);
		expect(s.binningEnabled).toBe(false);
	});

	it('keeps a tick and an edited bin when the interval re-detects', async () => {
		await openImportModalWithFiles([makeFile('hive.csv', hiveCsv())]);
		_importTestActions().setBinningEnabled(true);
		_importTestActions().setBinInterval(60);
		_importTestActions().setColumnTypeChoice('local_time', 'category');
		const s = _importPreviewState();
		expect(s.dataIntervalMin).toBe(null);
		expect(s.binningEnabled).toBe(true);
		expect(s.binIntervalMin).toBe(60);
	});

	it('suggests a whole multiple of the interval at least twice it', () => {
		expect(defaultImportBinning(20_000, 1)).toEqual({ enabled: true, intervalMin: 5 });
		expect(defaultImportBinning(20_000, 0.5)).toEqual({ enabled: true, intervalMin: 5 });
		expect(defaultImportBinning(20_000, 2)).toEqual({ enabled: true, intervalMin: 10 });
		expect(defaultImportBinning(20_000, 5)).toEqual({ enabled: true, intervalMin: 10 });
		expect(defaultImportBinning(20_000, 10)).toEqual({ enabled: true, intervalMin: 30 });
		expect(defaultImportBinning(20_000, 7)).toEqual({ enabled: true, intervalMin: 14 });
		expect(defaultImportBinning(20_000, 15)).toEqual({ enabled: false, intervalMin: 30 });
		expect(defaultImportBinning(20_000, 60)).toEqual({ enabled: false, intervalMin: 120 });
		expect(defaultImportBinning(20_000, null)).toEqual({ enabled: true, intervalMin: 15 });
		expect(defaultImportBinning(15_000, 1)).toEqual({ enabled: false, intervalMin: 5 });
	});
});
