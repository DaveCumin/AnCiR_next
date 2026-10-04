import { describe, it, expect } from 'vitest';
import {
	SESSION_FILE_EXTENSIONS,
	SESSION_FILE_ACCEPT,
	SESSION_PICKER_TYPES,
	isSessionFileName,
	sessionBaseName
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
