// @ts-nocheck
// The free-period range and its units, end to end through the real app (v80.1).
//
// 1. The report: a free-period cosinor on an x in DAYS fitted a 1-day rhythm with R² 0.997,
//    then printed "1 h" periods and warned there was "no clear rhythm", because the range,
//    the labels and the warning all assumed hours and the warning ignored the fit.
// 2. Saved sessions keep their range and so their results (below).
//
// v80.1 made the period range of a NEW free-period fit (Cosinor, Rectangular wave, Double
// logistic, Fit waveform model) follow the data when x is a plain number column: the
// Nyquist period to the record span, instead of the fixed 1 to 48 that assumes hours. The
// danger is a session saved BEFORE then: its node may carry no minPeriod / maxPeriod at all
// (the shipped Rectangular wave and Double logistic demos do not), and the old code filled
// the gap with 1 to 48 at mount (fillDefaults) and at compute time (`?? FREE_PERIOD_DEFAULTS`).
// If "absent" now meant "follow the data", those sessions would silently refit to new numbers.
//
// The guarantee: a node follows the data only when it carries `periodRangeAuto: true`, which
// only the palette / in-app AI edit write (definition.newNodeArgs, via
// buildTableProcessDefaults). A loaded node without the flag keeps 1 to 48 and its results.
// This file loads real sessions through the real importJson, mounts the real components,
// and pins every fit output to the values the code computed BEFORE the change.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';
import { _resetComputeOwners } from '$lib/core/computeOwners.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { mutationService } from '$lib/core/mutationService.js';
import { buildTableProcessDefaults } from '$lib/core/tpDefaults.js';
import { createColumnNamer } from '$lib/core/outputLabels.js';
import { outputCoreAsJson } from '$lib/core/core.svelte.js';
import { applyEdit } from '$lib/utils/aiEdit.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';
import AppViews from '$lib/components/views/__fixtures__/AppViews.svelte';

