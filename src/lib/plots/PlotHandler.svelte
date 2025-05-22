<script module>
	import { core } from '$lib/core/theCore.svelte.js';
	import { Plot } from '$lib/core/Plot.svelte.js';
</script>

{#each core.plots as plot, i}
	<p>{plot.type}</p>
	<div class="box" style={`transform:translate(${plot.x},${plot.y})`}>
		<svelte:component this={Plot.processFuncMap.get(plot.type).plot} theData={plot.plot} />
	</div>
{/each}
