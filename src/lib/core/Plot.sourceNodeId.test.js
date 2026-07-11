import { describe, it, expect, beforeEach } from 'vitest';
import { appConsts } from '$lib/core/core.svelte.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { Plot } from '$lib/core/Plot.svelte';

beforeEach(async () => { appConsts.plotMap = await loadPlots(); });

describe('Plot sourceNodeId', () => {
	it('round-trips through toJSON/fromJSON', () => {
		const p = new Plot({ type: 'tableplot', sourceNodeId: 'tableprocess_7', plot: { columnRefs: [] } });
		expect(p.sourceNodeId).toBe('tableprocess_7');
		const back = Plot.fromJSON(p.toJSON());
		expect(back.sourceNodeId).toBe('tableprocess_7');
	});
	it('defaults to null when absent', () => {
		const p = new Plot({ type: 'tableplot', plot: { columnRefs: [] } });
		expect(p.sourceNodeId).toBeNull();
	});
});
