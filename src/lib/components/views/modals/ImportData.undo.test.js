// ROB-27: undo across an import. An import is NOT an undo step: it is a new baseline (vault
// note "Undo-Redo System", "What is NOT tracked"), pushed straight into core rather than
// through the op stream. So edits made after an import undo back to the imported data and no
// further, edits made before it still undo underneath it, and none of that disturbs the
// imported columns. Drives the real import pipeline (file -> preview -> Confirm Import)
// through the test seams, and edits through mutationService, as the Table plot does.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { openImportModalWithFiles, _importTestActions } from './ImportData.svelte';
import { core, appConsts } from '$lib/core/core.svelte';
import { Column, getColumnById } from '$lib/core/Column.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { mutationService as M } from '$lib/core/mutationService.js';
import { loadProcesses } from '$test/processRegistry.js';

const CSV = 'time,value\n0,10\n1,20\n2,30\n3,40\n';

async function importCsv(name = 'day.csv') {
	await openImportModalWithFiles([new File([CSV], name, { type: 'text/plain' })]);
	await _importTestActions().confirmImport();
	return core.data.filter((c) => c.name === 'value').at(-1);
}

const valuesOf = (col) => [...getColumnById(col.id).getData()];

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	history.init();
});

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
	history.clear();
});

describe('undo across an import', () => {
	it('the import itself is not an undo step', async () => {
		const value = await importCsv();
		expect(valuesOf(value)).toEqual([10, 20, 30, 40]);
		expect(history.undoCount).toBe(0);
		expect(history.canUndo).toBe(false);
	});

	it('an edit after the import undoes back to the imported data, and redoes', async () => {
		const value = await importCsv();
		M.addProcess(value.id, 'EditValue', { edits: [{ id: 'e1', position: 2, value: 99 }] });
		expect(valuesOf(value)).toEqual([10, 99, 30, 40]);
		expect(history.undoCount).toBe(1);

		history.undo();
		expect(valuesOf(value)).toEqual([10, 20, 30, 40]);
		expect(getColumnById(value.id).processes).toEqual([]);
		expect(history.canUndo).toBe(false);
		// A further undo has nothing to take away: the import stays.
		history.undo();
		expect(core.data.map((c) => c.name)).toEqual(['time', 'value']);
		expect(valuesOf(value)).toEqual([10, 20, 30, 40]);

		history.redo();
		expect(valuesOf(value)).toEqual([10, 99, 30, 40]);
	});

	it('an edit made before the import still undoes, under the imported columns', async () => {
		const before = new Column({ type: 'number', data: -1, name: 'earlier' });
		core.rawData.set(before.id, [1, 2, 3]);
		before.data = before.id;
		core.data.push(before);
		M.renameColumn(before.id, 'renamed');

		const value = await importCsv();
		M.addProcess(value.id, 'EditValue', { edits: [{ id: 'e1', position: 1, value: -5 }] });
		expect(history.undoCount).toBe(2);

		history.undo(); // the edit after the import
		history.undo(); // the rename before it
		expect(getColumnById(before.id).name).toBe('earlier');
		expect(core.data.map((c) => c.name)).toEqual(['earlier', 'time', 'value']);
		expect(valuesOf(value)).toEqual([10, 20, 30, 40]);
		expect(history.canUndo).toBe(false);
	});

	it('a second import keeps the first import and its undoable edit', async () => {
		const first = await importCsv('a.csv');
		M.addProcess(first.id, 'EditValue', { edits: [{ id: 'e1', position: 4, value: 0 }] });
		const second = await importCsv('b.csv');
		expect(second.id).not.toBe(first.id);
		expect(history.undoCount).toBe(1);
		history.undo();
		expect(valuesOf(first)).toEqual([10, 20, 30, 40]);
		expect(valuesOf(second)).toEqual([10, 20, 30, 40]);
		expect(core.data).toHaveLength(4);
	});
});
