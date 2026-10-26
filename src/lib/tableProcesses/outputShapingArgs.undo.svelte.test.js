// @ts-nocheck
// An edit that adds or removes a node's output ports is ONE undo step, for every node and arg
// that does it (the definition's `outputShapingArgs`, read by
// mutationService.setFreeTableProcessArg). The node reconciles its ports a microtask after the
// edit, writing `out`; unless the arg is listed, the parameter watcher records that write as
// steps of its own, so undo restored the arg but left the new ports, or an output map naming
// columns that no longer existed. A column input (`columnIdFields`) counts as shaping too.
//
// Each case: the node's shipped demo loaded through importJson, the real components mounted
// with the node selected, the live parameter watcher and the real op history. The edit is a
// write to the arg, which is exactly what the panel's bind:value does. One step is recorded;
// undo puts back the old port set with the same column ids; redo puts back the new set with
// its ids. The full click-through (a real <select> change, numbers and wires) is pinned per
// node in TrendFit.modelUndo, Cosinor.curvesUndo and FitFunction.curves.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { readFileSync } from 'node:fs';
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

async function settle(rounds = 6) {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await tick();
		await new Promise((r) => setTimeout(r, 15));
	}
	flushSync();
}

// [node, demo, args set before the gesture (unrecorded), the arg the user edits, its new value]
const CASES = [
	['TrendFit', 'trendfit', {}, 'model', 'polynomial'],
	['TrendFit', 'trendfit', { model: 'polynomial' }, 'polyDegree', 3],
	['MovingAnalysis', 'movinganalysis', {}, 'analysis', 'cosinor'],
	['MovingAnalysis', 'movinganalysis', {}, 'pgMethod', 'Enright'],
	['MovingAnalysis', 'movinganalysis', { analysis: 'cosinor' }, 'useFixedPeriod', false],
	['MovingAnalysis', 'movinganalysis', { analysis: 'cosinor' }, 'nHarmonics', 2],
	[
		'MovingAnalysis',
		'movinganalysis',
		{ analysis: 'cosinor', useFixedPeriod: false },
		'Ncurves',
		2
	],
	[
		'MovingAnalysis',
		'movinganalysis',
		{ analysis: 'doublelogistic', dlPeriodic: false },
		'dlPeriodic',
		true
	],
	['MovingAnalysis', 'movinganalysis', { analysis: 'trend' }, 'trendModel', 'polynomial'],
	[
		'MovingAnalysis',
		'movinganalysis',
		{ analysis: 'trend', trendModel: 'polynomial' },
		'trendPolyDegree',
		3
	],
	['RhythmicityAnalysis', 'rhythmicityanalysis', {}, 'analysis', 'fft'],
	['RhythmicityAnalysis', 'rhythmicityanalysis', {}, 'pgMethod', 'Chi-squared'],
	['Split', 'split', {}, 'splitTimes', [15, 30, 40]],
	['JoinData', 'joindata', {}, 'sourceColumn', true],
	// Pair B's 'hive temp' with A's 'ambient temp': one joined value port instead of two.
	['JoinData', 'joindata', {}, 'pairing', { 906: 904 }],
	['FitFunction', 'fitfunction', {}, 'model', 'rectangular'],
	['FitFunction', 'fitfunction', {}, 'useFixedPeriod', false],
	['Cosinor', 'cosinor', { useFixedPeriod: false }, 'Ncurves', 2],
	// A column input picked in the panel (its ColumnSelector is bound to the arg): the
	// per-input ports come and go with it (mutationService treats columnIdFields as shaping).
	['TrendFit', 'trendfit', {}, 'yIN', []],
	['TrendFit', 'trendfit', {}, 'yIN', [892, 891]],
	['MovingAnalysis', 'movinganalysis', {}, 'yIN', []],
	['RhythmicityAnalysis', 'rhythmicityanalysis', {}, 'yIN', []],
	['Split', 'split', {}, 'yIN', []]
];

const outKeys = (tp) => Object.keys(tp.args.out ?? {}).sort();
const outMap = (tp) => Object.fromEntries(outKeys(tp).map((k) => [k, tp.args.out[k]]));

describe('an edit that changes the output ports is one undo step', () => {
	for (const [name, demo, prelude, key, next] of CASES) {
		const label = `${name} ${key} -> ${JSON.stringify(next)}`;
		it(
			label,
			async () => {
				render(AppViews);
				await settle(2);
				const json = JSON.parse(
					readFileSync(join(process.cwd(), `static/sessions/demos/demo-tp-${demo}.json`), 'utf8')
				);
				await importJson(json);
				await settle();
				const tp = core.tableProcesses.find((t) => t.name === name);
				appState.canvasSelectedNodeId = `tableprocess_${tp.id}`;
				Object.assign(tp.args, prelude);
				await settle();
				const before = outMap(tp);
				const was = JSON.parse(JSON.stringify(tp.args[key] ?? null));

				paramDiffWatcher.init();
				history.clear();
				tp.args[key] = next;
				await settle();
				const after = outMap(tp);
				// The case really reshapes the ports (else it would prove nothing).
				expect(outKeys(tp), label).not.toEqual(Object.keys(before).sort());
				expect(history.undoCount, label).toBe(1);

				history.undo();
				await settle();
				expect(tp.args[key] ?? null).toEqual(was);
				expect(outMap(tp)).toEqual(before);
				expect(history.undoCount).toBe(0);
				expect(history.redoCount).toBe(1);

				history.redo();
				await settle();
				expect(tp.args[key]).toEqual(next);
				expect(outMap(tp)).toEqual(after);
				expect(history.undoCount).toBe(1);
			},
			60000
		);
	}
});
