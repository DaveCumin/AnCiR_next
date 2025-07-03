<script>
    // @ts-nocheck
	import Draggable from './reusables/Draggable.svelte';
	import { core, appConsts } from '$lib/core/core.svelte.js';
    import Box from './Box.svelte';
</script>

{#each core.plots as plot (plot.id)}
	<Draggable
        bind:x={plot.x}
        bind:y={plot.y}
        bind:width={plot.width}
        bind:height={plot.height}
        title={plot.name}
    >
    {@const Plot = appConsts.plotMap.get(plot.type).plot ?? null}
        <Plot
            theData={plot}
            which="plot" />
    </Draggable>

    <!-- <Box bind:plot overflow="none">
        <a style="position:absolute; top:-1.5em;">{plot.name}</a>
        <Plot bind:theData={plot} which="plot" />
    </Box> -->
{/each}

<style>
    
</style>

