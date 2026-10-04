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
	// See plots/plotMetricOutputs.svelte.js for the one-writer rule. It claims the generator in
	// the compute-owner registry, so NodeComputeHost (which covers a generator nobody shows,
	// e.g. hidden from the workspace) does not mount a second instance.
	import { appConsts } from '$lib/core/core.svelte.js';
	import { hasPlotMetrics } from '$lib/plots/plotMetricOutputs.svelte.js';
	import ComputeClaim from '$lib/components/views/ComputeClaim.svelte';
	import { computeKey } from '$lib/core/computeOwners.svelte.js';
	import ErrorBoundary from '$lib/components/reusables/ErrorBoundary.svelte';

	let { generator } = $props();

	const PlotComp = $derived(
		generator && hasPlotMetrics(generator.type)
			? (appConsts.plotMap.get(generator.type)?.plot ?? null)
			: null
	);
</script>

{#if PlotComp}
	<!-- Headless, so a failure here would otherwise unmount whatever hosts the panels
	     (the whole worksheet, or the canvas). Contained, it is reported once and the panels
	     still draw (ROB-12). -->
	<ErrorBoundary
		source="background"
		context={`calculating the ${generator.type} plot "${generator.name}"`}
	>
		<PlotComp theData={generator} which="compute" />
		<ComputeClaim computeKey={computeKey('plot', generator.id)} />
	</ErrorBoundary>
{/if}
