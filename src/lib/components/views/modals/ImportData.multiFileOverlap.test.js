// Files imported together whose times overlap (a daily export that runs past midnight
// into the next file's day). Found 2026-10-17 with the ESF exports: four daily files,
// each running 1 h 36 min into the next day, so neighbouring files share 10 times, and at
// 3 of the times both files have values that disagree.
//
// v82.21 merged shared times into one row per time. David decided (2026-10-17) that
// "import data simply imports the data (without merging)": every row of every file is
// imported and sorted by time. The preview only says how many times overlap and how many
// disagree, and points to Bin Data for combining them; the imported time column then
// carries a repeated-times warning (columnWarnings.js).
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
	it('no shared time: no overlap reported, no note', async () => {
		const s = await preview([csv('a.csv', lines(0, 20)), csv('b.csv', lines(20, 40))]);
		expect(s.overlap).toBe(null);
		expect(s.overlapNote).toBe(null);
		expect(s.importRowCount).toBe(40);
		const cols = await importAll();
		expect(cols.time).toHaveLength(40);
	});

	it('an exact overlap (same values): counted, none disagree, every row still counted', async () => {
		const s = await preview([csv('a.csv', lines(0, 30)), csv('b.csv', lines(20, 50))]);
		expect(s.overlap).toMatchObject({
			timeColumn: 'time',
			times: 10,
			conflicts: 0,
			pairs: [{ files: ['a.csv', 'b.csv'], times: 10, conflicts: 0 }]
		});
		expect(s.totalRowCount).toBe(60);
		expect(s.importRowCount).toBe(60);
		expect(s.overlapNote).toMatch(/^10 times appear in more than one file, and the files agree/);
		expect(s.overlapNote).toContain('All rows are imported.');
	});

	it('an overlap with disagreeing values: counted per pair of files', async () => {
		const b = lines(20, 50, { value: (i) => (i === 25 || i === 27 ? 999 : 100 + i) });
		const s = await preview([csv('a.csv', lines(0, 30)), csv('b.csv', b)]);
		expect(s.overlap).toMatchObject({ times: 10, conflicts: 2 });
		expect(s.overlap.pairs).toEqual([{ files: ['a.csv', 'b.csv'], times: 10, conflicts: 2 }]);
		expect(s.overlapNote).toMatch(/^10 times appear in more than one file; at 2 of them/);
	});

	it('different time formats that parse to the same instant still overlap', async () => {
		const s = await preview([
			csv('a.csv', lines(0, 30)),
			csv('b.csv', lines(20, 50, { fmt: dmy }))
		]);
		expect(s.overlap).toMatchObject({ times: 10, conflicts: 0 });
	});

	it('offers no merge choice', async () => {
		const s = await preview([csv('a.csv', lines(0, 30)), csv('b.csv', lines(20, 50))]);
		expect(s).not.toHaveProperty('overlapMode');
		expect(_importTestActions()).not.toHaveProperty('setOverlapMode');
	});
});

