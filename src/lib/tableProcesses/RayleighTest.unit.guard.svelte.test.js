// @ts-nocheck
// The Rayleigh test's unit, end to end through the real app.
//
// A NEW node reads the unit of its angles from the values (utils/angleUnit.js), so clock hours
// wired to a new node are no longer read as radians. Three things must hold for every unit and
// every route, and are pinned here by loading real sessions through the real importJson and
// mounting the real components:
//   1. the inference table: what a new node reads for each kind of input;
//   2. the user's choice sticks: once the select is changed nothing changes it again, through
//      new data, re-wiring, save and reload, and one undo gives back the unit it replaced;
//   3. saved sessions are untouched: a node saved before this (no `unitAuto`) keeps its unit
//      and its numbers even when the values contradict it, and only gains a notice.
//
// Generalises the 2026-11-15 bug: 24 clock hours (10.9 to 17) wired to a new node gave
// R 0.099, p 0.79 as radians where the hours give R 0.886, p 1e-8, with nothing on screen.
//
// KNOWN_MISREAD: the shipped crepuscular example wires its time of day to `xIN`, which the
// Rayleigh test does not read (its time input is `timeIN`), so the node tests the activity
// counts (0 to 83) as clock hours. The new notice says so. The example is generated
// (_demos/generateDemos.svelte.test.js) and is left as shipped until it is regenerated.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, appState, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';
import { _resetComputeOwners } from '$lib/core/computeOwners.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { paramDiffWatcher } from '$lib/core/paramDiffWatcher.svelte.js';
import { mutationService } from '$lib/core/mutationService.js';
import { buildTableProcessDefaults } from '$lib/core/tpDefaults.js';
import { rayleighTest, toRadiansColumn } from '$lib/utils/circular.js';
import { angleUnitMismatch } from '$lib/utils/angleUnit.js';
import { applyEdit } from '$lib/utils/aiEdit.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';
import AppViews from '$lib/components/views/__fixtures__/AppViews.svelte';

const DEMOS = join(process.cwd(), 'static/sessions/demos');
const demo = (name) => JSON.parse(readFileSync(join(DEMOS, name), 'utf8'));
const A = 930; // the Rayleigh demo's two input columns
const B = 931;

class ThrowOnPost {
	postMessage() {
		throw new Error('synchronous compute in tests');
	}
	terminate() {}
}

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	setWorkerFactory(() => new ThrowOnPost());
	history.init();
});
beforeEach(() => {
	appState.view = 'canvas';
	appState.canvasSelectedNodeId = null;
});
afterEach(() => {
	cleanup();
	paramDiffWatcher._disposeForTests();
	_resetComputeOwners();
	appState.canvasSelectedNodeId = null;
	history.clear();
});

async function settle(rounds = 8) {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await tick();
		await new Promise((r) => setTimeout(r, 20));
	}
	flushSync();
}
async function until(ok, ms = 8000) {
	const t0 = Date.now();
	while (!ok() && Date.now() - t0 < ms) await settle(1);
	await settle(2);
}
async function load(json) {
	const view = render(AppViews);
	await settle(2);
	await importJson(json);
	await settle();
	return view;
}

/** 24 times of day clustered around 14:00, as a column of acrophases holds them. */
const CLOCK_HOURS = Array.from({ length: 24 }, (_, i) => 10.87 + (i * (16.98 - 10.87)) / 23);

/** The shipped Rayleigh demo with its two input columns holding `a` and `b`. */
function session(a, b, mutateArgs) {
	const json = demo('demo-tp-rayleightest.json');
	json.rawData[A] = a;
	if (b) json.rawData[B] = b;
	mutateArgs?.(json.tableProcesses.find((t) => t.name === 'RayleighTest').args);
	return json;
}
const saved = () => core.tableProcesses.find((t) => t.id === 98);
const R = (tp, i = 0) => getColumnById(tp.args.out.R)?.getData()?.[i];
const direct = (values, unit, period = 24) => rayleighTest(toRadiansColumn(values, unit, period)).R;

const PLAIN_RADIANS = [0.1, 0.2, 0.3, 0.25, 0.15, 0.22, 0.18, 0.21];
/** New values in a column, as an edit of its cells makes them. */
function setValues(id, values) {
	const col = getColumnById(id);
	core.rawData.set(col.data, values);
	col.rawDataVersion++;
}

