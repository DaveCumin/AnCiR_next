// The import preview's time zone row (per-column time zone, STAT-18, phase 1).
//
// A time column with no offsets in its text imports "As written" ('utc', stored as no zone);
// offsets in the text propose the zone they show, and say so; a picked zone is stored on the
// column. Phase 1 changes no parsed time: the ms are identical whichever zone is chosen.
import { describe, it, expect, beforeEach } from 'vitest';
import {
	openImportModalWithFiles,
	_importPreviewState,
	_importTestActions
} from './ImportData.svelte';
import { core, appState } from '$lib/core/core.svelte';
import { getColumnById } from '$lib/core/Column.svelte';

function makeFile(name, content) {
	return new File([content], name, { type: 'text/plain' });
}

function importedColumn(name) {
	const cols = (core.data ?? []).filter((c) => c.name === name);
	return getColumnById(cols[cols.length - 1]?.id);
}

// Wall clock as written by an Auckland logger, no offsets: 7 April 2024 crosses the end of NZDT.
const LOCAL_NZ = [
	'time,activity',
	'2024-04-06 23:00,10',
	'2024-04-07 00:00,12',
	'2024-04-07 01:00,9',
	'2024-04-07 02:00,7'
].join('\n');

// The same kind of file with explicit +13:00 offsets.
const OFFSET_NZ = [
	'time,activity',
	'2024-03-10T08:00:00+13:00,10',
	'2024-03-10T09:00:00+13:00,12',
	'2024-03-10T10:00:00+13:00,9'
].join('\n');

// Offsets that change at the end of NZDT, as an export in local time with offsets writes them.
const CHANGING = [
	'time,activity',
	'2024-04-07T01:30:00+13:00,1',
	'2024-04-07T02:30:00+13:00,2',
	'2024-04-07T02:30:00+12:00,3',
	'2024-04-07T03:30:00+12:00,4'
].join('\n');

beforeEach(() => {
	core.data = [];
	appState.displayTimezone = 'utc';
	appState.showTimesIn = 'column';
});

describe('a zone-less time column', () => {
	it('defaults to "As written" (utc), proposes nothing, and saves no zone', async () => {
		await openImportModalWithFiles([makeFile('nz-local.csv', LOCAL_NZ)]);
		const s = _importPreviewState();
		expect(s.timeZones).toEqual({ time: 'utc' });
		expect(s.zoneSuggestions.time).toBeUndefined();
		expect(s.summaryZone).toBe('as written');
		expect(s.summaryFirst).toBe('06 Apr 2024 23:00:00');

		await _importTestActions().confirmImport();
		const col = importedColumn('time');
		expect(col.timeZone).toBeNull();
		expect(col.timeFrame).toEqual({ zone: 'utc', wall: true });
		expect(col.toJSON().timeZone).toBeUndefined();
	});

	it('a picked zone is stored on the column, and the parsed times do not move', async () => {
		await openImportModalWithFiles([makeFile('nz-local.csv', LOCAL_NZ)]);
		await _importTestActions().confirmImport();
		const asWritten = Array.from(importedColumn('time').getData());

		core.data = [];
		await openImportModalWithFiles([makeFile('nz-local.csv', LOCAL_NZ)]);
		_importTestActions().setImportZone('time', 'Pacific/Auckland');
		const s = _importPreviewState();
		expect(s.timeZones.time).toBe('Pacific/Auckland');
		expect(s.summaryZone).toBe('as written, Pacific/Auckland');
		await _importTestActions().confirmImport();
		const col = importedColumn('time');
		expect(col.timeZone).toBe('Pacific/Auckland');
		expect(col.timeFrame).toEqual({ zone: 'Pacific/Auckland', wall: true });
		expect(Array.from(col.getData())).toEqual(asWritten);
		expect(col.toJSON().timeZone).toBe('Pacific/Auckland');
	});

	it('a fixed offset can be picked', async () => {
		await openImportModalWithFiles([makeFile('nz-local.csv', LOCAL_NZ)]);
		_importTestActions().setImportZone('time', '+12:00');
		await _importTestActions().confirmImport();
		expect(importedColumn('time').timeZone).toBe('+12:00');
	});
});

describe('offsets in the text', () => {
	it('+13:00 throughout proposes and sets the fixed offset +13:00', async () => {
		await openImportModalWithFiles([makeFile('nz-offsets.csv', OFFSET_NZ)]);
		const s = _importPreviewState();
		expect(s.zoneSuggestions.time.zone).toBe('+13:00');
		expect(s.zoneSuggestions.time.offsets).toEqual(['+13:00']);
		expect(s.timeZones.time).toBe('+13:00');
		// The summary shows the times in that zone, i.e. as the file wrote them.
		expect(s.summaryFirst).toBe('10 Mar 2024 08:00:00');
		expect(s.summaryZone).toBe('UTC+13:00');

		await _importTestActions().confirmImport();
		const col = importedColumn('time');
		expect(col.timeZone).toBe('+13:00');
		expect(col.timeFrame).toEqual({ zone: '+13:00', wall: false });
		// The instants come from the offsets, exactly as before per-column zones.
		expect(col.getData()[0]).toBe(Date.UTC(2024, 2, 9, 19, 0));
	});

	it('the user can still override the proposal', async () => {
		await openImportModalWithFiles([makeFile('nz-offsets.csv', OFFSET_NZ)]);
		_importTestActions().setImportZone('time', 'utc');
		expect(_importPreviewState().timeZones.time).toBe('utc');
		await _importTestActions().confirmImport();
		expect(importedColumn('time').timeZone).toBeNull();
	});

	it('offsets that change at daylight saving propose a zone that follows it', async () => {
		await openImportModalWithFiles([makeFile('nz-changing.csv', CHANGING)]);
		const sug = _importPreviewState().zoneSuggestions.time;
		expect(sug.offsets).toEqual(['+13:00', '+12:00']);
		expect(sug.note).toMatch(/daylight saving/);
		expect(sug.zone).toBe('Pacific/Auckland');
	});
});
