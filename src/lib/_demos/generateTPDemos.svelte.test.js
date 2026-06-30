/**
 * Focused generator for the table-process (analysis) demo sessions.
 *
 * Writes just the demo-tp-<name>.json files from the shared buildTPDemo(),
 * leaving the plot / column-process demos and index.json untouched (the TP
 * entries' id/family/description/showcases are unchanged).
 *
 * Run explicitly (gated so it never runs in the normal suite):
 *   GEN_DEMOS=1 npx vitest run src/lib/_demos/generateTPDemos.svelte.test.js
 */
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { TP_SPECS } from './nodeCatalog.js';
import { buildTPDemo } from './nodeDemoBuilders.js';

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

describe.runIf(process.env.GEN_DEMOS)('generate table-process demo sessions', () => {
	it('writes every demo-tp-<name>.json', { timeout: 120000 }, async () => {
		appConsts.processMap = await loadProcesses();
		appConsts.plotMap = await loadPlots();
		appConsts.tableProcessMap = await loadTableProcesses();

		for (const spec of TP_SPECS) {
			resetCore();
			const entry = appConsts.tableProcessMap.get(spec.name);
			const display = entry?.displayName ?? spec.name;
			await buildTPDemo(spec, entry, display);
			const file = `demo-tp-${spec.name.toLowerCase()}.json`;
			writeFileSync(join(OUT_DIR, file), outputCoreAsJson(), 'utf8');
			// eslint-disable-next-line no-console
			console.log(`GENERATED ${file}`);
		}
	});
});
