<script>
	// @ts-nocheck
	// The headless instance of a facet GENERATOR's plot component: mounted once per
	// generator by whatever hosts its panels (FacetGroup on the workspace, EmbeddedPlot on
	// the canvas), never once per panel. A faceted generator is not on screen, only its
	// derived panels are, and panels carry no metric outputs; so without this instance
	// nothing would run the generator's calculation and metric effects, and its output ports
	// (peak_period, ...) would silently keep their last unfaceted values.
	//
	// `which="compute"` runs those effects and renders nothing (every plot template draws
	// only for 'plot' or 'controls'). Only plot types with metric outputs are mounted: the
	// others have nothing a headless instance could keep current.
	// See plots/plotMetricOutputs.svelte.js for the one-writer rule.
	import { appConsts } from '$lib/core/core.svelte.js';
	import { hasPlotMetrics } from '$lib/plots/plotMetricOutputs.svelte.js';

	let { generator } = $props();

	const PlotComp = $derived(
		generator && hasPlotMetrics(generator.type)
			? (appConsts.plotMap.get(generator.type)?.plot ?? null)
			: null
	);
</script>

{#if PlotComp}
	<PlotComp theData={generator} which="compute" />
{/if}
