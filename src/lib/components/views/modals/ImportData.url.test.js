// ROB-27: the From URL import (and the Examples tab's one-click dataset import, which runs the
// same code) had no test on its happy path. It is a separate pipeline from the file import:
// PapaParse downloads the URL (`download: true`), the preview sets `importReady` itself, and
// Confirm Import goes through loadDataFromURL / loadUrlResults rather than loadData. The
// v82.5 multi-file bug was this kind of gap (a whole path nobody exercised). The URL is a real
// local HTTP server, so the download, the preview and the import all run as they do in the app.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import {
	openImportModalWithUrl,
	importDatasetUrl,
	_importPreviewState,
	_importTestActions
} from './ImportData.svelte';
import { core } from '$lib/core/core.svelte';
import { getColumnById } from '$lib/core/Column.svelte';

const FILES = {
	'/day.csv': 'time,value\n2024-01-01 00:00,10\n2024-01-01 01:00,20\n2024-01-01 02:00,30\n',
	// ROB-30: a ragged row used to block the URL import with no message (the preview treated
	// PapaParse's field-count warning as a fatal error).
	'/ragged.csv': 'a,b,c\n1,2,3\n4,5\n6,7,8\n',
	// One column: there is no delimiter in the text, so PapaParse adds an UndetectableDelimiter
	// warning. That is not a failed read; the file is one column.
	'/single.csv': 'activity\n10\n20\n30\n'
};

let server;
let base;
beforeAll(async () => {
	server = http.createServer((req, res) => {
		res.setHeader('Access-Control-Allow-Origin', '*');
		const body = FILES[req.url];
		if (body == null) {
			res.statusCode = 404;
			res.end();
			return;
		}
		res.setHeader('Content-Type', 'text/csv');
		res.end(body);
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
	core.data = [];
});

const byName = () =>
	Object.fromEntries(
		core.data.map((c) => {
			const col = getColumnById(c.id);
			return [col.name, { type: col.type, values: [...col.getData()] }];
		})
	);

describe('From URL import', () => {
	it('previews the downloaded rows and offers Confirm Import', async () => {
		await openImportModalWithUrl(`${base}/day.csv`);
		const s = _importPreviewState();
		expect(s.headers).toEqual(['time', 'value']);
		expect(s.rowCount).toBe(3);
		expect(s.errorInfile).toBe(false);
		expect(s.canConfirm).toBe(true);
	});

	it('imports every row, with the time column read as time', async () => {
		await openImportModalWithUrl(`${base}/day.csv`);
		await _importTestActions().confirmImport();
		const s = _importPreviewState();
		expect(s.importError).toBe('');
		expect(s.showImportModal).toBe(false);
		const cols = byName();
		expect(Object.keys(cols)).toEqual(['time', 'value']);
		expect(cols.time.type).toBe('time');
		expect(cols.value.values).toEqual([10, 20, 30]);
		expect(cols.time.values[1] - cols.time.values[0]).toBe(3600000);
	});

	it('a ragged file previews with the count and imports (missing cells empty)', async () => {
		await openImportModalWithUrl(`${base}/ragged.csv`);
		const s = _importPreviewState();
		expect(s.raggedRows).toBe(1);
		expect(s.canConfirm).toBe(true);
		await _importTestActions().confirmImport();
		expect(byName().c.values).toEqual([3, null, 8]);
	});

	it('a single-column file previews, offers Confirm Import and imports', async () => {
		await openImportModalWithUrl(`${base}/single.csv`);
		const s = _importPreviewState();
		expect(s.headers).toEqual(['activity']);
		expect(s.errorInfile).toBe(false);
		expect(s.canConfirm).toBe(true);
		await _importTestActions().confirmImport();
		expect(_importPreviewState().importError).toBe('');
		expect(byName().activity.values).toEqual([10, 20, 30]);
	});

	it('the one-click dataset import (Examples tab) imports without the dialog', async () => {
		await importDatasetUrl(`${base}/day.csv`);
		expect(_importPreviewState().showImportModal).toBe(false);
		expect(byName().value.values).toEqual([10, 20, 30]);
	});
});
