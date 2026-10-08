// @ts-nocheck
// The binned periodograms' bin size, end to end through the real app (v80.1, SPEC-8).
//
// A NEW Periodogram plot series, Rhythmicity Analysis node or Moving Analysis node starts with
// its x's median sampling interval as the bin size (one sample per bin), instead of a flat
// 0.25 h that left three of every four bins empty on hourly data. A SAVED session must keep
// the bin size it was saved with, or the old 0.25 h when it stored none, so that its numbers
// only change because of the Enright fix itself (SPEC-7). Both are pinned here by loading
// real sessions through the real importJson and mounting the real components.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, appState, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';
import { _resetComputeOwners } from '$lib/core/computeOwners.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { mutationService } from '$lib/core/mutationService.js';
import { buildTableProcessDefaults } from '$lib/core/tpDefaults.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';
import AppViews from '$lib/components/views/__fixtures__/AppViews.svelte';

const DEMOS = join(process.cwd(), 'static/sessions/demos');
const demo = (name) => JSON.parse(readFileSync(join(DEMOS, name), 'utf8'));
// The periodogram tests need a session saved BEFORE v81 (no `binSizeAuto` on its series). The
// shipped demo stops being one the moment demos are regenerated, so it is frozen as a fixture.
const legacyPeriodogramDemo = () =>
	JSON.parse(
		readFileSync(
			join(process.cwd(), 'src/test/fixtures/legacy-v72.29-demo-periodogram-rhythm.json'),
			'utf8'
		)
	);

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

/** The shipped Rhythmicity Analysis demo (hourly x) switched to Enright, 20 to 28 h. */
function enrightRhythmicity(mutate) {
	const json = demo('demo-tp-rhythmicityanalysis.json');
	const tp = json.tableProcesses.find((t) => t.name === 'RhythmicityAnalysis');
	Object.assign(tp.args, { pgMethod: 'Enright', periodMin: 20, periodMax: 28, periodStep: 0.25 });
	mutate?.(tp.args);
	return json;
}
const periodsOf = (tp) => {
	const yId = tp.args.yIN[0];
	return col(tp.args.out[`${yId}_period`]);
};

describe('saved Rhythmicity Analysis nodes keep their bin size', () => {
	it('a node saved without pgBinSize computes at the old 0.25 h and does not follow x', async () => {
		await load(enrightRhythmicity((a) => delete a.pgBinSize));
		const tp = tpByName('RhythmicityAnalysis');
		await until(() => periodsOf(tp).length > 0);
		// Not filled in on load (the compute reads `pgBinSize ?? 0.25`), and never followed.
		expect(tp.args.pgBinSize ?? 0.25).toBe(0.25);
		expect(tp.args.pgBinSizeAuto ?? false).toBe(false);
		// Quarter-hour folds: the spectrum really was computed at 0.25 h bins.
		expect(periodsOf(tp)).toContain(24.25);
	});

	it('a node saved with a bin size keeps it', async () => {
		await load(enrightRhythmicity((a) => (a.pgBinSize = 0.5)));
		const tp = tpByName('RhythmicityAnalysis');
		await until(() => periodsOf(tp).length > 0);
		expect(tp.args.pgBinSize).toBe(0.5);
		expect(periodsOf(tp)).toContain(24.5);
		expect(periodsOf(tp)).not.toContain(24.25);
	});
});

describe('a new node follows its x', () => {
	for (const name of ['RhythmicityAnalysis', 'MovingAnalysis']) {
		it(`${name}: the flag comes only from newNodeArgs, never from defaults`, () => {
			const entry = appConsts.tableProcessMap.get(name);
			expect(buildTableProcessDefaults(entry).pgBinSizeAuto).toBe(true);
			expect(buildTableProcessDefaults(entry, { pgBinSize: 0.5 }).pgBinSizeAuto).toBe(false);
			expect(entry.defaults.has('pgBinSizeAuto')).toBe(false);
			expect(entry.defaults.get('pgBinSize').val).toBe(0.25);
		});
	}

	it('Rhythmicity Analysis: hourly x gives 1 h bins, kept on save and reload; an edit stops it', async () => {
		await load(enrightRhythmicity());
		const old = tpByName('RhythmicityAnalysis');
		const entry = appConsts.tableProcessMap.get('RhythmicityAnalysis');
		const tp = mutationService.addFreeTableProcess('RhythmicityAnalysis', {
			...buildTableProcessDefaults(entry),
			pgMethod: 'Enright',
			periodMin: 20,
			periodMax: 28,
			periodStep: 0.25
		});
		expect(tp.args.pgBinSizeAuto).toBe(true);
		tp.args.xIN = old.args.xIN;
		tp.args.yIN = [...old.args.yIN];
		await settle();
		await until(() => tp.args.pgBinSize === 1 && periodsOf(tp).length > 0);
		expect(tp.args.pgBinSize).toBe(1);
		expect(periodsOf(tp)).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28]);

		const saved = JSON.parse(outputCoreAsJson());
		cleanup();
		_resetComputeOwners();
		await load(saved);
		const reopened = core.tableProcesses.find((t) => t.id === tp.id);
		await until(() => periodsOf(reopened).length > 0);
		expect(reopened.args.pgBinSizeAuto).toBe(true);
		expect(reopened.args.pgBinSize).toBe(1);

		const wrap = document.querySelector(
			`.workflow-node-wrapper[data-node-id="tableprocess_${reopened.id}"]`
		);
		const label = [...(wrap?.querySelectorAll('label') ?? [])].find((l) =>
			l.textContent.trim().startsWith('Bin size (hrs)')
		);
		expect(label, 'the Bin size input is shown for Enright').toBeTruthy();
		await fireEvent.input(label.querySelector('input'), { target: { value: '0.5' } });
		await settle();
		expect(reopened.args.pgBinSizeAuto).toBe(false);
		expect(reopened.args.pgBinSize).toBe(0.5);
		const x = reopened.args.xIN;
		reopened.args.xIN = -1;
		await settle();
		reopened.args.xIN = x;
		await settle();
		expect(reopened.args.pgBinSize).toBe(0.5);
	});

	it('Moving Analysis: hourly x gives 1 h bins', async () => {
		const json = demo('demo-tp-movinganalysis.json');
		await load(json);
		const old = tpByName('MovingAnalysis');
		const entry = appConsts.tableProcessMap.get('MovingAnalysis');
		const tp = mutationService.addFreeTableProcess('MovingAnalysis', {
			...buildTableProcessDefaults(entry),
			analysis: 'periodogram',
			pgMethod: 'Enright'
		});
		expect(tp.args.pgBinSizeAuto).toBe(true);
		tp.args.xIN = old.args.xIN;
		tp.args.yIN = [...old.args.yIN];
		await until(() => tp.args.pgBinSize === 1);
		expect(tp.args.pgBinSize).toBe(1);
		// The shipped demo's own node (saved with 0.25) is untouched.
		expect(old.args.pgBinSize).toBe(0.25);
		expect(old.args.pgBinSizeAuto ?? false).toBe(false);
	});
});