/** A node as the palette adds it, then wired to `yIN`. */
async function newNode(yIN, explicit = {}) {
	const entry = appConsts.tableProcessMap.get('RayleighTest');
	const tp = mutationService.addFreeTableProcess('RayleighTest', {
		...buildTableProcessDefaults(entry, explicit),
		...explicit
	});
	tp.args.yIN = yIN;
	await settle();
	await until(() => Number.isFinite(R(tp)));
	return tp;
}

/** The node's own Unit select (the canvas node and the control panel each mount one). */
function unitSelect(container, tp) {
	const wrap = container.querySelector(
		`.workflow-node-wrapper[data-node-id="tableprocess_${tp.id}"]`
	);
	return [...(wrap ?? container).querySelectorAll('select')].find((s) =>
		[...s.options].some((o) => o.value === 'hours' && o.textContent.trim() === 'Clock hours')
	);
}
async function choose(container, tp, unit) {
	const select = unitSelect(container, tp);
	expect(select, 'the Unit select is shown').toBeTruthy();
	select.value = unit;
	await fireEvent.change(select);
	await settle();
}

describe('the flag', () => {
	it('comes only from newNodeArgs, never from defaults, and not with an explicit unit', () => {
		const entry = appConsts.tableProcessMap.get('RayleighTest');
		expect(buildTableProcessDefaults(entry).unitAuto).toBe(true);
		expect(buildTableProcessDefaults(entry).unit).toBe('radians');
		for (const unit of ['radians', 'degrees', 'hours'])
			expect(buildTableProcessDefaults(entry, { unit }).unitAuto).toBe(false);
		expect(entry.defaults.has('unitAuto')).toBe(false);
		expect(entry.defaults.get('unit').val).toBe('radians');
	});
});

describe('a new node reads its unit from the values', () => {
	const TABLE = [
		// [label, column A, column B, expected unit]
		['clock hours of the day', CLOCK_HOURS, null, 'hours'],
		['radians', [0.2, 0.5, 0.4, 6.1, 0.1, 0.3, 0.25, 0.45], null, 'radians'],
		['signed radians', [-3.1, -2.9, 3.0, 3.1, -3.0, 2.95, 3.05, -3.05], null, 'radians'],
		['signed clock hours', [-11, -10.5, 11.2, 11.8, -11.6, 10.9, 11.5, -10.8], null, 'hours'],
		['degrees', [350, 5, 10, 355, 2, 358, 8, 352], null, 'degrees'],
		['signed degrees', [-170, 175, 178, -175, 172, -179, 176, -172], null, 'degrees'],
		['two columns, judged together', [1, 2, 3, 2.5, 1.5, 2.2, 1.8, 2.1], CLOCK_HOURS, 'hours'],
		['past every range (unwrapped)', [0, 400, 800, 1, 401, 801, 2, 402], null, 'radians']
	];
	for (const [label, a, b, unit] of TABLE) {
		it(`${label}: ${unit}`, async () => {
			await load(session(a, b));
			const tp = await newNode(b ? [A, B] : [A]);
			await until(() => tp.args.unit === unit);
			expect(tp.args.unit).toBe(unit);
			expect(tp.args.unitAuto).toBe(true);
			await until(() => Math.abs(R(tp) - direct(a, unit)) < 1e-9);
			expect(R(tp)).toBeCloseTo(direct(a, unit), 9);
			// The unit it read is never one it then warns about.
			expect((tp.warnings ?? []).some((w) => /set the unit to/.test(w))).toBe(false);
		});
	}

	it('the bug: clock hours on a new node are tested as hours, a strong R and not a weak one', async () => {
		await load(session(CLOCK_HOURS));
		const tp = await newNode([A]);
		await until(() => tp.args.unit === 'hours' && R(tp) > 0.5);
		expect(direct(CLOCK_HOURS, 'radians')).toBeLessThan(0.1);
		expect(R(tp)).toBeGreaterThan(0.85);
		expect(R(tp)).toBeCloseTo(direct(CLOCK_HOURS, 'hours'), 9);
	});

	it('a node created with an explicit unit keeps it, and is told when it cannot be right', async () => {
		await load(session(CLOCK_HOURS));
		const tp = await newNode([A], { unit: 'radians' });
		expect(tp.args.unitAuto).toBe(false);
		expect(tp.args.unit).toBe('radians');
		expect(R(tp)).toBeCloseTo(direct(CLOCK_HOURS, 'radians'), 9);
		await until(() => (tp.warnings ?? []).length > 0);
		expect(tp.warnings).toContain(angleUnitMismatch([CLOCK_HOURS], 'radians').message);
	});

	it('with a time wired the values are weights: nothing is inferred', async () => {
		const json = session(
			CLOCK_HOURS,
			CLOCK_HOURS.map((_, i) => i)
		);
		await load(json);
		const entry = appConsts.tableProcessMap.get('RayleighTest');
		const tp = mutationService.addFreeTableProcess(
			'RayleighTest',
			buildTableProcessDefaults(entry)
		);
		tp.args.timeIN = B;
		tp.args.yIN = [A];
		await settle();
		expect(tp.args.unit).toBe('radians');
		expect(tp.args.unitAuto).toBe(true);
	});
});

