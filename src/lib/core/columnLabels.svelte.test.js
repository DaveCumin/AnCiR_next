// @ts-nocheck
// Output display labels against a REAL loaded session (review finding UI-4): the Group phase
// comparison demo, whose Cosinor and Rayleigh outputs the review saw as `cosinory_66_5`,
// `rsquared_5`, `R_7`. Proves the labels show, that nothing they do reaches the saved file, and
// that a person's rename is what gets saved and shown.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { core, appConsts, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { getCachedProcessNodeGraph } from '$lib/core/ProcessNode.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';
import { columnNamer, columnDisplayName, restoreAutoNameIfLabel } from './columnLabels.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';

const here = dirname(fileURLToPath(import.meta.url));
const demo = join(here, '..', '..', '..', 'static/sessions/demos/demo-workflow-phase-groups.json');

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	await importJson(JSON.parse(readFileSync(demo, 'utf8')));
});

const tpNamed = (name) => core.tableProcesses.find((t) => t.name === name);
const outCol = (tp, key) => getColumnById(tp.args.out[key]);

/** The saved-format parts labels could conceivably touch: column names/ids and out maps. */
function savedShape() {
	const s = JSON.parse(outputCoreAsJson());
	return JSON.stringify({
		data: s.data.map((c) => [c.id, c.name]),
		outs: s.tableProcesses.map((t) => [t.id, t.args?.out]),
		metricOut: s.plots.map((p) => [p.id, p.metricOut ?? null])
	});
}

describe('labels on the Group phase comparison demo', () => {
	it('Cosinor and Rayleigh outputs read as words; stored names and keys untouched', () => {
		const cos = tpNamed('Cosinor');
		const ray = tpNamed('RayleighTest');
		expect(cos && ray).toBeTruthy();
		const namer = columnNamer();
		const R = outCol(ray, 'R');
		expect(R.name).toBe(`R_${ray.id}`); // stored name unchanged
		expect(namer(R)).toBe('Mean vector length (R)');
		expect(namer(outCol(ray, 'ww_pvalue'))).toBe('Watson-Williams p-value');
		expect(namer(outCol(ray, 'pvalue'))).toBe('Rayleigh p-value');
		expect(namer(outCol(cos, 'cosinorx'))).toBe('Cosinor fit: x');
		const yKey = Object.keys(cos.args.out).find((k) => k.startsWith('cosinory_'));
		const yIn = getColumnById(Number(yKey.slice('cosinory_'.length)));
		expect(outCol(cos, yKey).name).toBe(`${yKey}_${cos.id}`);
		expect(namer(outCol(cos, yKey))).toBe(`Cosinor fit: ${yIn.name}`);
		// The demo author named this one; their name is shown verbatim.
		expect(namer(outCol(cos, 'acrophase'))).toBe('Group A acrophase');
	});

	it('the canvas graph carries the same labels on the ports', () => {
		const ray = tpNamed('RayleighTest');
		const graph = getCachedProcessNodeGraph(core, appConsts);
		const node = graph.nodes.find((n) => n.id === `tableprocess_${ray.id}`);
		const port = node.ports.outputs.find((p) => p.name === `col_${ray.args.out.R}`);
		expect(port.display).toBe('Mean vector length (R)');
		const row = node.outputColumns.find((o) => o.key === 'R');
		expect(row).toMatchObject({ colId: ray.args.out.R, display: 'Mean vector length (R)' });
	});

	it('round trip: rendering labels changes nothing in the saved session', () => {
		const before = savedShape();
		const namer = columnNamer();
		for (const c of core.data) namer(c);
		getCachedProcessNodeGraph(core, appConsts);
		expect(savedShape()).toBe(before);
	});

	it('a user rename wins and is what is saved; typing the label back restores the auto name', () => {
		const ray = tpNamed('RayleighTest');
		const col = outCol(ray, 'z');
		const auto = col.name;
		expect(auto).toBe(`z_${ray.id}`);
		col.customName = 'Uniformity z';
		expect(columnDisplayName(col)).toBe('Uniformity z');
		expect(JSON.parse(outputCoreAsJson()).data.find((c) => c.id === col.id).name).toBe(
			'Uniformity z'
		);
		// Typing the label itself is not a rename: the seeded name comes back and the label shows.
		expect(restoreAutoNameIfLabel(col, 'Rayleigh z')).toBe(true);
		expect(col.name).toBe(auto);
		expect(columnDisplayName(col)).toBe('Rayleigh z');
		expect(JSON.parse(outputCoreAsJson()).data.find((c) => c.id === col.id).name).toBe(auto);
		// Any other text is left to the caller as a real rename.
		expect(restoreAutoNameIfLabel(col, 'Rayleigh')).toBe(false);
	});
});
