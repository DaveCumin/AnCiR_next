// @ts-nocheck
// Session loading is all-or-nothing and resets history (review ROB-1, ROB-2, ROB-10, ROB-17,
// ROB-22).
//
// ROB-1: importJson used to empty `core` BEFORE reading the file, so loading a data-shaped JSON,
// `{}`, `[]` or a session with one malformed node left the user with nothing (or a half-built
// session), with no undo. Each shape below must now leave the open session exactly as it was,
// down to object identity.
//
// ROB-2: the undo stack survived a load, so Cmd+Z applied the previous session's ops to the new
// one (ids restart, so they hit unrelated nodes).
//
// ROB-10: a plot that failed to rebuild was dropped with only a console message, and the next
// save deleted it for good.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, appState, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { importJson } from './Setting.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { mutationService as M } from '$lib/core/mutationService.js';
import { paramDiffWatcher } from '$lib/core/paramDiffWatcher.svelte.js';
import { addOpListener } from '$lib/core/operations.js';
import { notifications } from '$lib/core/notifications.svelte.js';
import { NotASessionError } from '$lib/core/sessionLoad.svelte.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';

const DEMOS = join(process.cwd(), 'static', 'sessions', 'demos');
const demo = (name) => JSON.parse(readFileSync(join(DEMOS, name), 'utf8'));
const SESSION_A = () => demo('demo-workflow-rest-activity.json');
const SESSION_B = () => demo('demo-workflow-free-running.json');

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	history.init();
});

beforeEach(() => {
	notifications.list.length = 0;
});

/** Identity-level fingerprint of the open session. */
function fingerprint() {
	return {
		data: [...core.data],
		tableProcesses: [...core.tableProcesses],
		plots: [...core.plots],
		rawData: core.rawData,
		groups: [...core.groups],
		notes: [...core.notes],
		nodeLayout: core.nodeLayout,
		figureStyle: core.figureStyle,
		ids: {
			data: core.data.map((c) => c.id),
			tps: core.tableProcesses.map((t) => `${t.id}:${t.name}`),
			plots: core.plots.map((p) => `${p.id}:${p.type}`)
		}
	};
}

function expectUnchanged(before) {
	const after = fingerprint();
	expect(after.ids).toEqual(before.ids);
	// Same OBJECTS, not re-serialised copies: the live nodes the user was working with.
	expect(after.data.every((c, i) => c === before.data[i])).toBe(true);
	expect(after.tableProcesses.every((t, i) => t === before.tableProcesses[i])).toBe(true);
	expect(after.plots.every((p, i) => p === before.plots[i])).toBe(true);
	expect(after.rawData).toBe(before.rawData);
	expect(after.nodeLayout).toBe(before.nodeLayout);
	expect(after.figureStyle).toBe(before.figureStyle);
}

const MALFORMED = {
	'columnar data JSON': () => ({ time: [0, 1, 2, 3], activity: [5, 6, 7, 8] }),
	'row data JSON': () => [
		{ time: 0, activity: 5 },
		{ time: 1, activity: 6 }
	],
	'empty object': () => ({}),
	'empty array': () => [],
	'data that is not a list': () => ({ ...SESSION_B(), data: { a: 1 } }),
	'data holding values, not columns': () => ({ data: [1, 2, 3] }),
	'plots that is not a list': () => ({ ...SESSION_B(), plots: { 0: {} } })
};

