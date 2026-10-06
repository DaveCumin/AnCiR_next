// @ts-nocheck
// Saving a session (the Save session menu item, the toolbar button and Cmd+S all call
// exportJson): the file is named after the data source and the local date as a .ancir (UI-15),
// the user is told what was saved, the download's object URL outlives the download (ROB-U2), and
// the file that comes out opens again as a session.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { core, appConsts, createGroup } from '$lib/core/core.svelte.js';
import { notifications } from '$lib/core/notifications.svelte.js';
import { isSessionFileName } from '$lib/core/sessionFiles.js';
import { exportJson, importJson } from './Setting.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
});

let saved; // { name, blob } of the last download
let revoked;
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

beforeEach(() => {
	saved = null;
	revoked = [];
	notifications.list.length = 0;
	core.groups = [];
	URL.createObjectURL = (blob) => {
		saved = { ...saved, blob };
		return 'blob:test-url';
	};
	URL.revokeObjectURL = (url) => revoked.push(url);
	vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
		saved = { ...saved, name: this.download };
	});
	vi.useFakeTimers();
	vi.setSystemTime(new Date(2026, 9, 7, 0, 30)); // local, just after midnight
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	URL.createObjectURL = realCreate;
	URL.revokeObjectURL = realRevoke;
	core.groups = [];
});

describe('exportJson', () => {
	it('names the file after the data source and the local date, as .ancir', () => {
		createGroup({ name: 'actiwatch.csv' });
		exportJson();
		expect(saved.name).toBe('actiwatch 2026-10-07.ancir');
	});

	it('calls an unnamed session "AnCiR session"', () => {
		exportJson();
		expect(saved.name).toBe('AnCiR session 2026-10-07.ancir');
	});

	it('tells the user the name of the file it saved', () => {
		exportJson();
		const toast = notifications.list.at(-1);
		expect(toast.type).toBe('info');
		expect(toast.message).toContain('AnCiR session 2026-10-07.ancir');
	});

	it('keeps the object URL alive long after the click, then frees it', () => {
		exportJson();
		vi.advanceTimersByTime(1000);
		expect(revoked).toEqual([]); // a 10 ms revoke could cancel the download (Firefox, Safari)
		vi.advanceTimersByTime(60_000);
		expect(revoked).toEqual(['blob:test-url']);
	});

	it('writes a file that opens again as the same session', async () => {
		createGroup({ name: 'Cohort A' });
		exportJson();
		expect(isSessionFileName(saved.name)).toBe(true);
		const text = await saved.blob.text();
		core.groups = [];
		vi.useRealTimers(); // importJson yields frames between steps
		await importJson(JSON.parse(text));
		expect(core.groups.map((g) => g.name)).toEqual(['Cohort A']);
	});
});
