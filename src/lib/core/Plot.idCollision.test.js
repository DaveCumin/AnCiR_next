/**
 * Session load reserves the incoming plot ids so nothing minted mid-load can collide with a
 * plot still to be rebuilt.
 *
 * The load loop in Setting.svelte yields a frame between every plot so the compositor stays
 * responsive, and that yield lets Svelte effects run mid-import. Until v76.4 a FACETED plot's
 * reconcile effect spawned child plots through the same id allocator during that window, so a
 * child could be handed an id that a plot later in the same file already owned, and the
 * workspace rendered a keyed `{#each}` over two plots with the same id (`each_key_duplicate`).
 * The reported case was demo-workflow-stats-eda.json, whose plot 7 is a faceted histogram and
 * whose next plot owns id 8.
 *
 * Facets are views now, so no reconcile mints anything during a load. The allocator
 * assertions stay (plan 2026-09-26-facets-as-views, 0.2 and 5.11): `reservePlotIds` is the
 * backstop for any OTHER mid-load minting path, and the scenario below stands in for one by
 * constructing a plot by hand between the first and the rest.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { appConsts, core } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot, reservePlotIds } from '$lib/core/Plot.svelte';

beforeEach(async () => {
	appConsts.plotMap = await loadPlots();
	core.plots = [];
});

const hist = (id) => Plot.fromJSON({ id, type: 'histogram', plot: { data: [] } });

describe('plot id allocation across a session load', () => {
	it('does not hand a new plot an id that a not-yet-rebuilt plot owns', () => {
		const saved = [7, 8, 9, 10, 11];
		reservePlotIds(saved);

		// The first plot lands, then something mints a plot before the rest arrive (what the
		// facet reconcile did until v76.4).
		const parent = hist(7);
		const child = new Plot({ type: 'histogram', plot: { data: [] } });
		const rest = saved.slice(1).map(hist);

		const ids = [parent, child, ...rest].map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(saved).not.toContain(child.id);
	});

	it('also refuses an id a live plot already holds', () => {
		// Belt and braces for orderings reservation cannot see: if something is already in
		// core.plots under that id, the allocator must step over it rather than duplicate it.
		const existing = new Plot({ type: 'histogram', plot: { data: [] } });
		core.plots = [existing];
		// Wind the counter back to force a collision if the allocator does not check.
		reservePlotIds([]);
		const next = new Plot({ type: 'histogram', plot: { data: [] } });
		expect(next.id).not.toBe(existing.id);
	});

	it('reserving is monotonic, so a second load cannot rewind the counter', () => {
		reservePlotIds([50]);
		const a = new Plot({ type: 'histogram', plot: { data: [] } });
		expect(a.id).toBeGreaterThan(50);
		reservePlotIds([2]); // an older, smaller session opened afterwards
		const b = new Plot({ type: 'histogram', plot: { data: [] } });
		expect(b.id).toBeGreaterThan(a.id);
	});
});
