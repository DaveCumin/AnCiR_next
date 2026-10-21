// The import dialog and daylight saving (per-column time zone, phase 3; plan 3.3 points 3
// and 6): the hint that a zone-less column follows daylight saving (or does not), the prompt
// when other columns of the session are in a zone, and the import's own sort and binning,
// which must read a zoned column's times as the instants they name.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	openImportModalWithFiles,
	_importPreviewState,
	_importTestActions
} from './ImportData.svelte';
import { core, appState } from '$lib/core/core.svelte';
import { Column, getColumnById } from '$lib/core/Column.svelte';
import { pushObj } from '$lib/core/core.svelte.js';

const NZ = 'Pacific/Auckland';
const MIN = 60000;
const H = 3600000;
const text = (w) => new Date(w).toISOString().slice(0, 16).replace('T', ' ');
const W = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

function csv(times) {
	return ['time,activity', ...times.map((t, i) => `${t},${i % 7}`)].join('\n');
}
const file = (name, content) => new File([content], name, { type: 'text/plain' });
const importedColumn = (name) => {
	const cols = (core.data ?? []).filter((c) => c.name === name);
	return getColumnById(cols[cols.length - 1]?.id);
};

/** A NZ logger that follows daylight saving: every 10 min, 20:00 on 6 Apr to 08:00 on 7 Apr. */
function followsAutumn() {
	const out = [];
	for (let w = W(2024, 4, 6, 20); w < W(2024, 4, 7, 3); w += 10 * MIN) out.push(text(w));
	for (let w = W(2024, 4, 7, 2); w <= W(2024, 4, 7, 8); w += 10 * MIN) out.push(text(w));
	return out;
}
/** A logger on NZST all year across the same change. */
function standardAutumn() {
	const out = [];
	for (let w = W(2024, 4, 6, 20); w <= W(2024, 4, 7, 8); w += 10 * MIN) out.push(text(w));
	return out;
}

const savedTZ = process.env.TZ;
beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
	appState.displayTimezone = 'utc';
	appState.showTimesIn = 'column';
	process.env.TZ = NZ; // the computer's zone, which the hint tries
});
afterEach(() => {
	process.env.TZ = savedTZ;
});

describe('the daylight-saving hint', () => {
	it('a zone-less column whose clock steps back at the NZ change: offered, not applied', async () => {
		await openImportModalWithFiles([file('hive.csv', csv(followsAutumn()))]);
		const s = _importPreviewState();
		expect(s.timeZones.time).toBe('utc');
		expect(s.dstHint).toEqual({
			column: 'time',
			zone: NZ,
			text: 'These times look like they follow daylight saving in Pacific/Auckland: the clock steps back an hour at the change on 7 Apr 2024. Set the zone?',
			button: 'Use Pacific/Auckland'
		});
		_importTestActions().setImportZone('time', s.dstHint.zone);
		expect(_importPreviewState().dstHint).toBeNull();
		expect(_importPreviewState().timeZones.time).toBe(NZ);
	});

	it('a column set to Pacific/Auckland that runs straight through the change: a fixed offset offered', async () => {
		await openImportModalWithFiles([file('std.csv', csv(standardAutumn()))]);
		expect(_importPreviewState().dstHint).toBeNull(); // as written, nothing to say
		_importTestActions().setImportZone('time', NZ);
		const h = _importPreviewState().dstHint;
		expect(h.zone).toBe('+12:00');
		expect(h.text).toBe(
			'These times run straight through the daylight-saving change in Pacific/Auckland on 7 Apr 2024, so the logger may not follow daylight saving. Try a fixed offset?'
		);
		expect(h.button).toBe('Use UTC+12:00');
	});

	it('no hint on a computer in UTC', async () => {
		process.env.TZ = 'UTC';
		await openImportModalWithFiles([file('hive.csv', csv(followsAutumn()))]);
		expect(_importPreviewState().dstHint).toBeNull();
	});
});