const DEMOS = join(process.cwd(), 'static/sessions/demos');
const demo = (name) => JSON.parse(readFileSync(join(DEMOS, name), 'utf8'));

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
});
beforeEach(() => {
	appState.view = 'canvas';
	appState.canvasSelectedNodeId = null;
});
afterEach(() => {
	cleanup();
	_resetComputeOwners();
	appState.canvasSelectedNodeId = null;
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
	render(AppViews);
	await settle(2);
	await importJson(json);
	await settle();
}

const tpByName = (name) => core.tableProcesses.find((t) => t.name === name);
const col = (id) => getColumnById(id)?.getData() ?? [];
const firstFinite = (id) => col(id).find((v) => Number.isFinite(v));

/**
 * The author's session: the shipped Cosinor demo (Sequence column x, Cosinor, plots) with x
 * renamed "Time (days)" running 0 to 3 every 30 min, a 1-day cosine (mesor 6.8, amplitude
 * 0.45, peak at 0.77) plus small noise as "result_2", and the free period on 1 to 48 as the
 * author's node had it.
 */
function authorSession() {
	const json = demo('demo-tp-cosinor.json');
	let s = 3;
	const rnd = () => {
		s = (s * 1103515245 + 12345) % 2147483648;
		return s / 2147483648;
	};
	const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
	const seq = json.tableProcesses.find((t) => t.name === 'SequenceColumn');
	const tp = json.tableProcesses.find((t) => t.name === 'Cosinor');
	const n = 145;
	const t = Array.from({ length: n }, (_, i) => i / 48);
	Object.assign(seq.args, { step: 1 / 48, count: n, end: 3 });
	json.rawData[String(tp.args.xIN)] = t;
	json.rawData[String(tp.args.yIN[0])] = t.map(
		(ti) => 6.8 + 0.45 * Math.cos(2 * Math.PI * (ti - 0.77)) + 0.02 * gauss()
	);
	for (const c of json.data) {
		if (c.id === tp.args.xIN) c.name = 'Time (days)';
		if (c.id === tp.args.yIN[0]) c.name = 'result_2';
	}
	Object.assign(tp.args, { useFixedPeriod: false, minPeriod: 1, maxPeriod: 48, Ncurves: 1 });
	return json;
}

/** The legacy free-period cosinor: the shipped Cosinor demo with the period freed. */
function legacyFreeCosinor() {
	const json = demo('demo-tp-cosinor.json');
	const tp = json.tableProcesses.find((t) => t.name === 'Cosinor');
	tp.args.useFixedPeriod = false;
	delete tp.args.minPeriod;
	delete tp.args.maxPeriod;
	delete tp.args.periodRangeAuto;
	return json;
}

// Values computed by v80.0 (commit 79a1633b), before the change, from these exact sessions.
const PINNED = {
	RectangularWave: { r2: 0.9571274351365205, rmse: 5.457267679191282 },
	DoubleLogistic: { r2: 0.9855288018053066, rmse: 2.8153329690220796 },
	Cosinor: {
		period: 23.596479812791245,
		amplitude: 41.60917515368885,
		acrophase: 11.956075382555987,
		rsquared: 0.9565382311707048
	}
};

describe('sessions saved without a period range keep 1 to 48 and their results', () => {
	it.each([
		['demo-tp-rectangularwave.json', 'RectangularWave', ['r2', 'rmse']],
		['demo-tp-doublelogistic.json', 'DoubleLogistic', ['r2', 'rmse']]
	])('%s', async (file, name, keys) => {
		const json = demo(file);
		const saved = json.tableProcesses.find((t) => t.name === name).args;
		// The shipped demo really is the at-risk shape: numeric x, no stored range.
		expect(saved.minPeriod).toBeUndefined();
		expect(saved.maxPeriod).toBeUndefined();
		expect(json.data.find((c) => c.id === saved.xIN).type).toBe('number');

		await load(json);
		const tp = tpByName(name);
		await until(() => Number.isFinite(firstFinite(tp.args.out[keys[0]])));
		expect(tp.args.minPeriod).toBe(1);
		expect(tp.args.maxPeriod).toBe(48);
		expect(tp.args.periodRangeAuto ?? false).toBe(false);
		const got = Object.fromEntries(keys.map((k) => [k, firstFinite(tp.args.out[k])]));
		for (const k of keys) {
			expect(got[k]).toBeCloseTo(PINNED[name][k], 9);
		}
	});

	it('a free-period cosinor on numeric x with no stored range', async () => {
		await load(legacyFreeCosinor());
		const tp = tpByName('Cosinor');
		const keys = ['period', 'amplitude', 'acrophase', 'rsquared'];
		await until(() => Number.isFinite(firstFinite(tp.args.out.period)));
		expect(tp.args.minPeriod).toBe(1);
		expect(tp.args.maxPeriod).toBe(48);
		expect(tp.args.periodRangeAuto ?? false).toBe(false);
		const got = Object.fromEntries(keys.map((k) => [k, firstFinite(tp.args.out[k])]));
		for (const k of keys) {
			expect(got[k]).toBeCloseTo(PINNED.Cosinor[k], 9);
		}
	});
});

describe("the author's case, end to end", () => {
	it('a saved node on 1 to 48: units say x units and the warning credits the good fit', async () => {
		await load(authorSession());
		const tp = tpByName('Cosinor');
		await until(() => Number.isFinite(firstFinite(tp.args.out.period)));
		// The saved range is the user's and is kept, so the result is unchanged...
		expect(tp.args.minPeriod).toBe(1);
		expect(tp.args.maxPeriod).toBe(48);
		expect(firstFinite(tp.args.out.period)).toBeCloseTo(1, 6);
		expect(firstFinite(tp.args.out.rsquared)).toBeGreaterThan(0.99);
		// ...but nothing calls these hours, and the warning no longer denies the rhythm.
		const text = tp.warnings.join('\n');
		expect(text).toMatch(
			/found its best period at the lower limit of the period range: 1 x units, range 1 to 48 x units/
		);
		expect(text).toMatch(/Lower the minimum period to confirm the period/);
		expect(text).not.toMatch(/no clear rhythm/);
		const namer = createColumnNamer(core);
		expect(namer(getColumnById(tp.args.out.period))).toBe('Period (x units)');
		expect(namer(getColumnById(tp.args.out.acrophase))).toBe('Acrophase (x units)');
		expect(namer(getColumnById(tp.args.out.bathyphase))).toBe('Bathyphase (x units)');
	});

	it('a NEW node on the same data follows its x: Nyquist to span, period 1, no warning', async () => {
		await load(authorSession());
		const old = tpByName('Cosinor');
		const entry = appConsts.tableProcessMap.get('Cosinor');
		const tp = mutationService.addFreeTableProcess('Cosinor', {
			...buildTableProcessDefaults(entry),
			useFixedPeriod: false,
			Ncurves: 1
		});
		expect(tp.args.periodRangeAuto).toBe(true);
		tp.args.xIN = old.args.xIN;
		tp.args.yIN = [...old.args.yIN];
		await settle();
		await until(() => Number.isFinite(firstFinite(tp.args.out.period)));
		expect(tp.args.minPeriod).toBe(0.0417);
		expect(tp.args.maxPeriod).toBe(3);
		expect(firstFinite(tp.args.out.period)).toBeCloseTo(1, 3);
		expect(firstFinite(tp.args.out.acrophase)).toBeCloseTo(0.77, 2);
		expect(tp.warnings.join('\n')).not.toMatch(/limit of the period range/);

		const wrap = document.querySelector(
			`.workflow-node-wrapper[data-node-id="tableprocess_${tp.id}"]`
		);
		const inputLabelled = (text) =>
			[...(wrap?.querySelectorAll('label') ?? [])].find((l) =>
				l.textContent.trim().startsWith(text)
			);
		// The input shows the stored value (a step-1 input used to display 0.0417 as "0").
		expect(inputLabelled('Min period (x units)')?.querySelector('input').value).toBe('0.0417');

		// Save and reopen: the panel mounting again must not touch the stored range (the old
		// input minimum of 0.1 would have clamped 0.0417 up to 0.1, changing the result).
		const saved = JSON.parse(outputCoreAsJson());
		cleanup();
		_resetComputeOwners();
		await load(saved);
		const reopened = core.tableProcesses.find((t) => t.id === tp.id);
		await until(() => Number.isFinite(firstFinite(reopened.args.out.period)));
		expect(reopened.args.periodRangeAuto).toBe(true);
		expect(reopened.args.minPeriod).toBe(0.0417);
		expect(reopened.args.maxPeriod).toBe(3);
		expect(firstFinite(reopened.args.out.period)).toBeCloseTo(firstFinite(tp.args.out.period), 9);
	});

	it("typing a bound makes the range the user's: it stops following x", async () => {
		await load(authorSession());
		const old = tpByName('Cosinor');
		const entry = appConsts.tableProcessMap.get('Cosinor');
		const tp = mutationService.addFreeTableProcess('Cosinor', {
			...buildTableProcessDefaults(entry),
			useFixedPeriod: false,
			Ncurves: 1
		});
		tp.args.xIN = old.args.xIN;
		tp.args.yIN = [...old.args.yIN];
		await settle();
		await until(() => tp.args.minPeriod === 0.0417);
		const wrap = document.querySelector(
			`.workflow-node-wrapper[data-node-id="tableprocess_${tp.id}"]`
		);
		const label = [...(wrap?.querySelectorAll('label') ?? [])].find((l) =>
			l.textContent.trim().startsWith('Max period (x units)')
		);
		expect(label, 'the Max period input, labelled in x units').toBeTruthy();
		await fireEvent.input(label.querySelector('input'), { target: { value: '2' } });
		await settle();
		expect(tp.args.periodRangeAuto).toBe(false);
		expect(tp.args.maxPeriod).toBe(2);
		tp.args.xIN = -1;
		await settle();
		tp.args.xIN = old.args.xIN;
		await settle();
		expect(tp.args.minPeriod).toBe(0.0417);
		expect(tp.args.maxPeriod).toBe(2);
	});

	it('an AI edit that names a range keeps it; one that does not follows x', async () => {
		await load(authorSession());
		const old = tpByName('Cosinor');
		const inputs = { xIN: old.args.xIN, yIN: [...old.args.yIN] };
		const res = applyEdit({
			analyses: [
				{ tpType: 'Cosinor', inputs, params: { useFixedPeriod: false, minPeriod: 0.5 } },
				{ tpType: 'Cosinor', inputs, params: { useFixedPeriod: false } }
			],
			plots: [],
			changes: [],
			bands: [],
			errors: []
		});
		expect(res.ok).toBe(true);
		await settle();
		const [named, unnamed] = core.tableProcesses.filter((t) => t.name === 'Cosinor').slice(-2);
		await until(() => unnamed.args.minPeriod === 0.0417);
		expect(named.args.periodRangeAuto).toBe(false);
		expect(named.args.minPeriod).toBe(0.5);
		expect(named.args.maxPeriod).toBe(48);
		expect(unnamed.args.periodRangeAuto).toBe(true);
		expect(unnamed.args.maxPeriod).toBe(3);
	});

	it('a new node only follows its x when no range was named (AI edit with a range)', () => {
		const entry = appConsts.tableProcessMap.get('Cosinor');
		expect(buildTableProcessDefaults(entry).periodRangeAuto).toBe(true);
		expect(buildTableProcessDefaults(entry, { minPeriod: 20 }).periodRangeAuto).toBe(false);
		for (const name of ['RectangularWave', 'DoubleLogistic', 'FitFunction']) {
			const e = appConsts.tableProcessMap.get(name);
			expect(buildTableProcessDefaults(e).periodRangeAuto, name).toBe(true);
			// Never in `defaults`: fillDefaults would then stamp it onto every loaded node.
			expect(e.defaults.has('periodRangeAuto'), name).toBe(false);
		}
	});
});
