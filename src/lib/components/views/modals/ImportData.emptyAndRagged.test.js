// ROB-30: an empty file, a header-only file and a file with ragged rows (more or
// fewer fields than the header) all imported with no message. The empty and
// header-only files offered Confirm Import, which closed the dialog having
// imported nothing; ragged rows imported (missing cells empty, extra fields
// dropped) without saying so. Drives the real preview through the test seams.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import ImportData from './ImportData.svelte';
import {
	openImportModalWithFiles,
	_importPreviewState,
	_importTestActions,
	countRaggedRows,
	raggedRowsInResults
} from './ImportData.svelte';
import Papa from 'papaparse';
import { core } from '$lib/core/core.svelte';
import { getColumnById } from '$lib/core/Column.svelte';

const makeFile = (name, content) => new File([content], name, { type: 'text/plain' });

beforeEach(() => {
	core.data = [];
});

describe('empty and header-only files', () => {
	it('an empty file says so and does not offer Confirm Import', async () => {
		await openImportModalWithFiles([makeFile('empty.csv', '')]);
		const s = _importPreviewState();
		expect(s.emptyFileReason).toMatch(/empty/i);
		expect(s.canConfirm).toBe(false);
	});

	it('a header-only file names the problem and does not offer Confirm Import', async () => {
		await openImportModalWithFiles([makeFile('header.csv', 'time,value,other\n')]);
		const s = _importPreviewState();
		expect(s.emptyFileReason).toMatch(/no data rows/i);
		expect(s.emptyFileReason).toMatch(/3 column names/);
		expect(s.canConfirm).toBe(false);
	});

	it('a file of blank lines counts as empty', async () => {
		await openImportModalWithFiles([makeFile('blank.csv', '\n\n  \n')]);
		const s = _importPreviewState();
		expect(s.emptyFileReason).toMatch(/empty/i);
		expect(s.canConfirm).toBe(false);
	});

	it('a normal file after an empty one clears the message', async () => {
		await openImportModalWithFiles([makeFile('empty.csv', '')]);
		await openImportModalWithFiles([makeFile('ok.csv', 'a,b\n1,2\n3,4\n')]);
		const s = _importPreviewState();
		expect(s.emptyFileReason).toBe('');
		expect(s.raggedRows).toBe(0);
		expect(s.canConfirm).toBe(true);
	});
});

describe('ragged rows', () => {
	const RAGGED = 'time,value,other\n1,10,100\n2,20\n3,30,300,3000\n4,40,400\n5\n6,60,600\n';

	it('counts rows whose field count differs from the header and still offers Confirm', async () => {
		await openImportModalWithFiles([makeFile('ragged.csv', RAGGED)]);
		const s = _importPreviewState();
		expect(s.emptyFileReason).toBe('');
		expect(s.raggedRows).toBe(3);
		expect(s.canConfirm).toBe(true);
	});

	it('imports missing cells as missing and ignores extra fields', async () => {
		await openImportModalWithFiles([makeFile('ragged.csv', RAGGED)]);
		await _importTestActions().confirmImport();
		const byName = Object.fromEntries(
			core.data.map((c) => [getColumnById(c.id).name, getColumnById(c.id).getData()])
		);
		expect(Object.keys(byName)).toEqual(['time', 'value', 'other']);
		expect(byName.value).toEqual([10, 20, 30, 40, null, 60]);
		expect(byName.other).toEqual([100, null, 300, 400, null, 600]);
	});

	it('counts over the whole file, not only the previewed rows', async () => {
		const rows = ['a,b'];
		for (let i = 0; i < 200; i++) rows.push(i % 50 === 49 ? `${i}` : `${i},${i * 2}`);
		await openImportModalWithFiles([makeFile('long.csv', rows.join('\n'))]);
		expect(_importPreviewState().raggedRows).toBe(4);
	});
});

describe('countRaggedRows', () => {
	it('compares every row with the first, honouring skip lines and the delimiter', () => {
		expect(countRaggedRows('a;b\n1;2\n3\n4;5;6', { delimiter: ';' })).toBe(2);
		expect(countRaggedRows('junk line\na,b\n1,2', { skipLines: 1 })).toBe(0);
		expect(countRaggedRows('')).toBe(0);
		expect(countRaggedRows('a,b\n\n1,2\n')).toBe(0);
		expect(countRaggedRows('a,b\n"x,y",2\n')).toBe(0);
	});
});

