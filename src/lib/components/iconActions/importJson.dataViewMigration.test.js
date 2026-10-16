// @ts-nocheck
// The session-load hook for the Data View -> Table migration (plan 2026-10-15 "fold Data View
// into Table", 2.7 and 5.1): importJson runs migrateDataViews before any plot is built, so a
// session saved with Data Views opens with Tables in their place, on the same ids, positions
// and reference edges, with nothing left unrestored and nothing on the undo stack. Fixtures:
// src/test/fixtures/dataview-legacy-handmade.json and dataview-v81.16-saved.json (README there).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { notifications } from '$lib/core/notifications.svelte.js';
import { history } from '$lib/core/opHistory.svelte.js';
import { importJson } from './Setting.svelte';
import { getCachedProcessNodeGraph } from '$lib/core/ProcessNode.svelte.js';
import { referenceEdges } from '$lib/components/workflow/referenceEdges.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';

const fixture = (name) =>
	JSON.parse(readFileSync(join(process.cwd(), 'src', 'test', 'fixtures', name), 'utf8'));
const FIXTURES = ['dataview-legacy-handmade.json', 'dataview-v81.16-saved.json'];

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
});
beforeEach(() => {
	notifications.list.length = 0;
});

const warnings = () => notifications.list.filter((n) => n.type === 'warning').map((n) => n.message);

describe('importJson migrates Data Views to Tables', () => {
	for (const name of FIXTURES) {
		it(`${name}: both views open as Tables in the right modes, ids, layout and edges kept`, async () => {
			const s = fixture(name);
			await importJson(s);
			expect(core.unrestoredPlots).toEqual([]);
			expect(warnings()).toEqual([]);
			expect(core.plots.map((p) => `${p.id}:${p.type}`)).toEqual([
				'110:scatterplot',
				'111:tableplot',
				'120:tableplot',
				'121:tableplot'
			]);

			const view = core.plots.find((p) => p.id === 120);
			expect(view.name).toBe('Data: Cosinor: data + fit');
			// The fixture's note covers its plots, so the load gives the note a lane and moves
			// every plot down by one rigid shift (UI-7, notePlacement.js): the layout is kept up
			// to that shift, the same for every plot.
			const shift = core.plots.find((p) => p.id === 110).y - s.plots.find((p) => p.id === 110).y;
			expect(shift % 15).toBe(0);
			expect([view.x, view.y - shift, view.width, view.height]).toEqual([60, 420, 520, 260]);
			expect(view.plot.source).toBe('plot');
			expect(view.plot.sourcePlotId).toBe(110);
			// Live: the Table reads the scatterplot's computed data, not the saved copy.
			const source = core.plots.find((p) => p.id === 110);
			expect(view.plot.getDownloadData().headers).toEqual(source.plot.getDownloadData().headers);
			expect(view.plot.getDownloadData().rows.length).toBeGreaterThan(2);

			const stats = core.plots.find((p) => p.id === 121);
			expect(stats.name).toBe('Cosinor stats');
			expect(stats.sourceNodeId).toBe('tableprocess_57');
			expect(stats.plot.source).toBe('node');
			expect(stats.plot.resultKey).toBe('stats');
			// No Cosinor instance is mounted here, so the saved rows are what it shows.
			expect(stats.plot.getDownloadData()).toEqual({
				headers: ['column', 'period', 'mesor', 'amplitude'],
				rows: [['activity', 24, 10.01, 2.98]]
			});

			// The canvas layout is keyed by plot id, so it carries over untouched.
			for (const id of ['plot_120', 'plot_121'])
				expect(core.nodeLayout[id]).toEqual(s.nodeLayout[id]);

			const graph = getCachedProcessNodeGraph(core, appConsts);
			for (const id of ['plot_120', 'plot_121']) {
				const node = graph.nodes.find((n) => n.id === id);
				expect(node.ports.inputs).toEqual([]);
				expect(node.ports.outputs).toEqual([]);
			}
			const pairs = referenceEdges(graph.nodes).map((e) => `${e.fromId}->${e.toId}`);
			expect(pairs).toContain('plot_110->plot_120');
			expect(pairs).toContain('tableprocess_57->plot_121');
		});
	}

	it('the migration leaves nothing on the undo stack', async () => {
		await importJson(fixture(FIXTURES[1]));
		expect(history.undoCount).toBe(0);
		expect(history.canUndo).toBe(false);
		expect(core.plots.filter((p) => p.type === 'tableplot').map((p) => p.id)).toEqual([
			111, 120, 121
		]);
	});

	it('round trip: load, save, reload, save is stable and never writes a dataview', async () => {
		await importJson(fixture(FIXTURES[1]));
		const first = outputCoreAsJson();
		expect(first).not.toContain('"dataview"');
		const saved = JSON.parse(first);
		const views = saved.plots.filter((p) => [120, 121].includes(p.id));
		// A plot-data Table saves no rows; a node-results Table saves only its snapshot.
		expect(views[0].plot).not.toHaveProperty('snapshot');
		expect(views[0].plot).not.toHaveProperty('staticRows');
		expect(views[1].plot.snapshot.rows).toEqual([['activity', 24, 10.01, 2.98]]);

		await importJson(saved);
		const second = JSON.parse(outputCoreAsJson());
		expect(second.plots).toEqual(saved.plots);
		expect(second.nodeLayout).toEqual(saved.nodeLayout);
		expect(JSON.stringify(second)).not.toContain('"dataview"');
	});

	it('a frozen table is reported once, as a warning toast', async () => {
		const s = fixture(FIXTURES[0]);
		const v = s.plots.find((p) => p.id === 121);
		v.name = 'Hand-made numbers';
		v.plot.staticHeaders = ['a', 'b'];
		v.plot.staticRows = [[1, 2]];
		await importJson(s);
		expect(warnings()).toEqual([
			"Data View 'Hand-made numbers' is now a Table showing the rows it had when saved; it no longer updates, because its columns do not match any table that node publishes"
		]);
		const t = core.plots.find((p) => p.id === 121);
		expect(t.type).toBe('tableplot');
		expect(t.plot.resultKey).toBeNull();
		expect(t.plot.getDownloadData()).toEqual({ headers: ['a', 'b'], rows: [[1, 2]] });
	});
});
