/**
 * End-to-end SESSION parity — JS side (NOT a normal test).
 *
 * For every session under static/sessions/{demos,classroom}/ this reconstructs
 * the session the way the app loads it, runs all table processes to completion
 * (synchronously, via the ThrowOnPost worker → workerPool sync fallback), then
 * records EVERY column's final data keyed by column id. tools/test_session_parity.py
 * runs the same sessions through ancir_runtime.py and asserts the per-column
 * outputs agree — a whole-session JS↔Python check.
 *
 * Run explicitly (gated):
 *   GEN_SESSION_PARITY=1 npx vitest run src/lib/_parity/emitSessionParity.svelte.test.js
 */
import { describe, it } from 'vitest';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';

const ROOT = process.cwd();
const SESSION_DIRS = [
	join(ROOT, 'static', 'sessions', 'demos'),
	join(ROOT, 'static', 'sessions', 'classroom')
];
const OUT = join(ROOT, 'tools', 'parity', 'session_js_results.json');

class ThrowOnPost {
	postMessage() {
		throw new Error('session parity: forcing synchronous compute');
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

function safeArray(arr) {
	return (arr ?? []).map((v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v));
}

async function loadAndRun(session) {
	resetCore();
	core.storedValues = session.storedValues ?? {};
	core.groups = session.groups ?? [];
	core.rawData = new Map(Object.entries(session.rawData ?? {}).map(([k, v]) => [+k, v]));
	for (const cd of session.data ?? []) pushObj(Column.fromJSON(cd));
	// Reconstruct free table-process nodes (out ids preserved → no recompute in
	// the constructor) then run each to completion in session order.
	for (const tpj of session.tableProcesses ?? []) {
		core.tableProcesses.push(new TableProcess(tpj, null, tpj.id));
	}
	for (const tp of core.tableProcesses) {
		try {
			await tp.doProcess();
		} catch (e) {
			// record nothing extra; a throw here surfaces as empty outputs which the
			// Python side will mismatch on — exactly what we want to see.
		}
	}
	const cols = {};
	for (const c of core.data) {
		cols[c.id] = { type: c.type, name: c.name, values: safeArray(c.getData?.()) };
	}
	return cols;
}

describe.runIf(process.env.GEN_SESSION_PARITY)('emit session parity (JS)', () => {
	it('runs every session end-to-end', async () => {
		appConsts.processMap = await loadProcesses();
		appConsts.plotMap = await loadPlots();
		appConsts.tableProcessMap = await loadTableProcesses();
		setWorkerFactory(() => new ThrowOnPost());

		const results = {};
		for (const dir of SESSION_DIRS) {
			if (!existsSync(dir)) continue;
			const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
			for (const file of files) {
				const session = JSON.parse(readFileSync(join(dir, file), 'utf8'));
				const sid = file.replace(/\.json$/, '');
				try {
					results[sid] = { ok: true, columns: await loadAndRun(session) };
				} catch (e) {
					results[sid] = { ok: false, error: String(e?.message ?? e) };
				}
			}
		}

		mkdirSync(join(ROOT, 'tools', 'parity'), { recursive: true });
		writeFileSync(OUT, JSON.stringify(results, null, 2), 'utf8');
		// eslint-disable-next-line no-console
		console.log(`SESSION PARITY: wrote ${Object.keys(results).length} sessions -> ${OUT}`);
	});
});