describe("the user's choice sticks", () => {
	it('changing the select stops the following for good: new data, re-wiring, save and reload', async () => {
		const { container } = await load(session(CLOCK_HOURS));
		let tp = await newNode([A]);
		await until(() => tp.args.unit === 'hours');
		await choose(container, tp, 'degrees');
		expect(tp.args.unit).toBe('degrees');
		expect(tp.args.unitAuto).toBe(false);
		await until(() => Math.abs(R(tp) - direct(CLOCK_HOURS, 'degrees')) < 1e-9);
		expect(R(tp)).toBeCloseTo(direct(CLOCK_HOURS, 'degrees'), 9);

		// New values that are plainly radians, then un-wiring and re-wiring.
		setValues(A, PLAIN_RADIANS);
		await settle();
		tp.args.yIN = [];
		await settle();
		tp.args.yIN = [A];
		await settle();
		expect(tp.args.unit).toBe('degrees');

		const stored = JSON.parse(outputCoreAsJson());
		const args = stored.tableProcesses.find((t) => t.id === tp.id).args;
		expect(args).toMatchObject({ unit: 'degrees', unitAuto: false });
		const id = tp.id;
		cleanup();
		_resetComputeOwners();
		await load(stored);
		tp = core.tableProcesses.find((t) => t.id === id);
		await until(() => Number.isFinite(R(tp)));
		expect(tp.args).toMatchObject({ unit: 'degrees', unitAuto: false });
	});

	it('choosing the unit it already read also makes it the user’s', async () => {
		const { container } = await load(session(CLOCK_HOURS));
		const tp = await newNode([A]);
		await until(() => tp.args.unit === 'hours');
		await choose(container, tp, 'radians');
		await choose(container, tp, 'hours');
		expect(tp.args).toMatchObject({ unit: 'hours', unitAuto: false });
		setValues(A, PLAIN_RADIANS);
		await settle();
		expect(tp.args.unit).toBe('hours');
	});

	it('a node still following survives save and reload following, with the unit it resolved', async () => {
		await load(session(CLOCK_HOURS));
		let tp = await newNode([A]);
		await until(() => tp.args.unit === 'hours');
		const stored = JSON.parse(outputCoreAsJson());
		expect(stored.tableProcesses.find((t) => t.id === tp.id).args).toMatchObject({
			unit: 'hours',
			unitAuto: true
		});
		const id = tp.id;
		cleanup();
		_resetComputeOwners();
		await load(stored);
		tp = core.tableProcesses.find((t) => t.id === id);
		await until(() => Number.isFinite(R(tp)));
		expect(tp.args).toMatchObject({ unit: 'hours', unitAuto: true });
		expect(R(tp)).toBeCloseTo(direct(CLOCK_HOURS, 'hours'), 9);
	});

	it('a unit set by the in-app AI edit is a choice too: it sticks, in one undo step', async () => {
		await load(session(CLOCK_HOURS));
		const tp = await newNode([A]);
		await until(() => tp.args.unit === 'hours');
		paramDiffWatcher.init();
		history.clear();
		await settle();
		const res = applyEdit({
			analyses: [],
			plots: [],
			bands: [],
			changes: [{ tpId: tp.id, key: 'unit', value: 'degrees' }]
		});
		expect(res.ok).toBe(true);
		await settle();
		expect(tp.args).toMatchObject({ unit: 'degrees', unitAuto: false });
		expect(history.undoCount).toBe(1);
		// New values that are plainly radians: the node no longer follows them.
		setValues(A, PLAIN_RADIANS);
		await settle();
		expect(tp.args.unit).toBe('degrees');
		history.undo();
		await settle();
		expect(tp.args.unitAuto).toBe(true);
	});

	it('one undo of the choice gives back the unit it replaced, and the following', async () => {
		const { container } = await load(session(CLOCK_HOURS));
		const tp = await newNode([A]);
		await until(() => tp.args.unit === 'hours');
		paramDiffWatcher.init();
		history.clear();
		await settle();
		await choose(container, tp, 'degrees');
		expect(tp.args).toMatchObject({ unit: 'degrees', unitAuto: false });
		expect(history.undoCount).toBe(1);
		history.undo();
		await settle();
		expect(tp.args).toMatchObject({ unit: 'hours', unitAuto: true });
		history.redo();
		await settle();
		expect(tp.args).toMatchObject({ unit: 'degrees', unitAuto: false });
	});
	it('the unit the node reads is not an undo step of its own', async () => {
		await load(session(CLOCK_HOURS));
		const tp = await newNode([A]);
		await until(() => tp.args.unit === 'hours');
		paramDiffWatcher.init();
		history.clear();
		await settle();
		// The column's values change to plain radians: the node follows, and there is nothing
		// to undo (an undo would put the node back on the unit the data has just ruled out).
		setValues(A, PLAIN_RADIANS);
		await until(() => tp.args.unit === 'radians');
		await settle();
		expect(tp.args.unitAuto).toBe(true);
		expect(history.undoCount).toBe(0);
	});
});

