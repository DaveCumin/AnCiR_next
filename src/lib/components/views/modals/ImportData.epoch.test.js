// Unix timestamps in a numeric column (D, 2026-10-16). The ESF activity files carry
// `timestamp_unix` (1774310656.0, seconds) beside `datetime_utc`; imported as a plain
// number, a "24 h" Cosinor period on it meant 24 s. The preview now SUGGESTS reading it
// as time (one click in the type row); it never converts on its own. Accepting gives a
// time column identical to the parsed `datetime_utc`, over several files and past the
// 500-point worker gate, and a 24 h Cosinor on either column gives the same fit.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	openImportModalWithFiles,
	_importPreviewState,
	_importTestActions
} from './ImportData.svelte';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { buildTableProcessDefaults } from '$lib/core/tpDefaults.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';

const p2 = (n) => String(n).padStart(2, '0');

/** One day shaped like the ESF export: 10 min 40 s steps, blanks at the start and singly. */
function esfDayCsv(day, rows = 145) {
	const lines = ['timestamp_unix,datetime_utc,all_data,all_data_occupancy'];
	const start = Date.UTC(2026, 2, day, 0, 4, 16);
	for (let i = 0; i < rows; i++) {
		const ms = start + i * 640_000;
		const t = new Date(ms);
		const dt = `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}`;
		const h = (ms - Date.UTC(2026, 2, 24)) / 3_600_000;
		const occ = 0.3 + 0.2 * Math.cos((2 * Math.PI * (h - 15)) / 24) + 0.03 * Math.sin(i);
		const blank = (day === 24 && i < 9) || i % 29 === 4;
		lines.push(
			[`${ms / 1000}.0`, dt, blank ? '' : (800 + 300 * occ).toFixed(3), blank ? '' : occ].join(',')
		);
	}
	return lines.join('\n');
}

const makeFile = (name, text) => new File([text], name, { type: 'text/plain' });
const byName = (name) => core.data.map((c) => getColumnById(c.id)).filter((c) => c.name === name);

async function cosinor24(xId, yId) {
	const entry = appConsts.tableProcessMap.get('Cosinor');
	const args = {
		...buildTableProcessDefaults(entry, {}),
		useFixedPeriod: true,
		fixedPeriod: 24,
		Ncurves: 1,
		xIN: xId,
		yIN: [yId]
	};
	const tp = new TableProcess({ name: 'Cosinor', args }, null);
	await tp.doProcess();
	const read = (k) => Array.from(core.rawData.get(tp.args.out[k]) ?? []);
	return Object.fromEntries(
		['mesor', 'amplitude', 'acrophase', 'rsquared'].map((k) => [k, read(k)])
	);
}

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
});
beforeEach(() => {
	core.data = [];
});

async function importAndCompare(files, { accept }) {
	await openImportModalWithFiles(files);
	const s = _importPreviewState();
	expect(s.columnTypes.timestamp_unix).toMatchObject({ type: 'number', epoch: 's' });
	// Measurements are never offered as time.
	expect(s.columnTypes.all_data.epoch).toBeNull();
	expect(s.columnTypes.all_data_occupancy.epoch).toBeNull();
	if (accept) _importTestActions().setColumnTypeChoice('timestamp_unix', 'epoch-s');
	await _importTestActions().confirmImport();
	expect(_importPreviewState().importError).toBe('');
	const [unix] = byName('timestamp_unix');
	const [utc] = byName('datetime_utc');
	return { unix, utc };
}

describe('Unix time column: suggested, never automatic', () => {
	const files = () => [24, 25, 26, 27].map((d) => makeFile(`day${d}.csv`, esfDayCsv(d)));

	it('without the suggestion accepted, timestamp_unix stays a number', async () => {
		const { unix } = await importAndCompare(files(), { accept: false });
		expect(unix.type).toBe('number');
		expect(unix.getData()[0]).toBe(1774310656);
	});

	it('accepted, four files read as the same instants as datetime_utc', async () => {
		const { unix, utc } = await importAndCompare(files(), { accept: true });
		expect(unix.type).toBe('time');
		expect(unix.getData()).toHaveLength(580);
		expect(unix.getData()).toEqual(utc.getData());
		expect(unix.hoursSinceStart).toEqual(utc.hoursSinceStart);
	});

	it('a 24 h Cosinor on it equals the fit on datetime_utc (544 points, past the worker gate)', async () => {
		const { unix, utc } = await importAndCompare(files(), { accept: true });
		const [y] = byName('all_data_occupancy');
		expect(y.getData().filter((v) => v != null).length).toBeGreaterThanOrEqual(500);
		const a = await cosinor24(unix.id, y.id);
		const b = await cosinor24(utc.id, y.id);
		expect(a.amplitude[0]).toBeCloseTo(0.2, 1);
		expect(a).toEqual(b);
	});
});

// The reported files. Local only: skipped where the folder does not exist.
const REAL_DIR = '/Users/dcum007/Downloads/ESF_timeseries_combined';
const realFiles = existsSync(REAL_DIR)
	? readdirSync(REAL_DIR)
			.filter((f) => f.endsWith('.csv'))
			.sort()
	: [];

describe.skipIf(realFiles.length < 2)('Unix time column, the reported ESF files', () => {
	it('suggests seconds, and accepted equals datetime_utc row for row', async () => {
		const files = realFiles.map((f) => makeFile(f, readFileSync(join(REAL_DIR, f), 'utf8')));
		const { unix, utc } = await importAndCompare(files, { accept: true });
		expect(unix.type).toBe('time');
		expect(unix.getData()).toEqual(utc.getData());
	});
});
