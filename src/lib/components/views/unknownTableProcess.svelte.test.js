// @ts-nocheck
// ROB-U6: a session naming an analysis this build does not have (renamed, removed, or from a
// newer version). Reproduced 2026-10-28 in headless Chromium with the shipped SmoothedData
// demo renamed to "NoSuchAnalysis": the node loaded under its stored title ("Smooth Data"),
// its card and wires looked like a working node, its saved outputs drove both plots, and
// nothing said it could not compute: no toast, no badge, no console message (reportUnknownNode
// was only reached from the legacy TableProcess panel and from doProcess on NEW nodes).
// Saving kept the name, the args and the output data, and the Python export refuses unknown
// nodes loudly (STRICT_PROCESSES), so the data was safe; the silence was the bug.
//
// Now: the load raises one warning toast naming the unknown analyses, the card carries the
// warning badge and says in its body that the node cannot run and its saved outputs will not
// update, and the selected-node panel says the same. Save still round-trips everything.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, appState, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { notifications } from '$lib/core/notifications.svelte.js';
import {
	resetUnknownNodeReports,
	isUnknownAnalysis,
	unknownAnalysesWarning
} from '$lib/core/unknownNode.js';
import { _resetComputeOwners } from '$lib/core/computeOwners.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';
import AppViews from './__fixtures__/AppViews.svelte';

const DEMO = join(process.cwd(), 'static/sessions/demos/demo-tp-smootheddata.json');
const NODE = 'tableprocess_89';

function unknownSession() {
	const json = JSON.parse(readFileSync(DEMO, 'utf8'));
	for (const tp of json.tableProcesses) if (tp.name === 'SmoothedData') tp.name = 'NoSuchAnalysis';
	return json;
}

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
	notifications.list.length = 0;
	resetUnknownNodeReports();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	cleanup();
	_resetComputeOwners();
	appState.canvasSelectedNodeId = null;
	vi.restoreAllMocks();
});

async function settle(rounds = 6) {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await tick();
		await new Promise((r) => setTimeout(r, 20));
	}
	flushSync();
}

async function load(json) {
	render(AppViews);
	await settle(2);
	await importJson(json);
	await settle();
}

const card = () => document.querySelector(`.workflow-node-wrapper[data-node-id="${NODE}"]`);

describe('ROB-U6: an analysis this build does not know', () => {
	it('the load warns once, naming it', async () => {
		await load(unknownSession());
		const warnings = notifications.list.filter((n) => n.type === 'warning');
		const unknown = warnings.filter((n) => /NoSuchAnalysis/.test(n.message));
		expect(unknown).toHaveLength(1);
		expect(unknown[0].message).toMatch(/saved outputs are kept/i);
		expect(unknown[0].message).toMatch(/will not update/i);
	});

	it('a session of known analyses raises no such warning', async () => {
		await load(JSON.parse(readFileSync(DEMO, 'utf8')));
		expect(notifications.list.filter((n) => /cannot run|not know/i.test(n.message))).toEqual([]);
		expect(card().querySelector('.tp-unknown')).toBeNull();
	});

	it('the card shows the badge and says why, without opening anything', async () => {
		await load(unknownSession());
		expect(card()).not.toBeNull();
		const body = card().querySelector('.tp-unknown');
		expect(body?.textContent).toMatch(/NoSuchAnalysis/);
		expect(body?.textContent).toMatch(/cannot run/i);
		expect(card().querySelector('.node-warning-badge')).not.toBeNull();
	});

	it('the selected-node panel says the same', async () => {
		await load(unknownSession());
		appState.canvasSelectedNodeId = NODE;
		await settle();
		const panel = document.querySelector('.unknown-node');
		expect(panel?.textContent).toMatch(/NoSuchAnalysis/);
	});

	it('keeps its data: save round-trips the name, the args and the output columns', async () => {
		const json = unknownSession();
		await load(json);
		const saved = JSON.parse(outputCoreAsJson());
		const tp = saved.tableProcesses.find((t) => t.id === 89);
		expect(tp.name).toBe('NoSuchAnalysis');
		expect(tp.args).toEqual(json.tableProcesses.find((t) => t.id === 89).args);
		for (const id of Object.values(tp.args.out))
			expect(saved.rawData[String(id)]).toEqual(json.rawData[String(id)]);
		expect(core.tableProcesses.find((t) => t.id === 89)).toBeTruthy();
	});
});

describe('before the registry has loaded', () => {
	it('nothing is unknown yet, so an early restore is never flagged', () => {
		expect(isUnknownAnalysis('SmoothedData', new Map())).toBe(false);
		expect(isUnknownAnalysis('SmoothedData', undefined)).toBe(false);
		expect(unknownAnalysesWarning([{ name: 'SmoothedData' }], new Map())).toBeNull();
		expect(isUnknownAnalysis('NoSuchAnalysis', new Map([['SmoothedData', {}]]))).toBe(true);
	});
});