describe('overlapping times across files: the import keeps every row', () => {
	const conflicting = () => [
		csv('a.csv', lines(0, 30)),
		csv('b.csv', lines(20, 50, { value: (i) => (i === 25 ? 999 : 100 + i) }))
	];

	it('every row of every file, sorted by time; both values of a conflicting time', async () => {
		await preview(conflicting());
		const cols = await importAll();
		expect(cols.time).toHaveLength(60);
		expect(new Set(cols.time).size).toBe(50);
		expect(cols.time).toEqual([...cols.time].sort((x, y) => x - y));
		const at25 = cols.time.flatMap((t, i) => (t === T0 + 25 * STEP ? [cols.activity[i]] : []));
		expect(at25.sort()).toEqual([125, 999]);
	});

	it('the file listed first does not change what is imported', async () => {
		await preview(conflicting());
		const forward = await importAll();
		await preview(conflicting().reverse());
		expect(_importPreviewState().fileNames).toEqual(['b.csv', 'a.csv']);
		const reversed = await importAll();
		expect(reversed.time).toEqual(forward.time);
		expect(reversed.time).toHaveLength(60);
	});

	it("a blank row from one file stays a blank row beside the other file's values", async () => {
		const a = lines(0, 30, { blankFrom: 20 });
		await preview([csv('a.csv', a), csv('b.csv', lines(20, 50))]);
		const cols = await importAll();
		expect(cols.activity).toHaveLength(60);
		expect(cols.activity.filter((v) => v == null)).toHaveLength(10);
	});

	it('binning sees every row: same as one file holding them', async () => {
		const bin = (a) => {
			a.setBinningEnabled(true);
			a.setBinInterval(60);
		};
		await preview([csv('all.csv', [...lines(0, 30), ...lines(20, 50)])]);
		const single = await importAll(bin);
		await preview([csv('a.csv', lines(0, 30)), csv('b.csv', lines(20, 50))]);
		const multi = await importAll(bin);
		expect(multi).toEqual(single);
		expect(multi.activity.length).toBeLessThanOrEqual(10);
	});

	it('the source-file column names the file each row came from', async () => {
		await preview([csv('a.csv', lines(0, 30)), csv('b.csv', lines(20, 50))]);
		const cols = await importAll((x) => x.setAddSourceColumn(true));
		expect(cols['Source file']).toHaveLength(60);
		expect(cols['Source file'].filter((n) => n === 'a.csv')).toHaveLength(30);
		expect(cols['Source file'].filter((n) => n === 'b.csv')).toHaveLength(30);
		// Times only in a.csv (before row 20) or only in b.csv (row 30 on).
		cols.time.forEach((t, i) => {
			if (t < T0 + 20 * STEP) expect(cols['Source file'][i]).toBe('a.csv');
			if (t >= T0 + 30 * STEP) expect(cols['Source file'][i]).toBe('b.csv');
		});
	});

	it('the source-file column survives a column left unticked', async () => {
		await preview([csv('a.csv', lines(0, 30)), csv('b.csv', lines(20, 50))]);
		const cols = await importAll((x) => {
			x.setAddSourceColumn(true);
			x.setColumnSelected('temp', false);
		});
		expect(Object.keys(cols)).toEqual(['time', 'activity', 'Source file']);
		expect(cols['Source file']).toHaveLength(60);
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

	it('reports 30 shared times, 10 per neighbouring pair, 3 that disagree; counts all 580 rows', async () => {
		const s = await preview(files());
		expect(s.overlap).toMatchObject({
			timeColumn: 'datetime_utc',
			times: 30,
			conflicts: 3
		});
		expect(s.overlap.pairs.map((p) => [p.files, p.times, p.conflicts])).toEqual([
			[[esfFiles[0], esfFiles[1]], 10, 1],
			[[esfFiles[1], esfFiles[2]], 10, 1],
			[[esfFiles[2], esfFiles[3]], 10, 1]
		]);
		expect(s.overlapNote).toBe(
			'30 times appear in more than one file; at 3 of them the files have different values. ' +
				'All rows are imported. To combine rows that share a time, bin the data after import (Bin\u00a0Data).'
		);
		expect(s.totalRowCount).toBe(580);
		expect(s.importRowCount).toBe(580);
		expect(s.timeRange).toEqual({
			column: 'datetime_utc',
			first: Date.UTC(2026, 2, 24, 0, 4, 16),
			last: Date.UTC(2026, 2, 28, 1, 40, 16)
		});
	});

	it('imports all 580 rows (550 distinct times), both values where the files disagree', async () => {
		await preview(files());
		const cols = await importAll();
		expect(cols.datetime_utc).toHaveLength(580);
		expect(new Set(cols.datetime_utc).size).toBe(550);
		expect(cols.datetime_utc).toEqual([...cols.datetime_utc].sort((x, y) => x - y));
		const valuesAt = (y, mo, d, h, mi, s) => {
			const t = Date.UTC(y, mo, d, h, mi, s);
			return cols.datetime_utc.flatMap((x, i) => (x === t ? [cols.all_data[i]] : []));
		};
		// 25 Mar 00:04:16: both files have a value and they differ; both are imported.
		const both = valuesAt(2026, 2, 25, 0, 4, 16);
		expect(both).toHaveLength(2);
		expect(both.some((v) => Math.abs(v - 411.6043395996094) < 1e-9)).toBe(true);
		expect(new Set(both).size).toBe(2);
		// 25 Mar 00:14:56: blank in the first file, a value in the second; both rows imported.
		const blankAndValue = valuesAt(2026, 2, 25, 0, 14, 56);
		expect(blankAndValue).toHaveLength(2);
		expect(blankAndValue.filter((v) => v == null)).toHaveLength(1);
		expect(blankAndValue.some((v) => Math.abs(v - 863.502685546875) < 1e-9)).toBe(true);
	});
});
