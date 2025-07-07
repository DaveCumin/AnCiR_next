<script>
    // @ts-nocheck
	import Draggable from '../reusables/Draggable.svelte';

	import { core, appConsts, appState } from '$lib/core/core.svelte.js';

    function findZIndex(id) {
        if (appState.selectedPlotId === id) {
            return 999;
        }
        return core.plots.length - id;
    }
</script>


{#each core.plots as plot, i (plot.id)}
    <Draggable
        bind:x={plot.x}
        bind:y={plot.y}
        bind:width={plot.width}
        bind:height={plot.height}
        title={plot.name}
        id={plot.id}
        zIndex={findZIndex(plot.id)}
    >
        {@const Plot = appConsts.plotMap.get(plot.type).plot ?? null}
        <Plot
            theData={plot}
            which="plot" />
    </Draggable>
{/each}

<style>
    
</style>