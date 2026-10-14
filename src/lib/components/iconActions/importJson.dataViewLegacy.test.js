// @ts-nocheck
// Data View stays registered through step 1 of "fold Data View into Table" (plan 2026-10-15):
// nothing spawns one any more, but a session saved with Data Views still loads as before. The
// migration to Tables is step 3. Fixture: src/test/fixtures/dataview-legacy-handmade.json
// (see the fixtures README).
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { importJson } from './Setting.svelte';
import { getCachedProcessNodeGraph } from '$lib/core/ProcessNode.svelte.js';
import { referenceEdges } from '$lib/components/workflow/referenceEdges.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';

const FIXTURE = join(process.cwd(), 'src', 'test', 'fixtures', 'dataview-legacy-handmade.json');

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
});

describe('a session with Data Views (pre-Table-sources) still loads', () => {
	it('restores both Data Views, with no input ports and with their reference edges', async () => {
		await importJson(JSON.parse(readFileSync(FIXTURE, 'utf8')));
		const views = core.plots.filter((p) => p.type === 'dataview');
		expect(views.map((p) => p.id).sort()).toEqual([120, 121]);
		const reactive = views.find((p) => p.id === 120);
		expect(reactive.plot.sourcePlotId).toBe(110);
		const stat = views.find((p) => p.id === 121);
		expect(stat.sourceNodeId).toBe('tableprocess_57');
		expect(stat.plot.rows).toEqual([['activity', 24, 10.01, 2.98]]);

		const graph = getCachedProcessNodeGraph(core, appConsts);
		for (const id of ['plot_120', 'plot_121']) {
			expect(graph.nodes.find((n) => n.id === id).ports.inputs).toEqual([]);
		}
		const pairs = referenceEdges(graph.nodes).map((e) => `${e.fromId}->${e.toId}`);
		expect(pairs).toContain('plot_110->plot_120');
		expect(pairs).toContain('tableprocess_57->plot_121');
	});
});
