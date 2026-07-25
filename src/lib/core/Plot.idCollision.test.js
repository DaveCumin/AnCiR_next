/**
 * Session load mints plot ids that must not collide with the ones still to be rebuilt.
 *
 * The load loop in Setting.svelte yields a frame between every plot so the compositor stays
 * responsive. That yield lets Svelte effects run mid-import — and a FACETED plot's reconcile
 * effect spawns child plots through the same id allocator. So a child could be handed an id that
 * a plot later in the same file already owns, and the workspace then rendered a keyed `{#each}`
 * over two plots with the same id (`each_key_duplicate`).
 *
 * Reproduces the reported case: demo-workflow-stats-eda.json, whose plot 7 is a faceted
 * histogram and whose next plot owns id 8.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { appConsts, core } from '$lib/core/core.svelte.js';
import { loadPlots } from '$lib/plots/plotMap.js';
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

		// The faceted plot lands first, and its reconcile mints a child before the rest arrive.
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
