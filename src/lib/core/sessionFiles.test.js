import { describe, it, expect } from 'vitest';
import {
	SESSION_FILE_EXTENSIONS,
	SESSION_FILE_ACCEPT,
	SESSION_PICKER_TYPES,
	isSessionFileName,
	sessionBaseName,
	sessionSaveFileName,
	sessionNameForSave
} from './sessionFiles.js';

describe('session file names', () => {
	it('accepts .json and .ancir in any case', () => {
		for (const n of ['a.json', 'a.JSON', 'b.ancir', 'B.ANCIR', 'my.data.ancir']) {
			expect(isSessionFileName(n)).toBe(true);
		}
	});

	it('rejects other extensions and names that merely contain the word', () => {
		for (const n of ['a.csv', 'a.ancir.csv', 'ancir', 'json', 'a.jsonl', '', null, undefined]) {
			expect(isSessionFileName(n)).toBe(false);
		}
	});

	it('strips only the session extension for display', () => {
		expect(sessionBaseName('Cohort A.ancir')).toBe('Cohort A');
		expect(sessionBaseName('Cohort A.json')).toBe('Cohort A');
		expect(sessionBaseName('v1.2.ancir')).toBe('v1.2');
		expect(sessionBaseName('notes.txt')).toBe('notes.txt');
	});

	it('the file-input accept list and the picker offer both extensions', () => {
		expect(SESSION_FILE_EXTENSIONS).toEqual(['.json', '.ancir']);
		expect(SESSION_FILE_ACCEPT).toBe('.json,.ancir,application/json');
		expect(Object.values(SESSION_PICKER_TYPES[0].accept).flat()).toEqual(['.json', '.ancir']);
	});
});

describe('the name a saved session gets', () => {
	// Local time, just after midnight: a UTC-based date (toISOString) would give the 6th in any
	// zone ahead of UTC, which is the bug this pins.
	const day = new Date(2026, 9, 7, 0, 30);

	it('is the name, the local date and .ancir', () => {
		expect(sessionSaveFileName('Cohort A', day)).toBe('Cohort A 2026-10-07.ancir');
	});

	it('zero-pads the month and day', () => {
		expect(sessionSaveFileName('x', new Date(2026, 0, 5, 12))).toBe('x 2026-01-05.ancir');
	});

	it('falls back to "AnCiR session" when there is no usable name', () => {
		for (const n of [null, undefined, '', '   ', '///', '...']) {
			expect(sessionSaveFileName(n, day)).toBe('AnCiR session 2026-10-07.ancir');
		}
	});

	it('replaces characters file systems refuse, and trims the edges Windows rejects', () => {
		expect(sessionSaveFileName('a/b:c*d?"e<f>g|h\\i', day)).toBe(
			'a b c d e f g h i 2026-10-07.ancir'
		);
		expect(sessionSaveFileName(' .hidden. ', day)).toBe('hidden 2026-10-07.ancir');
		expect(sessionSaveFileName('tab\tand\nnewline', day)).toBe('tab and newline 2026-10-07.ancir');
	});

	it('drops a data or session extension carried over from the source file', () => {
		expect(sessionSaveFileName('actiwatch.csv', day)).toBe('actiwatch 2026-10-07.ancir');
		expect(sessionSaveFileName('Cohort A.ancir', day)).toBe('Cohort A 2026-10-07.ancir');
		expect(sessionSaveFileName('v1.2 results', day)).toBe('v1.2 results 2026-10-07.ancir');
	});

	it('replaces the date of an earlier save rather than stacking a second one', () => {
		expect(sessionSaveFileName('Cohort A 2026-10-01', day)).toBe('Cohort A 2026-10-07.ancir');
	});

	it('keeps a long name to a length every file system accepts', () => {
		const out = sessionSaveFileName('x'.repeat(500), day);
		expect(out.length).toBeLessThanOrEqual(120);
		expect(out.endsWith(' 2026-10-07.ancir')).toBe(true);
	});

	it('re-opens as a session file', () => {
		expect(isSessionFileName(sessionSaveFileName('Cohort A', day))).toBe(true);
	});
});

describe('which name a session is saved under', () => {
	it('is the first data source the user imported', () => {
		const core = { groups: [{ name: 'Group' }, { name: 'actiwatch.csv' }, { name: 'later.csv' }] };
		expect(sessionNameForSave(core)).toBe('actiwatch.csv');
	});

	it('is nothing when there is no named source, so the caller falls back', () => {
		expect(sessionNameForSave({ groups: [] })).toBeNull();
		expect(sessionNameForSave({ groups: [{ name: 'Group' }, { name: '  ' }] })).toBeNull();
		expect(sessionNameForSave({})).toBeNull();
	});
});