describe('raggedRowsInResults (URL preview)', () => {
	it('counts each mismatched row once, with or without a header row', () => {
		const text = 'a,b,c\n1,2,3\n4,5\n6,7,8,9\n';
		expect(
			raggedRowsInResults(Papa.parse(text, { header: true, skipEmptyLines: 'greedy' }), true)
		).toBe(2);
		expect(
			raggedRowsInResults(Papa.parse(text, { header: false, skipEmptyLines: 'greedy' }), false)
		).toBe(2);
		expect(
			raggedRowsInResults(
				Papa.parse('a,b\n1,2\n', { header: true, skipEmptyLines: 'greedy' }),
				true
			)
		).toBe(0);
	});
});

// v82.9: with several files selected only the FIRST file's ragged rows were counted, so a
// clean first file hid a ragged third one. Each file is now counted and named.
describe('ragged rows across several files', () => {
	// The note is markup, so these mount the dialog itself.
	beforeEach(() => render(ImportData));
	afterEach(() => cleanup());
	async function settled() {
		flushSync();
		await tick();
	}
	const CLEAN = 'time,value\n1,10\n2,20\n3,30\n';
	const TWO_SHORT = 'time,value\n4,40\n5\n6\n7,70\n';
	const ONE_LONG = 'time,value\n8,80,800\n9,90\n';

	it('counts every file and names each one with ragged rows', async () => {
		await openImportModalWithFiles([
			makeFile('file1.csv', CLEAN),
			makeFile('file2.csv', ONE_LONG),
			makeFile('file3.csv', TWO_SHORT)
		]);
		const s = _importPreviewState();
		expect(s.raggedByFile).toEqual([
			{ name: 'file1.csv', count: 0 },
			{ name: 'file2.csv', count: 1 },
			{ name: 'file3.csv', count: 2 }
		]);
		expect(s.canConfirm).toBe(true);
		await settled();
		const note = document.querySelector('[data-testid="import-ragged-note"]');
		expect(note).toBeTruthy();
		const text = note.textContent.replace(/\s+/g, ' ');
		expect(text).toContain('file2.csv: 1 row has a different number of fields than the header.');
		expect(text).toContain('file3.csv: 2 rows have a different number of fields than the header.');
		expect(text).not.toContain('file1.csv');
		expect(document.querySelectorAll('[data-testid="import-ragged-note"]').length).toBe(1);
	});

	it('shows no note when no file has ragged rows', async () => {
		await openImportModalWithFiles([makeFile('a.csv', CLEAN), makeFile('b.csv', CLEAN)]);
		expect(_importPreviewState().raggedByFile.map((r) => r.count)).toEqual([0, 0]);
		await settled();
		expect(document.querySelector('[data-testid="import-ragged-note"]')).toBeNull();
	});

	it('a single file keeps the one-line note', async () => {
		await openImportModalWithFiles([makeFile('file3.csv', TWO_SHORT)]);
		expect(_importPreviewState().raggedByFile).toEqual([]);
		expect(_importPreviewState().raggedRows).toBe(2);
	});
});

// v82.9: a one-column file has no delimiter to detect, and PapaParse says so
// (UndetectableDelimiter). The URL preview treated that as a failed read and hid Confirm
// Import; the file preview did too for a .csv. It is one column, read fine.
describe('single-column file', () => {
	it('previews, offers Confirm Import and imports', async () => {
		await openImportModalWithFiles([makeFile('single.csv', 'activity\n10\n20\n30\n')]);
		const s = _importPreviewState();
		expect(s.headers).toEqual(['activity']);
		expect(s.errorInfile).toBe(false);
		expect(s.canConfirm).toBe(true);
		await _importTestActions().confirmImport();
		expect(_importPreviewState().importError).toBe('');
		const col = core.data.map((c) => getColumnById(c.id)).find((c) => c.name === 'activity');
		expect(col.getData()).toEqual([10, 20, 30]);
	});
});
