// @ts-nocheck
// The session-load migration hook (plan 2026-09-26-facets-as-views, section 2.1): importJson
// runs migrateFacetChildren BEFORE the plot loop, so a v76.4 session with facet CHILD plots
// loads as its generator alone, with the children's limits carried as overrides and every
// other per-child edit reported through the notifications channel, one toast per generator.
// The four captured fixtures (src/test/fixtures/README.md) are the input.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { notifications } from '$lib/core/notifications.svelte.js';
import { importJson } from './Setting.svelte';
import { panelsFor } from '$lib/core/facetPanels.svelte.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';

const fixture = (name) =>
	JSON.parse(readFileSync(join(process.cwd(), 'src', 'test', 'fixtures', name), 'utf8'));

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
});
beforeEach(() => {
	notifications.list.length = 0;
});

const warnings = () => notifications.list.filter((n) => n.type === 'warning').map((n) => n.message);

describe('importJson migrates legacy facet children', () => {
	it('fixture 1 (plain children): the four children fold into generator 7 with no warning', async () => {
		const s = fixture('facet-eda-children.json');
		expect(s.plots.map((p) => p.id)).toEqual([7, 13, 14, 15, 16, 8, 9, 10, 11]);
		await importJson(s);
		expect(core.plots.map((p) => p.id)).toEqual([7, 8, 9, 10, 11]);
		const gen = core.plots[0];
		expect(gen.facet).toBe(true);
		expect(gen.facetOverrides).toEqual({});
		// Four PANELS, derived, not plots: the same four columns in order.
		expect(panelsFor(gen).map((p) => p.name)).toEqual(['height', 'weight', 'income', 'noise']);
		expect(panelsFor(gen).map((p) => p.unitKey)).toEqual(['c112#0', 'c113#0', 'c114#0', 'c115#0']);
		expect(warnings()).toEqual([]);
		// The input object is not mutated (the migration copies when it has work to do).
		expect(s.plots).toHaveLength(9);
	});

	it('fixture 2 (edited children): the y-limits carry as an override; padding and radius are reported', async () => {
		await importJson(fixture('facet-scatter-edited-children.json'));
		const gen = core.plots.find((p) => p.id === 49);
		expect(gen).toBeTruthy();
		expect(core.plots.some((p) => [53, 54, 55].includes(p.id))).toBe(false);
		// The migration writes LEAVES (facetOverrides.js: leaf and whole-key forms are both valid).
		expect(gen.facetOverrides).toEqual({
			'y375#0': { 'ylimsLeftIN[0]': 10, 'ylimsLeftIN[1]': 40 }
		});
		const w = warnings();
		expect(w).toHaveLength(1);
		expect(w[0]).toContain("Panel 'onset_delay'");
		expect(w[0]).toContain('Padding Top (40)');
		expect(w[0]).toContain('Padding Right (50)');
		expect(w[0]).toContain("Panel 'onset_advance'");
		expect(w[0]).toContain('Points Radius (7)');
		// The panel whose limits were carried projects them; its siblings do not.
		const panels = panelsFor(gen);
		expect(panels.map((p) => p.unitKey)).toEqual(['y375#0', 'y376#0', 'y377#0']);
	});

	it('fixture 3 (actogram markers on one child): the blocks move onto generator series 1 only', async () => {
		await importJson(fixture('facet-actogram-markers.json'));
		const gen = core.plots.find((p) => p.id === 0);
		expect(gen.type).toBe('actogram');
		expect(core.plots.map((p) => p.id)).not.toContain(4);
		expect(gen.plot.data[0].phaseMarkers).toHaveLength(2);
		expect(gen.plot.data[0].phaseMarkers.map((m) => m.type)).toEqual(['onset', 'manual']);
		expect(gen.plot.data[1].phaseMarkers).toHaveLength(0);
		expect(warnings()).toHaveLength(1);
		expect(warnings()[0]).toContain("2 phase marker blocks; it was moved onto the plot's series 1");
	});

	it('fixture 4 (reordered children): keys on the column, so nothing is carried and nothing warned', async () => {
		await importJson(fixture('facet-reordered-children.json'));
		const gen = core.plots.find((p) => p.id === 49);
		expect(core.plots.some((p) => [56, 57, 58].includes(p.id))).toBe(false);
		expect(gen.facetOverrides).toEqual({});
		expect(panelsFor(gen).map((p) => p.unitKey)).toEqual(['y377#0', 'y375#0', 'y376#0']);
		expect(warnings()).toEqual([]);
	});

	it('a session without children loads untouched (no warning, same plot ids)', async () => {
		const s = fixture('facet-eda-children.json');
		s.plots = s.plots.filter((p) => p.facetParent == null);
		await importJson(s);
		expect(core.plots.map((p) => p.id)).toEqual([7, 8, 9, 10, 11]);
		expect(warnings()).toEqual([]);
	});
});
