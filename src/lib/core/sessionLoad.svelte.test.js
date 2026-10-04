// @ts-nocheck
// The guard rails in front of importJson (review ROB-1): what counts as a session, and the
// confirm-before-replace question every load entry point asks.
import { describe, it, expect, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import { core, appState } from './core.svelte.js';
import {
	sessionShapeProblem,
	isSessionJson,
	sessionHasContent,
	confirmReplaceSession,
	compareAppVersions,
	REPLACE_LABEL
} from './sessionLoad.svelte.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.notes = [];
	core.groups = [];
	core.orphanProcesses = [];
	appState.showAYSModal = false;
	appState.AYScallback = null;
});

describe('sessionShapeProblem', () => {
	it.each([
		['array', []],
		['row data', [{ time: 0 }]],
		['columnar data', { time: [0, 1], activity: [5, 6] }],
		['empty object', {}],
		['null', null],
		['string', 'session'],
		['data not a list', { data: { a: 1 } }],
		['data of values', { data: [1, 2] }],
		['plots not a list', { data: [], plots: {} }],
		['null node entry', { data: [], tableProcesses: [null] }]
	])('rejects %s', (_label, json) => {
		expect(sessionShapeProblem(json)).toEqual(expect.any(String));
	});

	it.each([
		['minimal', { data: [] }],
		['a saved session', { version: 'β.78.1', data: [{ id: 0 }], rawData: {}, plots: [] }],
		['legacy tables-only', { tables: [{ id: 0 }] }],
		['null optional lists', { data: [], plots: null, groups: undefined }]
	])('accepts %s', (_label, json) => {
		expect(sessionShapeProblem(json)).toBeNull();
	});

	it('isSessionJson matches the Import modal predicate, so routes cannot bounce a file', () => {
		expect(isSessionJson({ time: [1], activity: [2] })).toBe(false);
		expect(isSessionJson([])).toBe(false);
		expect(isSessionJson({ data: [], version: 'x' })).toBe(true);
	});
});

describe('confirmReplaceSession', () => {
	it('does not ask when nothing would be lost', async () => {
		expect(sessionHasContent()).toBe(false);
		await expect(confirmReplaceSession()).resolves.toBe(true);
		expect(appState.showAYSModal).toBe(false);
	});

	it('asks when work is open, and resolves to the choice', async () => {
		core.notes = [{ id: 'note_1', text: 'x' }];
		const answer = confirmReplaceSession('"B.json"');
		expect(appState.showAYSModal).toBe(true);
		expect(appState.AYStext).toContain('"B.json"');
		expect(appState.AYSoptions).toEqual([REPLACE_LABEL, 'Cancel']);
		// What AreYouSure does on a click: callback first, then close.
		appState.AYScallback(REPLACE_LABEL);
		appState.showAYSModal = false;
		await expect(answer).resolves.toBe(true);
	});

	it('Cancel resolves false', async () => {
		core.data = [{ id: 0 }];
		const answer = confirmReplaceSession();
		appState.AYScallback('Cancel');
		appState.showAYSModal = false;
		await expect(answer).resolves.toBe(false);
	});

	it('closing the dialog without a choice (Escape) resolves false instead of hanging', async () => {
		core.plots = [{ id: 0 }];
		const answer = confirmReplaceSession();
		flushSync();
		appState.showAYSModal = false; // native dialog closed, no callback run
		flushSync();
		await tick();
		await expect(answer).resolves.toBe(false);
	});
});

describe('compareAppVersions', () => {
	it('orders by numeric parts', () => {
		expect(compareAppVersions('β.79.0', 'β.78.1')).toBe(1);
		expect(compareAppVersions('β.78.1', 'β.78.10')).toBe(-1);
		expect(compareAppVersions('β.78.1', 'β.78.1')).toBe(0);
		expect(compareAppVersions('β.78', 'β.78.0')).toBe(0);
	});
	it('treats an unreadable version as no information', () => {
		expect(compareAppVersions(undefined, 'β.78.1')).toBe(0);
		expect(compareAppVersions('beta', 'β.78.1')).toBe(0);
	});
});
