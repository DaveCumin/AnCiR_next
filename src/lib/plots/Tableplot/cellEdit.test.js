import { describe, it, expect, vi } from 'vitest';
import { applyCellEdit } from './cellEdit.js';
import { editvalue } from '$lib/processes/EditValue.svelte';

// A column stand-in with just what applyCellEdit reads, and ops that record what they were asked
// to do, so each test can check both WHAT is stored and THAT it went through an undoable op.
function setup({ type = 'number', processes = [], raw = null, referencial = false } = {}) {
	const rawData = new Map();
	const column = {
		id: 7,
		type,
		data: 99,
		processes,
		rawDataVersion: 0,
		compression: null,
		isReferencial: () => referencial
	};
	if (raw) rawData.set(99, raw);
	const ops = {
		addProcess: vi.fn((colId, name, args) => {
			const p = { id: 'p1', name, args };
			column.processes.push(p);
			return p;
		}),
		setProcessArg: vi.fn((colId, procId, key, value) => {
			column.processes.find((p) => p.id === procId).args[key] = value;
		}),
		// Mirrors operations.js op_setRawCell: write the cell and bump the column's version.
		setRawCell: vi.fn((colId, row, value) => {
			rawData.get(column.data)[row] = value;
			column.rawDataVersion++;
		})
	};
	return { column, rawData, ops };
}

const editsOf = (column) => column.processes.at(-1).args.edits;

describe('applyCellEdit: number columns', () => {
	it('stores a cleared cell as null (missing), not 0 (STAT-15)', () => {
		const { column, rawData, ops } = setup({ type: 'number' });
		const r = applyCellEdit(column, 0, '', { rawData, ...ops });
		expect(r.ok).toBe(true);
		expect(editsOf(column)).toEqual([expect.objectContaining({ position: 1, value: null })]);
		// End to end through the Edit value process: the row reads back as missing.
		expect(editvalue([50, 60], { edits: editsOf(column) })).toEqual([null, 60]);
	});

	it('treats a whitespace-only entry as blank too', () => {
		const { column, rawData, ops } = setup({ type: 'number' });
		applyCellEdit(column, 2, '   ', { rawData, ...ops });
		expect(editsOf(column)[0].value).toBeNull();
	});

	it('parses a number', () => {
		const { column, rawData, ops } = setup({ type: 'number' });
		applyCellEdit(column, 1, ' 12.5 ', { rawData, ...ops });
		expect(editsOf(column)).toEqual([expect.objectContaining({ position: 2, value: 12.5 })]);
	});

	it('refuses a non-numeric entry with a reason and stores nothing (never NaN)', () => {
		const { column, rawData, ops } = setup({ type: 'number' });
		const r = applyCellEdit(column, 0, 'abc', { rawData, ...ops });
		expect(r.ok).toBe(false);
		expect(r.reason).toContain('"abc" is not a number');
		expect(ops.addProcess).not.toHaveBeenCalled();
		expect(ops.setProcessArg).not.toHaveBeenCalled();
		expect(column.processes).toEqual([]);
	});

	it('adds the Edit value process through the undoable op, with the edit already in it', () => {
		const { column, rawData, ops } = setup({ type: 'number' });
		applyCellEdit(column, 0, '5', { rawData, ...ops });
		expect(ops.addProcess).toHaveBeenCalledTimes(1);
		expect(ops.addProcess.mock.calls[0][0]).toBe(7);
		expect(ops.addProcess.mock.calls[0][1]).toBe('EditValue');
		expect(ops.addProcess.mock.calls[0][2].edits).toEqual([
			expect.objectContaining({ position: 1, value: 5 })
		]);
	});

	it('updates an existing Edit value process through setProcessArg with a NEW array', () => {
		const prior = [{ id: 'a', position: 1, value: 5 }];
		const { column, rawData, ops } = setup({
			type: 'number',
			processes: [{ id: 'p0', name: 'EditValue', args: { edits: prior } }]
		});
		applyCellEdit(column, 0, '', { rawData, ...ops });
		applyCellEdit(column, 3, '9', { rawData, ...ops });
		expect(ops.addProcess).not.toHaveBeenCalled();
		expect(ops.setProcessArg).toHaveBeenCalledTimes(2);
		expect(editsOf(column)).toEqual([
			{ id: 'a', position: 1, value: null },
			expect.objectContaining({ position: 4, value: 9 })
		]);
		expect(prior[0].value).toBe(5); // the recorded "before" value is not mutated
	});
});

describe('applyCellEdit: category columns', () => {
	it('keeps the typed text (not NaN) (STAT-15)', () => {
		const { column, rawData, ops } = setup({ type: 'category' });
		const r = applyCellEdit(column, 0, 'control', { rawData, ...ops });
		expect(r.ok).toBe(true);
		expect(editsOf(column)[0].value).toBe('control');
	});

	it('stores a cleared category cell as null', () => {
		const { column, rawData, ops } = setup({ type: 'category' });
		applyCellEdit(column, 0, '', { rawData, ...ops });
		expect(editsOf(column)[0].value).toBeNull();
	});

	it('keeps numeric-looking text as text in a category column', () => {
		const { column, rawData, ops } = setup({ type: 'category' });
		applyCellEdit(column, 0, '12', { rawData, ...ops });
		expect(editsOf(column)[0].value).toBe('12');
	});
});

describe('applyCellEdit: time columns', () => {
	it('stores an edited string time in the raw series', () => {
		const raw = ['2024-01-01 00:00', '2024-01-01 01:00'];
		const { column, rawData, ops } = setup({ type: 'time', raw });
		const r = applyCellEdit(column, 1, '2024-01-01 02:00', { rawData, ...ops });
		expect(r.ok).toBe(true);
		expect(rawData.get(99)[1]).toBe('2024-01-01 02:00');
		expect(column.rawDataVersion).toBe(1);
		// Through the undoable op, never a direct write.
		expect(ops.setRawCell).toHaveBeenCalledWith(7, 1, '2024-01-01 02:00');
	});

	it('parses an edited UNIX-ms time back to ms', () => {
		const raw = [0, 3600000];
		const { column, rawData, ops } = setup({ type: 'time', raw });
		const r = applyCellEdit(column, 1, '01 Jan 1970 02:00:00', { rawData, ...ops });
		expect(r.ok).toBe(true);
		expect(rawData.get(99)[1]).toBe(7200000);
		expect(ops.setRawCell).toHaveBeenCalledWith(7, 1, 7200000);
	});

	it('refuses an unreadable UNIX-ms time and leaves the series alone', () => {
		const raw = [0, 3600000];
		const { column, rawData, ops } = setup({ type: 'time', raw });
		const r = applyCellEdit(column, 1, 'tomorrow', { rawData, ...ops });
		expect(r.ok).toBe(false);
		expect(r.reason).toContain('DD MMM YYYY HH:mm:ss');
		expect(rawData.get(99)).toEqual([0, 3600000]);
		expect(column.rawDataVersion).toBe(0);
		expect(ops.setRawCell).not.toHaveBeenCalled();
	});

	it('clears a time cell to null, and still reads the series as UNIX ms afterwards', () => {
		const raw = [0, 3600000];
		const { column, rawData, ops } = setup({ type: 'time', raw });
		applyCellEdit(column, 0, '', { rawData, ...ops });
		expect(rawData.get(99)[0]).toBeNull();
		// Row 0 is now blank: the next edit must still be parsed as a date, not stored as text.
		applyCellEdit(column, 1, '01 Jan 1970 03:00:00', { rawData, ...ops });
		expect(rawData.get(99)[1]).toBe(10800000);
	});
});