describe('a load that cannot succeed leaves the open session intact (ROB-1)', () => {
	for (const [label, make] of Object.entries(MALFORMED)) {
		it(`${label}: rejected as not a session, nothing changed`, async () => {
			await importJson(SESSION_A());
			const before = fingerprint();
			expect(before.data.length).toBeGreaterThan(0);
			await expect(importJson(make())).rejects.toBeInstanceOf(NotASessionError);
			expectUnchanged(before);
		});
	}

	it('a session whose analysis has null args fails mid-build and is rolled back', async () => {
		await importJson(SESSION_A());
		const before = fingerprint();
		const bad = SESSION_B();
		bad.tableProcesses[0].args = null;
		await expect(importJson(bad)).rejects.toThrow();
		expectUnchanged(before);
		// The rolled-back session still saves, and saves as itself.
		const saved = JSON.parse(outputCoreAsJson());
		expect(saved.data.map((c) => c.id)).toEqual(before.ids.data);
		expect(saved.unrestoredPlots).toEqual([]); // A had none; B's never got in
	});

	it('a failed load keeps the open session undo history (it still matches what is open)', async () => {
		await importJson(SESSION_A());
		M.setPlotProperty(core.plots[0].id, 'name', 'renamed in A');
		const count = history.undoCount;
		expect(count).toBeGreaterThan(0);
		const bad = SESSION_B();
		bad.tableProcesses[0].args = null;
		await expect(importJson(bad)).rejects.toThrow();
		expect(history.undoCount).toBe(count);
		history.undo();
		expect(core.plots[0].name).not.toBe('renamed in A');
	});
});

describe('history does not cross a session load (ROB-2, ROB-17)', () => {
	it('loading a session clears the previous session undo and redo stacks', async () => {
		await importJson(SESSION_A());
		M.setPlotProperty(core.plots[0].id, 'name', 'A edit 1');
		M.setPlotProperty(core.plots[0].id, 'width', 999);
		history.undo(); // something on the redo stack too
		expect(history.undoCount).toBeGreaterThan(0);
		expect(history.redoCount).toBeGreaterThan(0);

		await importJson(SESSION_B());
		expect(history.undoCount).toBe(0);
		expect(history.redoCount).toBe(0);
		// Undo now does nothing to B rather than replaying A's op on it.
		const names = core.plots.map((p) => p.name);
		history.undo();
		expect(core.plots.map((p) => p.name)).toEqual(names);
	});

	it('undo and redo are refused while a load is in flight', async () => {
		await importJson(SESSION_A());
		const plotId = core.plots[0].id;
		M.setPlotProperty(plotId, 'name', 'A edit');
		expect(history.canUndo).toBe(true);

		const pending = importJson(SESSION_B());
		// The load is now between its first awaits: A is torn down, B half built.
		expect(history.isLoading).toBe(true);
		expect(history.canUndo).toBe(false);
		const stackBefore = history.undoCount;
		history.undo();
		expect(history.undoCount).toBe(stackBefore); // nothing popped, nothing applied
		history.redo();
		await pending;
		expect(history.isLoading).toBe(false);
		expect(history.undoCount).toBe(0);
		expect(core.plots.some((p) => p.name === 'A edit')).toBe(false);
	});

	it('arg writes made while loading are not recorded as undo steps', async () => {
		await importJson(SESSION_B());
		const tp = core.tableProcesses[0];
		paramDiffWatcher.rebaseSnapshot();

		// The load-time output-map reconcile: a node re-keys args.out while the load runs. It is
		// the load's own write, so it must not even become an op (other op listeners would see a
		// user edit), let alone an undo step.
		const seen = [];
		const stop = addOpListener((forward) => seen.push(forward.kind));
		history.beginLoad();
		try {
			tp.args.out = { ...tp.args.out, reconciled_key: 123 };
			await paramDiffWatcher.flush();
			expect(history.undoCount).toBe(0);
			expect(seen).toEqual([]);
		} finally {
			history.endLoad();
			stop();
		}
		// Once loaded, the reconciled map is the baseline: no stale step appears, and a real
		// edit afterwards is still recorded.
		await paramDiffWatcher.flush();
		expect(history.undoCount).toBe(0);
		const key = Object.keys(tp.args).find(
			(k) => typeof tp.args[k] === 'number' && k !== 'out' && !k.startsWith('_')
		);
		tp.args[key] = tp.args[key] + 1;
		await paramDiffWatcher.flush();
		expect(history.undoCount).toBe(1);
	});

	it('a second load while one is in flight is refused, not interleaved', async () => {
		await importJson(SESSION_A());
		const first = importJson(SESSION_B());
		await expect(importJson(SESSION_A())).rejects.toThrow(/still loading/);
		await first;
		expect(core.tableProcesses.map((t) => t.name)).toEqual(['RhythmicityAnalysis']);
	});
});

