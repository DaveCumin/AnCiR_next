/**
 * Focused generator for the column-process demo sessions.
 *
 * The full generator (generateDemos) rewrites EVERY demo file (and the index)
 * with fresh random GUIds — noisy churn when all you want is to refresh the
 * column-process demos. This writes just the demo-process-<name>.json files from
 * the shared buildProcessDemo(), leaving the plot / table-process demos and
 * index.json untouched (the process entries' id/family/description/showcases are
 * unchanged, so no manifest edit is needed).
 *
 * Run explicitly (gated so it never runs in the normal suite):
 *   GEN_DEMOS=1 npx vitest run src/lib/_demos/generateProcessDemos.svelte.test.js
 */
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { PROCESS_SPECS } from './nodeCatalog.js';
import { buildProcessDemo } from './nodeDemoBuilders.js';

const OUT_DIR = join(process.cwd(), 'static', 'sessions', 'demos');

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
	core.nodeLayout = {};
}

describe.runIf(process.env.GEN_DEMOS)('generate column-process demo sessions', () => {
	it('writes every demo-process-<name>.json', { timeout: 120000 }, async () => {
		appConsts.processMap = await loadProcesses();
		appConsts.plotMap = await loadPlots();
		appConsts.tableProcessMap = await loadTableProcesses();

		for (const spec of PROCESS_SPECS) {
			resetCore();
			const display = appConsts.processMap.get(spec.name)?.displayName ?? spec.name;
			await buildProcessDemo(spec, display);
			const file = `demo-process-${spec.name.toLowerCase()}.json`;
			writeFileSync(join(OUT_DIR, file), outputCoreAsJson(), 'utf8');
			// eslint-disable-next-line no-console
			console.log(`GENERATED ${file}`);
		}
	});
});
