<script>
	// @ts-nocheck
	// The host of ONE facet panel (plan 1.4 / 1.5). It exists to run the panel's projection
	// effect for as long as the panel is on screen: `usePanelProjection` tracks the
	// generator's inner and this panel's override, and rebuilds or mirrors the panel's
	// plot-class instance in a microtask. The markup is whatever the view puts around the
	// panel (a Draggable on the workspace, a grid cell in the node thumbnail); it is rendered
	// through the `children` snippet so both views share this one effect.
	import { usePanelProjection } from '$lib/core/facetPanels.svelte.js';

	let { panel, children } = $props();

	usePanelProjection(() => panel);
</script>

{@render children?.(panel)}
