// Several files imported together must give exactly what one file holding their rows
// gives. The single-file path is the one every other import test covers; the 2+ file
// path (concatenation) is a separate branch that v82.5 showed can break unseen (every
// multi-file import refused). Each case here imports the same rows both ways with the
// same preview settings and compares every imported column value for value.
//
// Found with this file (2026-10-16): with "Bin data on import" on, only the FIRST file was
// binned; the others were appended raw after it, so the time column mixed bin labels with
// the raw timestamps and every averaged column carried a tail of unbinned samples.
import { describe, it, expect, beforeEach } from 'vitest';
import { makeWorkbook } from '$test/xlsxWorkbook.js';
import {
	openImportModalWithFiles,
	_importPreviewState,
	_importTestActions
} from './ImportData.svelte';
import { core } from '$lib/core/core.svelte';
import { getColumnById } from '$lib/core/Column.svelte';

const p2 = (n) => String(n).padStart(2, '0');
const HEADER = 'timestamp_unix,datetime_utc,all_data,occupancy';

/** Rows of an ESF-like export: blanks in a run and singly, 10 min 40 s steps. */
function rows(day, n) {
	const out = [];
	const start = Date.UTC(2026, 2, day, 0, 4, 16);
	for (let i = 0; i < n; i++) {
		const ms = start + i * 640_000;
		const t = new Date(ms);
		const dt = `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}`;
		const blank = (day === 24 && i < 9) || i % 31 === 7;
		const a = blank ? '' : (500 + 300 * Math.sin(i / 9) + day).toFixed(4);
		const o = blank ? '' : (0.3 + 0.2 * Math.cos(i / 13)).toFixed(6);
		out.push(`${ms / 1000}.0,${dt},${a},${o}`);
	}
	return out;
}

const csvFile = (name, lines) =>
	new File([[HEADER, ...lines].join('\n')], name, { type: 'text/plain' });

function xlsxFile(name, lines, preamble = []) {
	const cell = (v) => (v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : v);
	const aoa = [...preamble, HEADER.split(','), ...lines.map((l) => l.split(',').map(cell))];
	return new File([makeWorkbook(aoa)], name, {
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	});
}

/** Import `files` with `setup` applied to the preview; every column's values by name. */
async function importOf(files, setup = () => {}) {
	core.data = [];
	await openImportModalWithFiles(files);
	expect(_importPreviewState().canConfirm).toBe(true);
	await setup(_importTestActions());
	await _importTestActions().confirmImport();
	expect(_importPreviewState().importError).toBe('');
	const out = {};
	for (const c of core.data) {
		const col = getColumnById(c.id);
		out[col.name] = { type: col.type, values: Array.from(col.getData()) };
	}
	return out;
}

/** The both-sides check: the parts imported together equal them imported as one file. */
async function expectMultiEqualsSingle(parts, setup, make = csvFile) {
	const single = await importOf([make('all.csv', parts.flat())], setup);
	const multi = await importOf(
		parts.map((p, i) => make(`part${i + 1}.csv`, p)),
		setup
	);
	expect(Object.keys(multi).sort()).toEqual(Object.keys(single).sort());
	for (const name of Object.keys(single)) {
		expect(multi[name], `column "${name}"`).toEqual(single[name]);
	}
	return { single, multi };
}

beforeEach(() => {
	core.data = [];
});

const days = () => [rows(24, 145), rows(25, 145), rows(26, 145), rows(27, 145)];

describe('multi-file import equals the same rows in one file', () => {
	it('plain import, four days', async () => {
		const { multi } = await expectMultiEqualsSingle(days(), () => {});
		expect(multi.all_data.values).toHaveLength(580);
	});

	it('with binning on (only the first file used to be binned)', async () => {
		const { multi } = await expectMultiEqualsSingle(days(), (a) => {
			a.setBinningEnabled(true);
			a.setBinInterval(60);
		});
		// About 97 hours at 1 h bins, not file 1's 25 bins plus 435 raw rows.
		expect(multi.all_data.values.length).toBeGreaterThan(90);
		expect(multi.all_data.values.length).toBeLessThan(110);
	});

	it('with a type override (Unix time read as time)', async () => {
		await expectMultiEqualsSingle(days(), (a) =>
			a.setColumnTypeChoice('timestamp_unix', 'epoch-s')
		);
	});

	it('Excel files, with skip lines (extra files ignored the setting)', async () => {
		const preamble = [['Exported by logger'], ['Site', 'ESF']];
		const make = (name, lines) => xlsxFile(name.replace('.csv', '.xlsx'), lines, preamble);
		const { multi } = await expectMultiEqualsSingle(
			days().slice(0, 2),
			async (a) => {
				await a.setSkipLines(2);
			},
			make
		);
		expect(multi.all_data.values).toHaveLength(290);
	});

	it('the binning suggestion counts the rows of every file, not the first', async () => {
		// 16,000 rows at 10 min 40 s: over the 15,000-row suggestion threshold together,
		// under it per file.
		const all = rows(24, 16_000);
		const parts = [all.slice(0, 8000), all.slice(8000)];
		const suggestion = async (files) => {
			await openImportModalWithFiles(files);
			const s = _importPreviewState();
			return {
				totalRowCount: s.totalRowCount,
				binningEnabled: s.binningEnabled,
				binIntervalMin: s.binIntervalMin,
				estimatedBinnedRows: s.estimatedBinnedRows
			};
		};
		const single = await suggestion([csvFile('all.csv', all)]);
		expect(single.binningEnabled).toBe(true);
		const multi = await suggestion(parts.map((p, i) => csvFile(`part${i + 1}.csv`, p)));
		expect(multi).toEqual(single);
	});
});
