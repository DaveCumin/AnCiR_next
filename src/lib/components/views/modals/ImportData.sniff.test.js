// Integration cover for "import any file": the modal content-sniffs files whose
// extension does not pin a format (utils/fileTypeSniff.js) and routes them to
// the right parser — AWD content named .txt parses as AWD, CSV named .dat as
// CSV, a session .json (any name) loads as a session, and unrecognisable
// content falls back to a CSV attempt that either imports with a warning or
// errors clearly. Runs the REAL preview pipeline (PapaParse + FileReader under
// jsdom) via the exported openImportModalWithFiles seam.
import { describe, it, expect, beforeEach } from 'vitest';
import { openImportModalWithFiles, _importPreviewState } from './ImportData.svelte';
import { registerDataSourceActions } from '$lib/core/dataSourceActions.js';

const AWD_CONTENT = [
	'V800358',
	'10-Nov-1996',
	'16:22',
	'4',
	'23',
	'V800358',
	'M',
	'0 , 0.00',
	'139 , 4.94',
	'300 , 4.94 M',
	'12 , 0.00',
	'0 , 1.20',
	'88 , 3.10',
	'12 , 0.00'
].join('\r\n');

const CSV_CONTENT = 'time,activity,light\n0,12,0.5\n1,15,0.7\n2,9,0.4\n';

const SESSION_CONTENT = JSON.stringify({
	data: [],
	tableProcesses: [],
	plots: [],
	groups: [],
	appState: {},
	version: 'test'
});

function makeFile(name, content) {
	return new File([content], name, { type: 'text/plain' });
}

let sessionLoads;
beforeEach(() => {
	sessionLoads = [];
	registerDataSourceActions({ loadSessionFile: (f) => sessionLoads.push(f) });
});

describe('sniffed import routing (openImportModalWithFiles)', () => {
	it('a well-formed .csv still parses as CSV (no behaviour change)', async () => {
		await openImportModalWithFiles([makeFile('ok.csv', CSV_CONTENT)]);
		const s = _importPreviewState();
		expect(s.targetKind).toBe('csv');
		expect(s.unknownFallback).toBe(false);
		expect(s.errorInfile).toBe(false);
		expect(s.headers).toEqual(['time', 'activity', 'light']);
		expect(s.importReady).toBe(true);
	});

	it('a well-formed .awd still parses as AWD', async () => {
		await openImportModalWithFiles([makeFile('watch.awd', AWD_CONTENT)]);
		const s = _importPreviewState();
		expect(s.targetKind).toBe('awd');
		expect(s.headers).toEqual(['DateTime', 'Activity', 'Light']);
		expect(s.importReady).toBe(true);
	});

	it('AWD content named .txt is sniffed and parsed as AWD', async () => {
		await openImportModalWithFiles([makeFile('watch-export.txt', AWD_CONTENT)]);
		const s = _importPreviewState();
		expect(s.targetKind).toBe('awd');
		expect(s.headers).toEqual(['DateTime', 'Activity', 'Light']);
		expect(s.rowCount).toBeGreaterThan(0);
	});

	it('CSV content named .dat is sniffed and parsed as CSV', async () => {
		await openImportModalWithFiles([makeFile('export.dat', CSV_CONTENT)]);
		const s = _importPreviewState();
		expect(s.targetKind).toBe('csv');
		expect(s.headers).toEqual(['time', 'activity', 'light']);
		expect(s.importReady).toBe(true);
	});

	it('a session .json routes to the session loader and closes the modal', async () => {
		const file = makeFile('mysession.json', SESSION_CONTENT);
		await openImportModalWithFiles([file]);
		expect(sessionLoads).toEqual([file]);
		expect(_importPreviewState().showImportModal).toBe(false);
	});

	it('a session file with a WRONG extension still loads as a session', async () => {
		const file = makeFile('mysession.txt', SESSION_CONTENT);
		await openImportModalWithFiles([file]);
		expect(sessionLoads).toEqual([file]);
	});

	it('data-shaped JSON is refused with an error, not mangled as CSV', async () => {
		await openImportModalWithFiles([
			makeFile(
				'rows.json',
				JSON.stringify([
					{ t: 0, v: 1 },
					{ t: 1, v: 2 }
				])
			)
		]);
		const s = _importPreviewState();
		expect(sessionLoads).toEqual([]);
		expect(s.errorInfile).toBe(true);
		expect(s.importReady).toBe(false);
	});

	it('unrecognisable prose errors instead of importing garbage', async () => {
		await openImportModalWithFiles([
			makeFile('diary.log', 'Dear diary\ntoday I measured nothing at all\nthe end\n')
		]);
		const s = _importPreviewState();
		expect(s.unknownFallback).toBe(true);
		expect(s.errorInfile).toBe(true);
		expect(s.importReady).toBe(false);
	});

	it('unknown extension with plausible content imports via the CSV fallback', async () => {
		// .xyz is unknown and a single column defeats the delimiter sniff (it
		// needs >= 2 columns), so the kind is 'unknown' and the CSV FALLBACK
		// path must do the work; a mostly-numeric single column counts as
		// plausible and imports (with the visible warning).
		const singleCol = 'activity\n12\n15\n9\n7\n';
		await openImportModalWithFiles([makeFile('mystery.xyz', singleCol)]);
		const s = _importPreviewState();
		expect(s.unknownFallback).toBe(true);
		expect(s.errorInfile).toBe(false);
		expect(s.headers).toEqual(['activity']);
		expect(s.rowCount).toBe(4);
		expect(s.importReady).toBe(true);
	});
});
