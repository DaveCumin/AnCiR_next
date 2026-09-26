// @ts-nocheck
// The setFacetOverride op (plan 2026-09-26-facets-as-views, section 1.7): one path of one
// panel's override map, with an inverse that removes a first-time set and restores an
// overwritten value, so a per-panel edit is one undo step.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot } from '$lib/core/Plot.svelte';
import { applyOp } from '$lib/core/operations.js';
import { mutationService } from '$lib/core/mutationService.js';
import { history } from '$lib/core/opHistory.svelte.js';

beforeEach(async () => {
	appConsts.plotMap = await loadPlots();
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	history.init();
	history.clear();
});

function gen() {
	const p = new Plot({ type: 'scatterplot', facet: true, plot: { data: [] } });
	core.plots.push(p);
	return p;
}

describe('setFacetOverride', () => {
	it('sets a path, returns a removal as the inverse, and copies the array', () => {
		const g = gen();
		const value = [10, 40];
		const inv = applyOp({
			kind: 'setFacetOverride',
			id: g.id,
			unitKey: 'y1#0',
			path: 'ylimsLeftIN',
			value
		});
		expect(g.facetOverrides).toEqual({ 'y1#0': { ylimsLeftIN: [10, 40] } });
		expect(inv).toEqual({
			kind: 'setFacetOverride',
			id: g.id,
			unitKey: 'y1#0',
			path: 'ylimsLeftIN'
		});
		value[0] = 999;
		expect(g.facetOverrides['y1#0'].ylimsLeftIN).toEqual([10, 40]);
	});

	it('overwriting returns the previous value as the inverse', () => {
		const g = gen();
		mutationService.setFacetOverride(g.id, 'y1#0', 'ylimsLeftIN', [10, 40]);
		const inv = applyOp({
			kind: 'setFacetOverride',
			id: g.id,
			unitKey: 'y1#0',
			path: 'ylimsLeftIN',
			value: [0, 1]
		});
		expect(inv.value).toEqual([10, 40]);
		expect(g.facetOverrides['y1#0'].ylimsLeftIN).toEqual([0, 1]);
	});

	it('an undefined value removes the path and drops an empty unit entry', () => {
		const g = gen();
		mutationService.setFacetOverride(g.id, 'y1#0', 'ylimsLeftIN', [10, 40]);
		mutationService.setFacetOverride(g.id, 'y1#0', 'xlimsIN', [1, 2]);
		mutationService.setFacetOverride(g.id, 'y1#0', 'xlimsIN', undefined);
		expect(g.facetOverrides).toEqual({ 'y1#0': { ylimsLeftIN: [10, 40] } });
		mutationService.setFacetOverride(g.id, 'y1#0', 'ylimsLeftIN', undefined);
		expect(g.facetOverrides).toEqual({});
	});

	it('is a no-op (null inverse, nothing recorded) when the value is unchanged, the path is absent, or the plot is missing', () => {
		const g = gen();
		mutationService.setFacetOverride(g.id, 'y1#0', 'ylimsLeftIN', [10, 40]);
		expect(history.undoStack).toHaveLength(1);
		expect(
			applyOp({
				kind: 'setFacetOverride',
				id: g.id,
				unitKey: 'y1#0',
				path: 'ylimsLeftIN',
				value: [10, 40]
			})
		).toBeNull();
		expect(
			applyOp({ kind: 'setFacetOverride', id: g.id, unitKey: 'y9#0', path: 'xlimsIN' })
		).toBeNull();
		expect(
			applyOp({
				kind: 'setFacetOverride',
				id: g.id + 1000,
				unitKey: 'y1#0',
				path: 'xlimsIN',
				value: [1, 2]
			})
		).toBeNull();
		expect(history.undoStack).toHaveLength(1);
	});

	it('undo and redo round-trip through the history', () => {
		const g = gen();
		mutationService.setFacetOverride(g.id, 'y1#0', 'ylimsLeftIN', [10, 40]);
		mutationService.setFacetOverride(g.id, 'y1#0', 'ylimsLeftIN', [0, 1]);
		history.undo();
		expect(g.facetOverrides).toEqual({ 'y1#0': { ylimsLeftIN: [10, 40] } });
		history.undo();
		expect(g.facetOverrides).toEqual({});
		history.redo();
		expect(g.facetOverrides).toEqual({ 'y1#0': { ylimsLeftIN: [10, 40] } });
	});
});