describe('plots that cannot be rebuilt are reported and kept (ROB-10)', () => {
	function withBogusPlot() {
		const b = SESSION_B();
		b.plots[1].type = 'bogusplot';
		b.plots[1].futureField = { nested: [1, 2, 3] };
		return b;
	}

	it('loads the rest, says how many failed, and keeps the raw plot JSON', async () => {
		const b = withBogusPlot();
		const original = JSON.parse(JSON.stringify(b.plots[1]));
		await importJson(b);
		expect(core.plots.map((p) => p.type)).toEqual(['actogram', 'tableplot']);
		const toast = notifications.list.find((n) => /could not be restored/.test(n.message));
		expect(toast?.message).toMatch(/^1 plot could not be restored \(type: bogusplot\)/);
		expect(toast?.type).toBe('warning');
		expect(JSON.parse(JSON.stringify(core.unrestoredPlots))).toEqual([original]);
	});

	it('round-trips the failed plot untouched through save and reload', async () => {
		const b = withBogusPlot();
		const original = JSON.parse(JSON.stringify(b.plots[1]));
		await importJson(b);
		const saved = JSON.parse(outputCoreAsJson());
		expect(saved.unrestoredPlots).toEqual([original]);

		await importJson(saved);
		expect(core.plots.map((p) => p.type)).toEqual(['actogram', 'tableplot']);
		const resaved = JSON.parse(outputCoreAsJson());
		expect(resaved.unrestoredPlots).toEqual([original]);
		// Its id stays reserved, so no plot created later can take it.
		expect(core.plots.some((p) => p.id === original.id)).toBe(false);
	});

	it('a kept plot that becomes loadable is restored as a normal plot', async () => {
		const b = withBogusPlot();
		await importJson(b);
		const saved = JSON.parse(outputCoreAsJson());
		saved.unrestoredPlots[0].type = 'periodogram'; // e.g. a later version understands it
		await importJson(saved);
		expect(core.plots.map((p) => p.type).sort()).toEqual(['actogram', 'periodogram', 'tableplot']);
		expect(core.unrestoredPlots).toEqual([]);
	});

	it('a clean load reports nothing and keeps nothing', async () => {
		await importJson(SESSION_B());
		expect(notifications.list.some((n) => /could not be restored/.test(n.message))).toBe(false);
		expect(core.unrestoredPlots).toEqual([]);
	});
});

describe('newer-version warning (ROB-22)', () => {
	it('warns when the session was saved by a newer app', async () => {
		await importJson({ ...SESSION_B(), version: 'β.999.0' });
		const toast = notifications.list.find((n) => /newer version of AnCiR/.test(n.message));
		expect(toast?.message).toContain('β.999.0');
		expect(toast?.message).toContain(appConsts.version);
	});

	it('says nothing for the current or an older version', async () => {
		await importJson({ ...SESSION_B(), version: appConsts.version });
		await importJson({ ...SESSION_B(), version: 'β.1.0' });
		expect(notifications.list.some((n) => /newer version/.test(n.message))).toBe(false);
	});
});

describe('plot colour-map memory is per session', () => {
	it('restores the saved map and drops the previous session entries', async () => {
		await importJson({ ...SESSION_A(), plotColormaps: { 0: 'viridis', 7: 'magma' } });
		expect({ ...core.plotColormaps }).toEqual({ 0: 'viridis', 7: 'magma' });
		await importJson({ ...SESSION_B(), plotColormaps: { 3: 'magma', bad: 5 } });
		expect({ ...core.plotColormaps }).toEqual({ 3: 'magma' });
		await importJson({ ...SESSION_B(), plotColormaps: undefined });
		expect({ ...core.plotColormaps }).toEqual({});
	});
});

// Keep appState tidy for any later file in the same worker.
describe('cleanup', () => {
	it('leaves no load in flight', () => {
		expect(history.isLoading).toBe(false);
		expect(appState.showAYSModal).toBe(false);
	});
});
