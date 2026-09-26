// @ts-nocheck
// `facetOverrides` on the Plot wrapper (plan 2026-09-26-facets-as-views, section 1.6):
// persisted only when non-empty (the shipped demo JSONs stay byte-identical), read back
// with the shape guard. The wrong-shape matrix (a bad map loads as {} with one load warning)
// lives with the other fromJSON robustness cases in plots/plotFromJSONRobustness.test.js.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot } from '$lib/core/Plot.svelte';
import { notifications } from '$lib/core/notifications.svelte.js';

beforeEach(async () => {
	appConsts.plotMap = await loadPlots();
	core.plots = [];
	notifications.list.length = 0;
});

describe('Plot.facetOverrides', () => {
	it('defaults to {} and is left out of toJSON while empty', () => {
		const p = new Plot({ type: 'scatterplot', plot: { data: [] } });
		expect(p.facetOverrides).toEqual({});
		expect('facetOverrides' in p.toJSON()).toBe(false);
	});

	it('round-trips through toJSON / fromJSON once set', () => {
		const p = new Plot({ type: 'scatterplot', facet: true, plot: { data: [] } });
		p.facetOverrides = { 'y1#0': { ylimsLeftIN: [10, 40] } };
		const json = JSON.parse(JSON.stringify(p.toJSON()));
		expect(json.facetOverrides).toEqual({ 'y1#0': { ylimsLeftIN: [10, 40] } });
		const back = Plot.fromJSON(json);
		expect(back.facetOverrides).toEqual({ 'y1#0': { ylimsLeftIN: [10, 40] } });
		// A copy, not the JSON's own array.
		json.facetOverrides['y1#0'].ylimsLeftIN[0] = 999;
		expect(back.facetOverrides['y1#0'].ylimsLeftIN[0]).toBe(10);
	});

	it('a missing map is {} with no warning', () => {
		Plot.fromJSON({ id: 5, name: 'Dist', type: 'histogram', plot: { data: [] } });
		expect(notifications.list).toHaveLength(0);
	});
});
