<script>
	// @ts-nocheck
	// A facet generator on the workspace (plan 1.5): one Draggable per PANEL, laid out on the
	// grid the panel derives from its generator. Nothing here is a plot: the panels are
	// views (core/facetPanels.svelte.js), never in core.plots, never saved. Dragging a panel
	// moves the generator by the same delta (Draggable resolves the owner), so the whole
	// grid follows; selection lives on the panel (`bind:selected`). The generator itself is
	// mounted once, headless, so its calculation and metric outputs stay live (see
	// FacetGeneratorCompute.svelte).
	import Draggable from '$lib/components/reusables/Draggable.svelte';
	import FacetPanelHost from '$lib/components/views/FacetPanelHost.svelte';
	import FacetGeneratorCompute from '$lib/components/views/FacetGeneratorCompute.svelte';
	import { appConsts } from '$lib/core/core.svelte.js';
	import { panelsFor } from '$lib/core/facetPanels.svelte.js';
	import { isZoomMode } from '$lib/plots/plotZoomMode.svelte.js';
	import ErrorBoundary from '$lib/components/reusables/ErrorBoundary.svelte';

	let { generator, viewportEl = null } = $props();

	const panels = $derived(panelsFor(generator));
	const PlotComp = $derived(appConsts.plotMap.get(generator?.type)?.plot ?? null);
</script>

<FacetGeneratorCompute {generator} />

{#each panels as panel (panel.id)}
	<FacetPanelHost {panel}>
		{#snippet children(panel)}
			<Draggable
				x={panel.x}
				y={panel.y}
				width={panel.width}
				height={panel.height}
				title={panel.name}
				titleEditable={false}
				id={panel.id}
				bind:selected={panel.selected}
				{viewportEl}
			>
				{#if PlotComp && panel.plot}
					<!-- One boundary per panel, inside the card so it can still be moved: a
					     panel that throws shows why and its siblings keep drawing (ROB-12). -->
					<ErrorBoundary
						context={`drawing the facet panel "${panel.name}"`}
						title="This panel couldn't be drawn."
					>
						<PlotComp
							theData={panel}
							which="plot"
							brushable={true}
							zoomMode={isZoomMode(panel.id)}
						/>
					</ErrorBoundary>
				{/if}
			</Draggable>
		{/snippet}
	</FacetPanelHost>
{/each}
