<script>
    // @ts-nocheck
	import Draggable from '../reusables/Draggable.svelte';

	import { core, appConsts } from '$lib/core/core.svelte.js';
</script>


{#each core.plots as plot (plot.id)}
    <Draggable
        bind:x={plot.x}
        bind:y={plot.y}
        bind:width={plot.width}
        bind:height={plot.height}
        title={plot.name}
        id={plot.id}
    >
        {@const Plot = appConsts.plotMap.get(plot.type).plot ?? null}
        <Plot
            theData={plot}
            which="plot" />
    </Draggable>
{/each}

<style>
    
</style>