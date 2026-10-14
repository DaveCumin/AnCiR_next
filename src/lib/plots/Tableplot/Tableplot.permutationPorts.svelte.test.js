// @ts-nocheck
// End to end, in the mounted app views: View permutations on Cosinor opens a Node-results
// Table with three output ports; wiring `permuted_statistic` into a Histogram on the canvas
// (the real port dots, the real wire handler) draws it; a recompute flows through to the
// Histogram with the Table on screen and off screen; the wire undoes and redoes; and the whole
// thing survives a save and load. Plan 2026-10-15 "fold Data View into Table", step 2 (5.5
// items 2, 3 and 5).
//
// Session: src/test/fixtures/dataview-legacy-handmade.json (the Cosinor demo with the
// permutation test on at 99 permutations; Cosinor is tableprocess_57). The mounted views are
// the ones +page.svelte mounts (__fixtures__/AppViews.svelte).
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, appState, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { mutationService } from '$lib/core/mutationService.js';
import { _resetComputeOwners } from '$lib/core/computeOwners.svelte.js';
import { readNodeResultTable } from '$lib/core/nodeResultTables.svelte.js';
import { getCachedProcessNodeGraph } from '$lib/core/ProcessNode.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { showNodeResultTable } from '$lib/components/plotbits/helpers/save.svelte.js';
import { permutationTableTitle } from '$lib/tableProcesses/permutationSupport.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';
import AppViews from '$lib/components/views/__fixtures__/AppViews.svelte';

const FIXTURE = join(process.cwd(), 'src', 'test', 'fixtures', 'dataview-legacy-handmade.json');
const COSINOR = 'tableprocess_57';
const KEYS = ['series', 'permutation', 'permuted_statistic'];

// Analyses that post to a worker run their synchronous fallback instead.
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
// Every console.error / console.warn line, so a background error (a node that threw while
// hidden, an effect loop) fails the test instead of only being printed.
let logged = [];
beforeEach(() => {
	logged = [];
	for (const level of ['error', 'warn']) {
		vi.spyOn(console, level).mockImplementation((...args) =>
			logged.push(args.map((a) => String(a?.message ?? a)).join(' '))
		);
	}
	appState.view = 'canvas';
	appState.canvasSelectedNodeId = null;
	appState.invisiblePlotIds = [];
	history.init();
});
afterEach(() => {
	vi.restoreAllMocks();
	cleanup();
	_resetComputeOwners();
	appState.view = 'canvas';
	appState.invisiblePlotIds = [];
});

