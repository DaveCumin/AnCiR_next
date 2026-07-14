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

describe('Plot metricOut', () => {
	// Regression: fromJSON dropped metricOut, so on session load a plot's metric
	// columns (peak_period etc) lost their owner and re-appeared as standalone
	// data nodes instead of the plot's output ports.
	it('round-trips the metric-column map through toJSON/fromJSON', () => {
		const p = new Plot({
			type: 'periodogram',
			metricOut: { peak_period: 45, peak_power: 46, peak_pvalue: 47 },
			plot: { data: [] }
		});
		const back = Plot.fromJSON(p.toJSON());
		expect(back.metricOut).toEqual({ peak_period: 45, peak_power: 46, peak_pvalue: 47 });
	});
	it('defaults to an empty object when absent', () => {
		const back = Plot.fromJSON(new Plot({ type: 'periodogram', plot: { data: [] } }).toJSON());
		expect(back.metricOut).toEqual({});
	});
});
