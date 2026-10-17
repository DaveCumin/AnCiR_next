// Files imported together whose times overlap (a daily export that runs past midnight
// into the next file's day). Found 2026-10-17 with the ESF exports: four daily files,
// each running 1 h 36 min into the next day, so neighbouring files share 10 times. The
// import concatenated them silently, so every shared time appeared twice (one blank row
// from the earlier file, one with values from the later file), and at 3 of the times
// both files had values that disagreed.
//
// The preview now says how many times overlap, between which files and how many
// disagree, and offers: one row per time with the first file's value winning (default),
// with the last file's value winning, or every row kept (the old behaviour). A blank cell
// never wins: a merged row takes each value from whichever file has one.
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

const p2 = (n) => String(n).padStart(2, '0');
const HEADER = 'time,activity,temp';
const STEP = 600_000; // 10 min
const T0 = Date.UTC(2026, 2, 24, 0, 0, 0);

const iso = (ms) => {
	const t = new Date(ms);
	return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}`;
};
const dmy = (ms) => {
	const t = new Date(ms);
	return `${p2(t.getUTCDate())}/${p2(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`;
};

/**
 * Rows i in [from, to): activity = value(i), temp = 20 + i/10; `fmt` writes the time.
 * From row `blankFrom` on, only the time is written (an export's empty tail).
 */
function lines(from, to, { value = (i) => 100 + i, fmt = iso, blankFrom = Infinity } = {}) {
	const out = [];
	for (let i = from; i < to; i++) {
		const t = fmt(T0 + i * STEP);
		out.push(i >= blankFrom ? `${t},,` : `${t},${value(i)},${20 + i / 10}`);
	}
	return out;
}
const csv = (name, rows, header = HEADER) =>
	new File([[header, ...rows].join('\n') + '\n'], name, { type: 'text/plain' });

async function preview(files) {
	core.data = [];
	await openImportModalWithFiles(files);
	const s = _importPreviewState();
	expect(s.canConfirm).toBe(true);
	return s;
}

/** Confirm the import (after `setup`) and return each column's values by name. */
async function importAll(setup = () => {}) {
	await setup(_importTestActions());
	await _importTestActions().confirmImport();
	expect(_importPreviewState().importError).toBe('');
	const out = {};
	for (const c of core.data) {
		const col = getColumnById(c.id);
		out[col.name] = Array.from(col.getData());
	}
	return out;
}

beforeEach(() => {
	core.data = [];
});

describe('overlapping times across files: the preview reports them', () => {
	it('no shared time: no overlap reported, nothing removed', async () => {
		const s = await preview([csv('a.csv', lines(0, 20)), csv('b.csv', lines(20, 40))]);
		expect(s.overlap).toBe(null);
		expect(s.importRowCount).toBe(40);
		const cols = await importAll();
		expect(cols.time).toHaveLength(40);
	});

	it('an exact overlap (same values): counted, none disagree', async () => {
		const s = await preview([csv('a.csv', lines(0, 30)), csv('b.csv', lines(20, 50))]);
		expect(s.overlap).toMatchObject({
			timeColumn: 'time',
			times: 10,
			extraRows: 10,
			conflicts: 0,
			pairs: [{ files: ['a.csv', 'b.csv'], times: 10, conflicts: 0 }]
		});
		expect(s.overlapMode).toBe('first');
		expect(s.totalRowCount).toBe(60);
		expect(s.importRowCount).toBe(50);
	});

	it('an overlap with disagreeing values: counted per pair of files', async () => {
		const b = lines(20, 50, { value: (i) => (i === 25 || i === 27 ? 999 : 100 + i) });
		const s = await preview([csv('a.csv', lines(0, 30)), csv('b.csv', b)]);
		expect(s.overlap).toMatchObject({ times: 10, conflicts: 2 });
		expect(s.overlap.pairs).toEqual([{ files: ['a.csv', 'b.csv'], times: 10, conflicts: 2 }]);
	});

	it('different time formats that parse to the same instant still overlap', async () => {
		const s = await preview([
			csv('a.csv', lines(0, 30)),
			csv('b.csv', lines(20, 50, { fmt: dmy }))
		]);
		expect(s.overlap).toMatchObject({ times: 10, conflicts: 0 });
	});
});

describe('overlapping times across files: the import', () => {
	const conflicting = () => [
		csv('a.csv', lines(0, 30)),
		csv('b.csv', lines(20, 50, { value: (i) => (i === 25 ? 999 : 100 + i) }))
	];

	it('default: one row per time, the first file wins where both have a value', async () => {
		await preview(conflicting());
		const cols = await importAll();
		expect(cols.time).toHaveLength(50);
		expect(new Set(cols.time).size).toBe(50);
		expect(cols.time).toEqual([...cols.time].sort((x, y) => x - y));
		expect(cols.activity[25]).toBe(125);
	});

	it('the last file wins when chosen', async () => {
		await preview(conflicting());
		const cols = await importAll((a) => a.setOverlapMode('last'));
		expect(cols.time).toHaveLength(50);
		expect(cols.activity[25]).toBe(999);
	});

	it('keep every row: the old behaviour, each shared time twice', async () => {
		await preview(conflicting());
		const cols = await importAll((a) => a.setOverlapMode('all'));
		expect(cols.time).toHaveLength(60);
	});

	it('a blank cell is filled from the other file, whichever file wins', async () => {
		const a = lines(0, 30, { value: (i) => (i >= 20 ? '' : 100 + i) });
		await preview([csv('a.csv', a), csv('b.csv', lines(20, 50))]);
		const cols = await importAll();
		expect(cols.activity.slice(20, 30)).toEqual(Array.from({ length: 10 }, (_, k) => 120 + k));
	});

	it('"first" means the file listed first, and the rows are still sorted by time after merging', async () => {
		// b.csv (later times) is listed first.
		await preview(conflicting().reverse());
		const s = _importPreviewState();
		expect(s.fileNames).toEqual(['b.csv', 'a.csv']);
		const cols = await importAll();
		expect(cols.time).toEqual([...cols.time].sort((x, y) => x - y));
		expect(cols.activity[25]).toBe(999);
	});

	it('binning sees the merged rows: same as one file holding them', async () => {
		const bin = (a) => {
			a.setBinningEnabled(true);
			a.setBinInterval(60);
		};
		await preview([csv('merged.csv', lines(0, 50))]);
		const single = await importAll(bin);
		await preview([csv('a.csv', lines(0, 30)), csv('b.csv', lines(20, 50))]);
		const multi = await importAll(bin);
		expect(multi).toEqual(single);
		expect(multi.activity.length).toBeLessThanOrEqual(10);
	});

	it('the source-file column names the file each row came from', async () => {
		await preview([csv('a.csv', lines(0, 30, { blankFrom: 25 })), csv('b.csv', lines(20, 50))]);
		const cols = await importAll((x) => x.setAddSourceColumn(true));
		expect(cols['Source file']).toHaveLength(50);
		// 0..24 from a.csv (20..24 shared, a.csv has values and wins); 25..29 shared, blank in a.csv.
		expect(cols['Source file'].slice(0, 25).every((n) => n === 'a.csv')).toBe(true);
		expect(cols['Source file'].slice(25).every((n) => n === 'b.csv')).toBe(true);
	});

	it('the source-file column survives a column left unticked', async () => {
		await preview([csv('a.csv', lines(0, 30)), csv('b.csv', lines(20, 50))]);
		const cols = await importAll((x) => {
			x.setAddSourceColumn(true);
			x.setColumnSelected('temp', false);
		});
		expect(Object.keys(cols)).toEqual(['time', 'activity', 'Source file']);
		expect(cols['Source file']).toHaveLength(50);
	});

	it('without the checkbox there is no source-file column', async () => {
		await preview([csv('a.csv', lines(0, 30)), csv('b.csv', lines(20, 50))]);
		const cols = await importAll();
		expect(Object.keys(cols)).toEqual(['time', 'activity', 'temp']);
	});
});

describe('the preview summary (UI-18)', () => {
	it('counts the real rows of a file that ends in a newline', async () => {
		const s = await preview([csv('a.csv', lines(0, 4))]);
		expect(s.totalRowCount).toBe(4);
		expect(s.importRowCount).toBe(4);
	});

	it('the first and last time of the whole file, not just the preview rows', async () => {
		const s = await preview([csv('a.csv', lines(0, 200))]);
		expect(s.timeRange).toEqual({ column: 'time', first: T0, last: T0 + 199 * STEP });
	});

	it('the first and last time across every file', async () => {
		const s = await preview([csv('a.csv', lines(0, 30)), csv('b.csv', lines(20, 50))]);
		expect(s.timeRange).toEqual({ column: 'time', first: T0, last: T0 + 49 * STEP });
	});
});

// The real files, when present on this machine (David's Downloads).
const ESF_DIR = '/Users/dcum007/Downloads/ESF_timeseries_combined';
const esfFiles = existsSync(ESF_DIR)
	? readdirSync(ESF_DIR)
			.filter((f) => /^\d{8}_.*_activity\.csv$/.test(f))
			.sort()
	: [];

describe.skipIf(esfFiles.length !== 4)('the ESF daily exports (real files)', () => {
	const files = () =>
		esfFiles.map((f) => new File([readFileSync(join(ESF_DIR, f))], f, { type: 'text/csv' }));

	it('reports 30 shared times, 10 per neighbouring pair, 3 that disagree', async () => {
		const s = await preview(files());
		expect(s.overlap).toMatchObject({
			timeColumn: 'datetime_utc',
			times: 30,
			extraRows: 30,
			conflicts: 3
		});
		expect(s.overlap.pairs.map((p) => [p.files, p.times, p.conflicts])).toEqual([
			[[esfFiles[0], esfFiles[1]], 10, 1],
			[[esfFiles[1], esfFiles[2]], 10, 1],
			[[esfFiles[2], esfFiles[3]], 10, 1]
		]);
		expect(s.totalRowCount).toBe(580);
		expect(s.importRowCount).toBe(550);
		expect(s.timeRange).toEqual({
			column: 'datetime_utc',
			first: Date.UTC(2026, 2, 24, 0, 4, 16),
			last: Date.UTC(2026, 2, 28, 1, 40, 16)
		});
	});

	it('imports 550 rows, one per time; blanks filled from the next file, the first file wins conflicts', async () => {
		await preview(files());
		const cols = await importAll();
		expect(cols.datetime_utc).toHaveLength(550);
		expect(new Set(cols.datetime_utc).size).toBe(550);
		const at = (y, mo, d, h, mi, s) => cols.datetime_utc.indexOf(Date.UTC(y, mo, d, h, mi, s));
		// 25 Mar 00:04:16: both files have values; the first file's wins.
		expect(cols.all_data[at(2026, 2, 25, 0, 4, 16)]).toBeCloseTo(411.6043395996094, 9);
		// 25 Mar 00:14:56: blank in the first file, so the second file's value.
		expect(cols.all_data[at(2026, 2, 25, 0, 14, 56)]).toBeCloseTo(863.502685546875, 9);
	});
});
