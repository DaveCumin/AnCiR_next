import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerDataSourceActions, handleCanvasFileDrop } from './dataSourceActions.js';

// Canvas drop routing: a session file goes to the session loader (which checks the CONTENT and
// re-routes anything that is not a session to the Import modal); data files go to the Import modal.
const loadSessionFile = vi.fn();
const openImportFiles = vi.fn();

beforeEach(() => {
	loadSessionFile.mockClear();
	openImportFiles.mockClear();
	registerDataSourceActions({ loadSessionFile, openImportFiles });
});

const file = (name) => ({ name });

describe('handleCanvasFileDrop', () => {
	it('a dropped .ancir goes to the session loader', () => {
		const f = file('Cohort A.ancir');
		expect(handleCanvasFileDrop([f])).toBe(true);
		expect(loadSessionFile).toHaveBeenCalledWith(f);
		expect(openImportFiles).not.toHaveBeenCalled();
	});

	it('a dropped .json still goes to the session loader', () => {
		const f = file('Cohort A.json');
		handleCanvasFileDrop([f]);
		expect(loadSessionFile).toHaveBeenCalledWith(f);
	});

	it('the extension match is case-insensitive', () => {
		const f = file('COHORT.ANCIR');
		handleCanvasFileDrop([f]);
		expect(loadSessionFile).toHaveBeenCalledWith(f);
	});

	it('data files win over a session file in the same drop, as before', () => {
		const csv = file('a.csv');
		handleCanvasFileDrop([file('s.ancir'), csv]);
		expect(openImportFiles).toHaveBeenCalledWith([csv]);
		expect(loadSessionFile).not.toHaveBeenCalled();
	});

	it('an unknown extension goes to the Import modal to be sniffed', () => {
		const f = file('mystery.dat');
		handleCanvasFileDrop([f]);
		expect(openImportFiles).toHaveBeenCalledWith([f]);
		expect(loadSessionFile).not.toHaveBeenCalled();
	});
});
