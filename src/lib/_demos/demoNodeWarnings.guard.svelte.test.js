// @ts-nocheck
// Every shipped example (demos and classroom lessons) loads through the real importJson and
// the real components, and no analysis node shows a warning the example does not mean to
// show.
//
// Why: the crepuscular example shipped with its Rayleigh time wired to `xIN`, a key the node
// does not read, so the test ran on the activity counts as clock hours. Nothing failed; the
// node only showed a notice, and nobody looked. A warning on a shipped example is either a
// lesson (listed below, with the reason) or a bug.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { _resetComputeOwners } from '$lib/core/computeOwners.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { paramDiffWatcher } from '$lib/core/paramDiffWatcher.svelte.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';
import AppViews from '$lib/components/views/__fixtures__/AppViews.svelte';

const DIRS = ['static/sessions/demos', 'static/sessions/classroom'].map((d) =>
	join(process.cwd(), d)
);

/**
 * Warnings an example shows on purpose: `file -> [pattern, ...]`. Each pattern must match a
 * warning that is actually shown (a stale entry fails), and every shown warning must match
 * one pattern.
 */
const INTENDED = {
	// The node's own caveats, true of the example's data (listed 2026-11-21 when this guard
	// was added; each is a statistical caveat, not a wiring or unit error).
	// Timed (weighted) Rayleigh has no valid p-value; the example reads R and the acrophase.
	'demo-workflow-crepuscular.json': [/^RayleighTest: Timed mode reports R and the acrophase/],
	// The demo's inputs include a non-normal variable, which is what the node is for.
	'demo-tp-normalitytest.json': [/^NormalityTest: Non-normal at α=0\.05/],
	// Exploratory analysis: income is right-skewed on purpose.
	'demo-workflow-stats-eda.json': [/^NormalityTest: Non-normal at α=0\.05: income\./],
	// Twelve noise records and Anscombe's 11-point sets are small samples for shape statistics.
	'demo-workflow-noise-peak.json': [/^DescribeData: Skewness and kurtosis need about n ≥ 20/],
	'demo-workflow-stats-anscombe.json': [/^DescribeData: Skewness and kurtosis need about n ≥ 20/],
	// Small counts: the example then runs Fisher's exact test beside chi-square.
	'demo-workflow-stats-fisher-exact.json': [/^ChiSquared: \d of 4 expected counts are below 5/],
	'demo-workflow-stats-two-groups-counts.json': [
		/^ChiSquared: \d of 4 expected counts are below 5/
	],
	// Six subjects per group, hourly actigraphy (autocorrelated residuals), unequal spread.
	'demo-workflow-rest-activity.json': [
		/^Cosinor: The F-test p-value for "Consolidated\d" assumes independent/,
		/^GroupComparison: .*Normality check skipped because n = 6/,
		/^GroupComparison: .*Group variances differ by more than 4×/
	]
};

const sessions = DIRS.flatMap((dir) =>
	readdirSync(dir)
		.filter((f) => f.endsWith('.json') && f !== 'index.json' && !f.includes('[conflicted]'))
		.map((f) => ({ file: f, path: join(dir, f) }))
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
	history.init();
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

describe('shipped examples show no unintended node warnings', () => {
	it('the examples are found', () => expect(sessions.length).toBeGreaterThan(50));
	for (const { file, path } of sessions) {
		it(file, async () => {
			appState.view = 'canvas';
			render(AppViews);
			await settle(2);
			await importJson(JSON.parse(readFileSync(path, 'utf8')));
			await settle();
			const shown = core.tableProcesses.flatMap((tp) =>
				(tp.warnings ?? []).map((w) => `${tp.name}: ${w}`)
			);
			const intended = INTENDED[file] ?? [];
			const unexplained = shown.filter((w) => !intended.some((re) => re.test(w)));
			const stale = intended.filter((re) => !shown.some((w) => re.test(w)));
			expect({ unexplained, stale }).toEqual({ unexplained: [], stale: [] });
		});
	}
});
