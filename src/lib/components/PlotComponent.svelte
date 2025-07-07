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
{/each}

<style>
    
</style>

