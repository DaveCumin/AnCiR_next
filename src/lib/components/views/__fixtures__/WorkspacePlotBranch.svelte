<script>
	// @ts-nocheck
	// Test fixture: the one branch of PlotDisplay.svelte that decides what a plot mounts on
	// the workspace (a facet generator mounts a FacetGroup, anything else its own plot
	// component), without the rest of the worksheet. Lets a test toggle `facet` and watch
	// the workspace swap between the two, as the real view does.
	import FacetGroup from '$lib/components/views/FacetGroup.svelte';
	import { appConsts } from '$lib/core/core.svelte.js';

	let { plot } = $props();
	const PlotComp = $derived(appConsts.plotMap.get(plot?.type)?.plot ?? null);
</script>

{#if plot.facet}
	<FacetGroup generator={plot} />
{:else if PlotComp}
	<PlotComp theData={plot} which="plot" />
{/if}
