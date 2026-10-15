// @ts-nocheck
// ROB-5: there was no unload guard, so closing or reloading the tab with work open lost it
// silently. The guard asks only when there IS unsaved work: an empty app, a session just
// opened and a session just saved close without a prompt.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts } from './core.svelte.js';
import {
	initUnsavedChanges,
	markSessionSaved,
	markSessionUnsaved,
	markSessionEdited,
	hasUnsavedChanges,
	installUnloadGuard
} from './unsavedChanges.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { history } from './opHistory.svelte.js';
import { mutationService as M } from './mutationService.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';

const DEMOS = join(process.cwd(), 'static', 'sessions', 'demos');
const demo = (name) => JSON.parse(readFileSync(join(DEMOS, name), 'utf8'));

function closeTab() {
	const e = new Event('beforeunload', { cancelable: true });
	window.dispatchEvent(e);
	return e.defaultPrevented;
}

let removeGuard;
beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	history.init();
	initUnsavedChanges();
	removeGuard = installUnloadGuard(window);
	return () => removeGuard();
});

beforeEach(async () => {
	await importJson(demo('demo-workflow-rest-activity.json'));
});

describe('unsaved changes and the close-tab guard', () => {
	it('a session that was just opened closes without a prompt', () => {
		expect(hasUnsavedChanges()).toBe(false);
		expect(closeTab()).toBe(false);
	});

	it('an edit (a recorded operation) makes closing ask; saving clears it', () => {
		const plot = core.plots[0];
		M.setPlotProperty(plot.id, 'name', `${plot.name} edited`);
		expect(hasUnsavedChanges()).toBe(true);
		expect(closeTab()).toBe(true);
		markSessionSaved();
		expect(closeTab()).toBe(false);
	});

	it('an undo is a change too', () => {
		const plot = core.plots[0];
		M.setPlotProperty(plot.id, 'name', 'x');
		markSessionSaved();
		history.undo();
		expect(hasUnsavedChanges()).toBe(true);
	});

	it('imported data (not an operation) counts: the session changed shape', () => {
		core.data.push({ id: 100000, name: 'imported', processes: [] });
		try {
			expect(hasUnsavedChanges()).toBe(true);
		} finally {
			core.data.pop();
		}
		expect(hasUnsavedChanges()).toBe(false);
	});

	it('an empty session never asks', () => {
		const saved = { data: core.data, tableProcesses: core.tableProcesses, plots: core.plots };
		core.data = [];
		core.tableProcesses = [];
		core.plots = [];
		const notes = core.notes;
		const groups = core.groups;
		core.notes = [];
		core.groups = [];
		try {
			expect(hasUnsavedChanges()).toBe(false);
			expect(closeTab()).toBe(false);
		} finally {
			Object.assign(core, saved);
			core.notes = notes;
			core.groups = groups;
		}
	});

	it('a session marked unsaved (a restored crash copy) asks until it is saved', () => {
		markSessionUnsaved();
		expect(closeTab()).toBe(true);
		markSessionSaved();
		expect(closeTab()).toBe(false);
	});

	it('a layout edit (neither an operation nor a change of shape) makes closing ask', () => {
		expect(hasUnsavedChanges()).toBe(false);
		markSessionEdited();
		expect(hasUnsavedChanges()).toBe(true);
		expect(closeTab()).toBe(true);
		markSessionSaved();
		expect(hasUnsavedChanges()).toBe(false);
	});

	it('the guard can be removed', () => {
		M.setPlotProperty(core.plots[0].id, 'name', 'y');
		removeGuard();
		try {
			expect(closeTab()).toBe(false);
		} finally {
			removeGuard = installUnloadGuard(window);
		}
	});
});
