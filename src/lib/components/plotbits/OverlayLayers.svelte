<script>
	// One overlay layer of a host plot (overlays plan 2026-10-15): `layer="bands"` goes BENEATH
	// the series and `layer="lines"` ABOVE them, a fixed draw order every host keeps by placing
	// the two layers around its own marks. Overlay.svelte's plot snippet decides what an enabled
	// overlay draws; geometry() is empty for anything the overlay's warning says cannot be drawn.
	import Overlay from './Overlay.svelte';

	let {
		/** the host plot's inner data object (see overlayHost.js) */
		inner,
		/** 'bands' | 'lines' */
		layer
	} = $props();
</script>

{#if layer === 'bands'}
	<g class="overlay-bands-layer">
		{#each inner.overlays as overlay (overlay.id)}
			{#if overlay.kind === 'band' && overlay.enabled}
				<Overlay {overlay} {inner} which="plot" />
			{/if}
		{/each}
	</g>
{:else if layer === 'lines'}
	<g class="overlay-lines-layer">
		{#each inner.overlays as overlay (overlay.id)}
			{#if overlay.kind === 'line' && overlay.enabled}
				<Overlay {overlay} {inner} which="plot" />
			{/if}
		{/each}
	</g>
{/if}