async function settle(rounds = 6) {
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

const cosinor = () => core.tableProcesses.find((t) => t.id === 57);
const data = (id) => getColumnById(id)?.getData() ?? [];
const dot = (nodeId, port, dir) =>
	document.querySelector(
		`[data-node-id="${nodeId}"][data-port-name="${port}"][data-port-dir="${dir}"]`
	);
const graph = () => getCachedProcessNodeGraph(core, appConsts);

async function loadFixture(json = JSON.parse(readFileSync(FIXTURE, 'utf8'))) {
	render(AppViews);
	await settle(2);
	await importJson(json);
	await settle();
	await until(() => readNodeResultTable(COSINOR, 'permutations')?.rows?.length === 99);
}

async function openPermutationsTable() {
	const table = showNodeResultTable({
		sourceNodeId: COSINOR,
		resultKey: 'permutations',
		title: permutationTableTitle('Cosinor'),
		get: () => readNodeResultTable(COSINOR, 'permutations')
	});
	await until(() => Object.keys(table.metricOut).length === 3);
	return table;
}

describe('View permutations: a Table with output ports, wired into a Histogram', () => {
	it('wires, draws, follows a recompute (on and off screen), undoes, and survives save/load', async () => {
		await loadFixture();
		const table = await openPermutationsTable();

		// Three output ports, no inputs, on the canvas node and in the DOM.
		const tableNodeId = `plot_${table.id}`;
		const node = graph().nodes.find((n) => n.id === tableNodeId);
		expect(node.ports.inputs).toEqual([]);
		expect(node.ports.outputs.map((p) => p.display)).toEqual(KEYS);
		const permCol = table.metricOut.permuted_statistic;
		expect(data(permCol)).toHaveLength(99);
		expect(data(permCol).every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
		expect(data(table.metricOut.series)).toEqual(Array(99).fill('y'));
		expect(data(table.metricOut.permutation)).toEqual(Array.from({ length: 99 }, (_, i) => i + 1));
		await until(() => !!dot(tableNodeId, `col_${permCol}`, 'out'));
		expect(dot(tableNodeId, `col_${permCol}`, 'out')).toBeTruthy();

		// A new Histogram, wired on the canvas: press on the Table's output dot, release on the
		// Histogram's input dot (the gesture the canvas records as one undo step).
		const hist = mutationService.addPlot({ type: 'histogram', name: 'Null R²', x: 900, y: 80 });
		await settle();
		const histNodeId = `plot_${hist.id}`;
		await until(() => !!dot(histNodeId, 'data', 'in'));
		history.clear();
		await fireEvent.mouseDown(dot(tableNodeId, `col_${permCol}`, 'out'));
		await fireEvent.mouseUp(dot(histNodeId, 'data', 'in'));
		await settle();
		expect(hist.plot.data.map((d) => d.column?.refId)).toEqual([permCol]);
		expect(history.undoCount).toBe(1);
		const edge = graph().connections.find((c) => c.toId === histNodeId);
		expect(edge).toMatchObject({ fromId: tableNodeId, fromPort: `col_${permCol}` });
		// The histogram draws from the column: 99 values binned into bars.
		expect(hist.plot.data[0].column.getData()).toHaveLength(99);
		await until(() => document.querySelectorAll(`#plot${hist.id} rect`).length > 0);

		// A recompute with the Table on screen (a canvas node).
		cosinor().args.nPermutations = 199;
		await until(() => data(permCol).length === 199);
		expect(data(permCol)).toHaveLength(199);
		expect(hist.plot.data[0].column.getData()).toHaveLength(199);

		// And off screen: the plots view with the Table hidden, so only the compute host
		// mounts it (and Cosinor).
		appState.view = 'plots';
		appState.invisiblePlotIds = [table.id];
		await settle();
		expect(
			document.querySelectorAll(`.node-compute-host [data-compute-key="${tableNodeId}"]`)
		).toHaveLength(1);
		cosinor().args.nPermutations = 149;
		await until(() => data(permCol).length === 149);
		expect(data(permCol)).toHaveLength(149);
		expect(table.metricOut.permuted_statistic).toBe(permCol); // same column, never re-minted
		appState.view = 'canvas';
		appState.invisiblePlotIds = [];
		await settle();

		// Undo and redo the wire.
		history.undo();
		await settle();
		expect(hist.plot.data).toHaveLength(0);
		history.redo();
		await settle();
		expect(hist.plot.data.map((d) => d.column?.refId)).toEqual([permCol]);

		// Save and load: the same ports, the same wire, and still live.
		const saved = JSON.parse(outputCoreAsJson());
		const ids = { ...table.metricOut };
		cleanup();
		_resetComputeOwners();
		await loadFixture(saved);
		const table2 = core.plots.find((p) => p.id === table.id);
		const hist2 = core.plots.find((p) => p.id === hist.id);
		expect(table2.metricOut).toEqual(ids);
		expect(hist2.plot.data.map((d) => d.column?.refId)).toEqual([permCol]);
		expect(data(permCol)).toHaveLength(149);
		const edge2 = graph().connections.find((c) => c.toId === histNodeId);
		expect(edge2).toMatchObject({ fromId: tableNodeId, fromPort: `col_${permCol}` });
		cosinor().args.nPermutations = 99;
		await until(() => data(permCol).length === 99);
		expect(data(permCol)).toHaveLength(99);
		expect(table2.metricOut).toEqual(ids);

		// No effect loop and nothing thrown in the background along the way. (Regression: a
		// hidden node's result-table registration re-ran each time the compute host's list
		// re-derived, and a node-results Table's place in that list follows the registry, so
		// the two fed each other until Svelte gave up: effect_update_depth_exceeded.)
		expect(logged.filter((l) => /effect_update_depth_exceeded|background error/.test(l))).toEqual(
			[]
		);
	}, 60000);
});
