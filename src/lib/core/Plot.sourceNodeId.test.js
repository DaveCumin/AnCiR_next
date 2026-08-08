import { describe, it, expect, beforeEach } from 'vitest';
import { appConsts } from '$lib/core/core.svelte.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { Plot } from '$lib/core/Plot.svelte';
import { PLOT_METRIC_DEFS } from '$lib/plots/plotMetricOutputs.svelte.js';

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

	it('round-trips the Q-Q plot metric columns (qq_r / qq_n)', () => {
		const p = new Plot({
			type: 'qqplot',
			metricOut: { qq_r: 45, qq_n: 46 },
			plot: { data: [] }
		});
		const back = Plot.fromJSON(p.toJSON());
		expect(back.metricOut).toEqual({ qq_r: 45, qq_n: 46 });
	});
});

describe('PLOT_METRIC_DEFS: qqplot', () => {
	it('declares qq_r and qq_n', () => {
		expect(PLOT_METRIC_DEFS.qqplot.keys).toEqual(['qq_r', 'qq_n']);
	});

	it("maps a series datum's qq derived to the metric keys", () => {
		const s = PLOT_METRIC_DEFS.qqplot.statsFor({ qq: { r: 0.994, n: 120, dropped: 3 } });
		expect(s).toEqual({ qq_r: 0.994, qq_n: 120 });
	});

	it('turns a null r (constant data / n < 3) into NaN for the column', () => {
		const s = PLOT_METRIC_DEFS.qqplot.statsFor({ qq: { r: null, n: 5, dropped: 0 } });
		expect(s.qq_r).toBeNaN();
		expect(s.qq_n).toBe(5);
	});

	it('handles a missing datum defensively', () => {
		const s = PLOT_METRIC_DEFS.qqplot.statsFor(undefined);
		expect(s.qq_r).toBeNaN();
		expect(s.qq_n).toBeNaN();
	});
});
