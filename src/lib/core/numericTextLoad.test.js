// @ts-nocheck
// Numbers saved as TEXT in a number column are read as numbers when a session loads
// (David, 2026-10-25). A hand-edited or script-written session can hold "12.5" where the app
// writes 12.5; only Correlation coerced (v82.61), so every other analysis met strings: Column
// Function's add joined "10.0" and "0.0" into "10.00.0" and tagged the result a category.
// The conversion is core/numericTextMigration.js, run by importJson before anything is built.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tick } from 'svelte';
import { core, appConsts, outputCoreAsJson } from './core.svelte.js';
import { getColumnById } from './Column.svelte';
import { columnWarnings } from './columnWarnings.js';
import { migrateNumericText, coerceNumericText } from './numericTextMigration.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';

const ROOT = process.cwd();
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const FIXTURE = 'tools/parity/sessions/parity-numeric-text.json';

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
}, 120000);

/** Every shipped session: demos and classroom lessons. */
function shippedSessions() {
	const out = [];
	for (const dir of ['static/sessions/demos', 'static/sessions/classroom']) {
		for (const f of readdirSync(join(ROOT, dir)).sort()) {
			if (f.endsWith('.json') && f !== 'index.json') out.push(`${dir}/${f}`);
		}
	}
	return out;
}

/** Columns that hold their own saved data (not a node's output, not a reference). */
const sourceColumns = (json) =>
	(json.data ?? []).filter(
		(c) => !c.tableProcessGUId && c.producerNodeId == null && c.refId == null
	);

describe('sessions that already store numbers load unchanged (pin)', () => {
	it.each(shippedSessions())('%s: every source column saves back byte for byte', async (p) => {
		const file = read(p);
		await importJson(read(p));
		const saved = JSON.parse(outputCoreAsJson());
		for (const c of sourceColumns(file)) {
			const key = String(c.data ?? c.id);
			expect(JSON.stringify(saved.rawData[key]), `${p} column ${c.id}`).toBe(
				JSON.stringify(file.rawData?.[key])
			);
		}
	});
});

describe('numeric text in a number column', () => {
	it('is a number after the load, and analyses read it as one', async () => {
		await importJson(read(FIXTURE));
		await tick();
		const add = core.tableProcesses.find((t) => t.name === 'ColumnFunctions');
		await add.doProcess();
		const result = core.rawData.get(add.args.out.result);
		const a = core.rawData.get(759);
		const b = core.rawData.get(775);
		expect(a.every((v) => typeof v === 'number')).toBe(true);
		expect(b.every((v) => typeof v === 'number')).toBe(true);
		expect(result).toEqual(a.map((v, i) => v + b[i]));
		expect(getColumnById(add.args.out.result).type).toBe('number');
	});

	it('reads whitespace, exponents, blanks and words as the import does', async () => {
		const file = read(FIXTURE);
		await importJson(read(FIXTURE));
		expect(core.rawData.get(759).slice(0, 3)).toEqual([10, 11.362966948437268, 15.35898]);
		const b = core.rawData.get(760);
		expect(b[0]).toBe(1);
		expect(b[3]).toBeNull(); // ''
		expect(b[7]).toBeNull(); // whitespace only
		expect(b[11]).toBe('abc'); // not a number: kept as written, read as missing
		expect(b[15]).toBe('NA'); // the importer's missing marker: kept, no warning
		expect(b[19]).toBeNull();
		expect(b.length).toBe(file.rawData['760'].length);
	});

	it('warns once on the column when some text could not be read', async () => {
		await importJson(read(FIXTURE));
		const w = columnWarnings(getColumnById(760));
		expect(w).toHaveLength(1);
		expect(w[0]).toContain('1 value is not a number');
		expect(w[0]).toContain('"abc"');
		expect(columnWarnings(getColumnById(759))).toEqual([]);
	});
});

describe('migrateNumericText (the rule)', () => {
	const session = () => ({
		data: [
			{ id: 1, type: 'number', data: 1 },
			{ id: 2, type: 'time', data: 2 },
			{ id: 3, type: 'category', data: 3 },
			{ id: 4, type: 'number', data: 5 },
			{ id: 5, type: 'time', data: 5 },
			{ id: 6, type: 'number', refId: 1, data: null }
		],
		rawData: {
			1: ['1', 2, null, ' ', 'x', true],
			2: ['2026-01-01T00:00:00Z', '5'],
			3: ['1', '2'],
			5: ['7', '8']
		}
	});

	it('reads only number columns, and never an array a time column also reads', () => {
		const json = session();
		const before = JSON.stringify(json);
		const { json: out, columns } = migrateNumericText(json);
		expect(out.rawData[1]).toEqual([1, 2, null, null, 'x', true]);
		expect(out.rawData[2]).toBe(json.rawData[2]);
		expect(out.rawData[3]).toBe(json.rawData[3]);
		expect(out.rawData[5]).toBe(json.rawData[5]);
		expect(columns).toEqual([1]);
		expect(JSON.stringify(json)).toBe(before); // the input is not mutated
	});

	it('returns the same session object when nothing is text', () => {
		const json = { data: [{ id: 1, type: 'number', data: 1 }], rawData: { 1: [1, null, 2.5] } };
		expect(migrateNumericText(json).json).toBe(json);
	});

	it('reads legacy sessions that keep the values on the column record', () => {
		const json = { data: [{ id: 1, type: 'number', data: ['3', ''] }] };
		const out = migrateNumericText(json).json;
		expect(out.data[0].data).toEqual([3, null]);
		expect(json.data[0].data).toEqual(['3', '']);
	});

	it('keeps text past 2^53 as text, as the import does', () => {
		expect(coerceNumericText(['9007199254740993', '-0.5e-3'])).toEqual([
			'9007199254740993',
			-0.0005
		]);
	});
});
