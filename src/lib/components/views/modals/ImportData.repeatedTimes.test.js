// @ts-nocheck
// After a multi-file import of files that overlap, every row is kept (no merging), so the
// imported time column holds times that appear more than once. The column says so
// (columnWarnings.js), and the warning is worked out from the data, so it is there again
// after the session is saved and opened, and a single file with repeated times gets it too.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
	openImportModalWithFiles,
	_importPreviewState,
	_importTestActions
} from './ImportData.svelte';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';
import {
	columnWarnings,
	repeatedTimesWarning,
	longFormatWarning
} from '$lib/core/columnWarnings.js';
import { exportJson, importJson } from '$lib/components/iconActions/Setting.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';

const p2 = (n) => String(n).padStart(2, '0');
const STEP = 600_000;
const T0 = Date.UTC(2026, 2, 24, 0, 0, 0);
const iso = (ms) => {
	const t = new Date(ms);
	return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}`;
};
const lines = (from, to) =>
	Array.from({ length: to - from }, (_, k) => `${iso(T0 + (from + k) * STEP)},${100 + from + k}`);
const csv = (name, rows) =>
	new File([['time,activity', ...rows].join('\n') + '\n'], name, { type: 'text/plain' });

async function importFiles(files) {
	core.data = [];
	await openImportModalWithFiles(files);
	expect(_importPreviewState().canConfirm).toBe(true);
	await _importTestActions().confirmImport();
	expect(_importPreviewState().importError).toBe('');
}
const byName = (name) => core.data.map((c) => getColumnById(c.id)).find((c) => c.name === name);

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
});
beforeEach(() => {
	core.data = [];
	core.groups = [];
});

describe('the imported time column warns about repeated times', () => {
	it('two files sharing 10 times: the time column warns, the other columns do not', async () => {
		await importFiles([csv('a.csv', lines(0, 30)), csv('b.csv', lines(20, 50))]);
		expect(columnWarnings(byName('time'))).toEqual([repeatedTimesWarning(10)]);
		expect(columnWarnings(byName('activity'))).toEqual([]);
	});

	it('files that do not overlap: no warning', async () => {
		await importFiles([csv('a.csv', lines(0, 20)), csv('b.csv', lines(20, 40))]);
		expect(columnWarnings(byName('time'))).toEqual([]);
	});

	it('one file with repeated times warns too', async () => {
		await importFiles([csv('one.csv', [...lines(0, 5), ...lines(3, 6)])]);
		expect(columnWarnings(byName('time'))).toEqual([repeatedTimesWarning(2)]);
	});

	it('binning on import combines the repeats: no warning', async () => {
		core.data = [];
		await openImportModalWithFiles([csv('a.csv', lines(0, 30)), csv('b.csv', lines(20, 50))]);
		_importTestActions().setBinningEnabled(true);
		_importTestActions().setBinInterval(60);
		await _importTestActions().confirmImport();
		const time = core.data.map((c) => getColumnById(c.id)).find((c) => c.type === 'time');
		expect(columnWarnings(time)).toEqual([]);
	});
});

describe('long format and source columns', () => {
	const longCsv = (name, subjects, n) =>
		new File(
			[
				[
					'time,subject,activity',
					...subjects.flatMap((sub, j) =>
						Array.from({ length: n }, (_, k) => `${iso(T0 + k * STEP)},${sub},${10 * j + k}`)
					)
				].join('\n') + '\n'
			],
			name,
			{ type: 'text/plain' }
		);

	it('one long-format file: the time column names the subject column and Long To Wide', async () => {
		await importFiles([longCsv('long.csv', ['m1', 'm2', 'm3'], 12)]);
		expect(byName('subject').type).toBe('category');
		expect(columnWarnings(byName('time'))).toEqual([longFormatWarning('subject', 3)]);
	});

	it('overlapping files with a Source file column: still the advice to bin', async () => {
		core.data = [];
		await openImportModalWithFiles([csv('a.csv', lines(0, 30)), csv('b.csv', lines(20, 50))]);
		_importTestActions().setAddSourceColumn(true);
		await _importTestActions().confirmImport();
		expect(byName('Source file')).toBeTruthy();
		expect(columnWarnings(byName('time'))).toEqual([repeatedTimesWarning(10)]);
	});
});

describe('after save and open', () => {
	let saved;
	const realCreate = URL.createObjectURL;
	const realRevoke = URL.revokeObjectURL;
	beforeEach(() => {
		saved = null;
		URL.createObjectURL = (blob) => {
			saved = blob;
			return 'blob:test-url';
		};
		URL.revokeObjectURL = () => {};
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		URL.createObjectURL = realCreate;
		URL.revokeObjectURL = realRevoke;
	});

	it('the warning is there again, worked out from the loaded data', async () => {
		await importFiles([csv('a.csv', lines(0, 30)), csv('b.csv', lines(20, 50))]);
		exportJson();
		const text = await saved.text();
		core.data = [];
		core.groups = [];
		await importJson(JSON.parse(text));
		expect(byName('time').getData()).toHaveLength(60);
		expect(columnWarnings(byName('time'))).toEqual([repeatedTimesWarning(10)]);
	});

	it('a long-format import warns the same way after save and open', async () => {
		const rows = ['m1', 'm2'].flatMap((sub) =>
			Array.from({ length: 6 }, (_, k) => `${iso(T0 + k * STEP)},${sub},${k}`)
		);
		core.data = [];
		await importFiles([
			new File([['time,subject,activity', ...rows].join('\n') + '\n'], 'l.csv', {
				type: 'text/plain'
			})
		]);
		expect(columnWarnings(byName('time'))).toEqual([longFormatWarning('subject', 2)]);
		exportJson();
		const text = await saved.text();
		core.data = [];
		core.groups = [];
		await importJson(JSON.parse(text));
		expect(columnWarnings(byName('time'))).toEqual([longFormatWarning('subject', 2)]);
	});
});