describe('Periodogram plot series', () => {
	const periodogramPlot = () => core.plots.find((p) => p.type === 'periodogram');

	/** The hourly periodogram demo as shipped at β.72.29 (frozen fixture), its series edited. */
	function periodogramDemo(version, mutate) {
		const json = legacyPeriodogramDemo();
		if (version !== undefined) json.version = version;
		mutate(json.plots.find((p) => p.type === 'periodogram').plot.data[0]);
		return json;
	}
	const peakOf = (datum) => {
		const { x, y } = datum.periodData;
		return x[y.indexOf(Math.max(...y))];
	};

	// v81.0 (author's decision): before v81 the Bin Size control was HIDDEN for Enright, so a
	// legacy Enright series' 0.25 h was never a choice. The load migrates it to follow its x
	// (core/enrightBinMigration.js), exactly as a new series does.
	for (const [label, mutate] of [
		['stored at 0.25 h', (s) => (s.binSize = 0.25)],
		['stored with no bin size', (s) => delete s.binSize]
	]) {
		it(`a pre-v81 Enright series ${label} migrates to the sampling interval and peaks at 24 h`, async () => {
			const json = periodogramDemo(undefined, (s) => {
				s.method = 'Enright';
				mutate(s);
			});
			expect(json.version).toBe('β.72.29');
			await load(json);
			const datum = periodogramPlot().plot.data[0];
			await until(() => datum.binSize === 1 && datum.periodData.x.length > 0);
			expect(datum.binSizeAuto).toBe(true);
			expect(datum.binSize).toBe(1);
			// Whole-hour folds only: the spectrum really was computed at 1 h bins.
			expect(datum.periodData.x.every((p) => Number.isInteger(p))).toBe(true);
			expect(peakOf(datum)).toBe(24);
			// The resolved number is what a re-save stores (and what the ports read).
			const stored = JSON.parse(outputCoreAsJson()).plots.find((p) => p.type === 'periodogram').plot
				.data[0];
			expect(stored.binSize).toBe(1);
			expect(stored.binSizeAuto).toBe(true);
		});
	}

	for (const [label, version, mutate, bin] of [
		[
			'an Enright series with its own bin size',
			undefined,
			(s) => {
				s.method = 'Enright';
				s.binSize = 0.5;
			},
			0.5
		],
		[
			'a Chi-squared series at 0.25 h',
			undefined,
			(s) => {
				s.method = 'Chi-squared';
				s.binSize = 0.25;
			},
			0.25
		],
		[
			'an Enright series at 0.25 h in a v81 session',
			'v81.0',
			(s) => {
				s.method = 'Enright';
				s.binSize = 0.25;
			},
			0.25
		]
	]) {
		it(`${label} keeps its bin size and does not follow x`, async () => {
			await load(periodogramDemo(version, mutate));
			const datum = periodogramPlot().plot.data[0];
			await until(() => datum.periodData.x.length > 0);
			expect(datum.binSize).toBe(bin);
			expect(datum.binSizeAuto).toBe(false);
			expect(datum.periodData.x).toContain(24 + bin);
		});
	}

	it('a new series follows its x, survives save and reload, and an edit stops it', async () => {
		const json = legacyPeriodogramDemo();
		await load(json);
		const plot = periodogramPlot().plot;
		const first = plot.data[0];
		expect(first.binSizeAuto).toBe(false);
		plot.addData({ x: { refId: first.x.refId }, y: { refId: first.y.refId } });
		const datum = plot.data[1];
		expect(datum.binSizeAuto).toBe(true);
		datum.method = 'Enright';
		await until(() => datum.binSize === 1 && datum.periodData.x.length > 0);
		expect(datum.binSize).toBe(1);
		expect(datum.periodData.x.every((p) => Number.isInteger(p))).toBe(true);
		// The saved series next to it is untouched.
		expect(first.binSize).toBe(0.25);

		const saved = JSON.parse(outputCoreAsJson());
		const stored = saved.plots.find((p) => p.type === 'periodogram').plot.data[1];
		expect(stored.binSize).toBe(1);
		expect(stored.binSizeAuto).toBe(true);

		// Any write through the setter (the panel's input, a multi-select edit) is the user's.
		datum.binSize = 0.5;
		expect(datum.binSizeAuto).toBe(false);
		expect(datum.followSamplingInterval([0, 1, 2, 3])).toBe(false);
		expect(datum.binSize).toBe(0.5);
	});
});