describe('saved sessions keep their unit and their numbers', () => {
	it('a node saved as radians over clock hours stays radians, same R, and gains a notice', async () => {
		const { container } = await load(session(CLOCK_HOURS));
		const tp = saved();
		await until(() => Number.isFinite(R(tp)));
		expect(tp.args.unit).toBe('radians');
		expect(tp.args.unitAuto ?? false).toBe(false);
		expect(R(tp)).toBeCloseTo(direct(CLOCK_HOURS, 'radians'), 9);
		const notice = angleUnitMismatch(
			[CLOCK_HOURS, demo('demo-tp-rayleightest.json').rawData[B]],
			'radians'
		);
		expect(notice.likely).toBe('hours');
		await until(() => (tp.warnings ?? []).includes(notice.message));
		expect(tp.warnings).toContain(notice.message);
		// Not written back on save either.
		const args = JSON.parse(outputCoreAsJson()).tableProcesses.find((t) => t.id === 98).args;
		expect(args.unit).toBe('radians');
		expect(args.unitAuto ?? false).toBe(false);
		// And on screen, where the user reads the result.
		appState.canvasSelectedNodeId = `tableprocess_${tp.id}`;
		await settle();
		expect(container.textContent).toContain('they look like clock hours read as radians');
	});

	it('a node saved with no unit at all reads radians, as it always did', async () => {
		await load(session(CLOCK_HOURS, null, (a) => delete a.unit));
		const tp = saved();
		await until(() => Number.isFinite(R(tp)));
		expect(tp.args.unit).toBe('radians');
		expect(tp.args.unitAuto ?? false).toBe(false);
		expect(R(tp)).toBeCloseTo(direct(CLOCK_HOURS, 'radians'), 9);
	});

	// Every shipped session with a Rayleigh test: unit as saved, no flag, and no notice (the
	// examples must not ship with a unit their own data contradicts).
	const withRayleigh = readdirSync(DEMOS)
		.filter((f) => f.endsWith('.json') && f !== 'index.json' && !f.includes('[conflicted]'))
		.filter((f) => (demo(f).tableProcesses ?? []).some((t) => t.name === 'RayleighTest'));
	const KNOWN_MISREAD = new Set(['demo-workflow-crepuscular.json']);
	it('the shipped examples are found', () => expect(withRayleigh.length).toBeGreaterThanOrEqual(3));
	for (const file of withRayleigh) {
		it(`${file}: unit unchanged, not following, no unit notice`, async () => {
			const json = demo(file);
			const before = json.tableProcesses
				.filter((t) => t.name === 'RayleighTest')
				.map((t) => [t.id, t.args.unit]);
			await load(json);
			await settle();
			for (const [id, unit] of before) {
				const tp = core.tableProcesses.find((t) => t.id === id);
				expect(tp.args.unit).toBe(unit);
				expect(tp.args.unitAuto ?? false).toBe(false);
				expect((tp.warnings ?? []).some((w) => /set the unit to/.test(w))).toBe(
					KNOWN_MISREAD.has(file)
				);
			}
		});
	}
});