describe('the zone prompt (other columns are in a zone)', () => {
	it('asks once, and the button sets the zone', async () => {
		const c = new Column({ type: 'time', timeFormat: 'YYYY-MM-DD HH:mm', timeZone: NZ });
		core.rawData.set(c.id, ['2024-01-01 00:00']);
		c.data = c.id;
		pushObj(c);
		await openImportModalWithFiles([file('more.csv', csv(standardAutumn().slice(0, 10)))]);
		const p = _importPreviewState().zonePrompt;
		expect(p.text).toBe(
			'Other time columns in this session are in Pacific/Auckland. Are the times in "time" in that zone too?'
		);
		_importTestActions().setImportZone('time', p.zone);
		expect(_importPreviewState().zonePrompt).toBeNull();
		await _importTestActions().confirmImport();
		expect(importedColumn('time').timeZone).toBe(NZ);
	});

	it('not asked when the user picked UTC on purpose, or the session has no zoned column', async () => {
		await openImportModalWithFiles([file('more.csv', csv(standardAutumn().slice(0, 10)))]);
		expect(_importPreviewState().zonePrompt).toBeNull();
	});
});

describe("the import's sort and binning read the zone", () => {
	it('sorted by time, a DST logger in NZ keeps its order through the repeated hour', async () => {
		const times = followsAutumn();
		await openImportModalWithFiles([file('hive.csv', csv(times))]);
		_importTestActions().setImportZone('time', NZ);
		await _importTestActions().confirmImport();
		const col = importedColumn('time');
		// The text keeps the file's order (it was already in time order once read in NZ)...
		expect(core.rawData.get(col.data)).toEqual(times);
		// ...so every row is 10 min after the one before.
		const d = Array.from(col.getData());
		for (let i = 1; i < d.length; i++) expect(d[i] - d[i - 1]).toBe(10 * MIN);
	});

	it('as written (utc) the same file sorts the two passes together, as before', async () => {
		const times = followsAutumn();
		await openImportModalWithFiles([file('hive.csv', csv(times))]);
		await _importTestActions().confirmImport();
		expect(core.rawData.get(importedColumn('time').data)).toEqual([...times].sort());
	});

	it('binned hourly in NZ: one bin per real hour, labelled in NZ, read back as those hours', async () => {
		await openImportModalWithFiles([file('hive.csv', csv(followsAutumn()))]);
		_importTestActions().setImportZone('time', NZ);
		_importTestActions().setBinningEnabled(true);
		_importTestActions().setBinInterval(60);
		await _importTestActions().confirmImport();
		const col = importedColumn('time');
		const d = Array.from(col.getData());
		// 20:00 NZDT on 6 Apr to 08:00 NZST on 7 Apr is 13 real hours: 14 hourly bins (the
		// last holds 08:00), an hour apart.
		expect(d.length).toBe(14);
		for (let i = 1; i < d.length; i++) expect(d[i] - d[i - 1]).toBe(H);
		expect(d[0]).toBe(Date.UTC(2024, 3, 6, 7));
		// The labels are NZ wall clock, 02:00 twice.
		expect(core.rawData.get(col.data).filter((t) => t.includes('02:00:00')).length).toBe(2);
	});

	it('binned with offsets in the text (+13:00): the same instants as without binning', async () => {
		const OFFSETS = [
			'time,activity',
			...Array.from(
				{ length: 12 },
				(_, i) => `2024-03-10T${String(8 + i).padStart(2, '0')}:00:00+13:00,${i}`
			)
		].join('\n');
		await openImportModalWithFiles([file('off.csv', OFFSETS)]);
		expect(_importPreviewState().timeZones.time).toBe('+13:00');
		_importTestActions().setBinningEnabled(true);
		_importTestActions().setBinInterval(60);
		await _importTestActions().confirmImport();
		const col = importedColumn('time');
		expect(col.timeZone).toBe('+13:00');
		expect(col.getData()[0]).toBe(Date.UTC(2024, 2, 9, 19));
	});
});
