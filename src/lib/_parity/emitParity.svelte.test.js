/**
 * JS side of the JS↔Python parity harness (NOT a normal test).
 *
 * Runs every fixture in tools/parity/fixtures.json through the REAL AnCiR JS
 * engine (the same Column / TableProcess / process registry the app uses) and
 * writes the outputs to tools/parity/js_results.json. tools/test_parity.py then
 * runs the same fixtures through ancir_runtime.py and asserts the two agree.
 *
 * Compute runs synchronously: a ThrowOnPost fake worker forces the worker pool's
 * documented sync fallback (workerPool.js), so worker-dispatched analyses
 * (e.g. Cosinor's cosinor.fitMany) execute on the main thread and finish before
 * we read their outputs — no hangs, fully deterministic.
 *
 * Run it explicitly (gated so it never runs in the normal suite):
 *   GEN_PARITY=1 npx vitest run src/lib/_parity/emitParity.svelte.test.js
 */
import { describe, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';

const PARITY_DIR = join(process.cwd(), 'tools', 'parity');

// Force the worker pool's sync fallback: a worker whose postMessage throws makes
// runComputeTask run the registered task on the main thread (workerPool.js).
class ThrowOnPost {
	postMessage() {
		throw new Error('parity harness: forcing synchronous compute');
	}
	terminate() {}
}

function resetCore() {
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.notes = [];
	core.nodeNotes = {};
	core.orphanProcesses = [];
	core.storedValues = {};
	core.rawData = new Map();
}

function mkCol(type, values, name) {
	const c = new Column({ type, data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

// Deep-resolve '@ref' tokens in args to the real column ids created for inputs.
function resolveTokens(value, idMap) {
	if (typeof value === 'string' && value.startsWith('@')) {
		const ref = value.slice(1);
		if (!(ref in idMap)) throw new Error(`unknown input ref ${value}`);
		return idMap[ref];
	}
	if (Array.isArray(value)) return value.map((v) => resolveTokens(v, idMap));
	if (value && typeof value === 'object') {
		const out = {};
		for (const [k, v] of Object.entries(value)) out[k] = resolveTokens(v, idMap);
		return out;
	}
	return value;
}

// cosinory_13 -> cosinory ; fity_2 -> fity ; cosinorx -> cosinorx (no change).
function canonicalKey(k) {
	const m = k.match(/^(.*)_\d+$/);
	return m ? m[1] : k;
}

// JSON can't carry NaN/Infinity — encode as null; the Python side treats a null
// in a numeric output array as NaN so NaN==NaN positions still match.
function safeArray(arr) {
	return (arr ?? []).map((v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v));
}

function runColumnProcess(fx) {
	const def = appConsts.processMap.get(fx.jsName);
	if (!def?.func) throw new Error(`no JS column process ${fx.jsName}`);
	return { outputs: { value: safeArray(def.func(fx.input, fx.args ?? {})) } };
}

async function runTableProcess(fx) {
	const entry = appConsts.tableProcessMap.get(fx.jsName);
	if (!entry?.func) throw new Error(`no JS table process ${fx.jsName}`);
	const idMap = {};
	for (const inp of fx.inputs) idMap[inp.ref] = mkCol(inp.type ?? 'number', inp.values, inp.ref);
	const args = resolveTokens(fx.args, idMap);
	const tp = new TableProcess({ name: fx.jsName, args }, null);
	pushObj(tp);
	await entry.func(tp.args);

	const want = new Set(fx.compareOutputs ?? []);
	const outputs = {};
	for (const [key, id] of Object.entries(tp.args.out ?? {})) {
		if (typeof id !== 'number' || id < 0) continue;
		const canon = canonicalKey(key);
		if (!want.has(canon)) continue;
		const col = core.data.find((c) => c.id === id);
		outputs[canon] = safeArray(col?.getData?.());
	}
	return { outputs };
}

describe.runIf(process.env.GEN_PARITY)('emit JS parity results', () => {
	it('runs every fixture through the JS engine', async () => {
		appConsts.processMap = await loadProcesses();
		appConsts.plotMap = await loadPlots();
		appConsts.tableProcessMap = await loadTableProcesses();
		setWorkerFactory(() => new ThrowOnPost());

		const { fixtures } = JSON.parse(readFileSync(join(PARITY_DIR, 'fixtures.json'), 'utf8'));
		const results = {};
		for (const fx of fixtures) {
			resetCore();
			results[fx.id] =
				fx.kind === 'columnProcess' ? runColumnProcess(fx) : await runTableProcess(fx);
		}

		mkdirSync(PARITY_DIR, { recursive: true });
		writeFileSync(join(PARITY_DIR, 'js_results.json'), JSON.stringify(results, null, 2), 'utf8');
		// eslint-disable-next-line no-console
		console.log(`PARITY: wrote js_results.json (${Object.keys(results).length} fixtures)`);
	});
});
