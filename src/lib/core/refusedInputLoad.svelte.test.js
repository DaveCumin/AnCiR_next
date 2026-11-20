// @ts-nocheck
// A process that refuses time columns (`disallowTypes`, core/processInputRules.js) may still
// meet one in a saved session, wired before the rule existed. Loading it must not crash, must
// not compute on the time column's epoch milliseconds, and must say why: the input passes
// through unchanged and the node shows the standard refusal as a warning.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { getCachedProcessNodeGraph, clearProcessNodeGraphCache } from './ProcessNode.svelte.js';
import { processNodeWarnings } from './processWarnings.js';
import { disallowedInputTypes, refusedInputWarnings } from './processInputRules.js';

const REFUSE_TIME = ['Multiply', 'normalize', 'OutlierRemoval', 'FrequencyFilter', 'Sub'];
const TIMES = Array.from({ length: 12 }, (_, i) => `2024-04-06 ${String(i).padStart(2, '0')}:00`);

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
}, 60000);

/** The shipped Multiply demo, its input turned into a time column, its node into `name`. */
function savedSession(name) {
	const s = JSON.parse(
		readFileSync(join(process.cwd(), 'static/sessions/demos/demo-process-multiply.json'), 'utf8')
	);
	const input = s.data.find((c) => c.id === 604);
	input.type = 'time';
	input.timeFormat = 'YYYY-MM-DD HH:mm';
	s.rawData['604'] = TIMES;
	const out = s.data.find((c) => c.producerNodeId === 'process_2');
	out.type = 'time';
	s.orphanProcesses = [{ id: 2, name, args: { inIN: [604] } }];
	return s;
}

describe('the processes that refuse time columns', () => {
	it('Multiply, Normalize, Remove outliers, Frequency filter and Substitute declare it', () => {
		for (const name of REFUSE_TIME)
			expect([name, disallowedInputTypes(appConsts.processMap.get(name))]).toEqual([
				name,
				['time']
			]);
	});
});

describe.each(REFUSE_TIME)('a saved session with a time column wired into %s', (name) => {
	it('loads, passes the time column through unchanged and shows the refusal', async () => {
		await importJson(savedSession(name));
		const proc = core.orphanProcesses.find((p) => p.id === 2);
		expect(proc?.name).toBe(name);
		const input = core.data.find((c) => c.id === 604);
		const output = core.data.find((c) => c.producerNodeId === 'process_2');

		// Unchanged: the parsed instants, not a number computed from them.
		const want = input.getData();
		expect(want.every((v) => typeof v === 'number' && Number.isFinite(v))).toBe(true);
		expect(output.getData()).toEqual(want);

		// The node's warning is the standard refusal, then what happened to the input.
		const label = appConsts.processMap.get(name).displayName ?? name;
		const warnings = processNodeWarnings(proc);
		expect(warnings[0]).toBe(
			`${label} doesn't support time columns yet. Its time input passes through unchanged.`
		);

		// The canvas graph builds (the node card renders from it).
		clearProcessNodeGraphCache();
		const graph = getCachedProcessNodeGraph(core, appConsts);
		expect(graph.nodes.some((n) => n.id === 'process_2')).toBe(true);
	});
});

describe('refusedInputWarnings', () => {
	it('says nothing for a number input, or for a process that takes time (Add)', async () => {
		const s = savedSession('Multiply');
		s.data.find((c) => c.id === 604).type = 'number';
		s.rawData['604'] = TIMES.map((_, i) => i);
		await importJson(s);
		expect(refusedInputWarnings(core.orphanProcesses[0])).toEqual([]);

		await importJson(savedSession('Add'));
		expect(refusedInputWarnings(core.orphanProcesses[0])).toEqual([]);
	});
});
