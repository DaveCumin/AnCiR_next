<script>
    // @ts-nocheck
    import { appState } from "$lib/core/core.svelte";

    import PlotDisplay from "./views/PlotDisplay.svelte";

    

</script>

<div class="plot-panel">
    <PlotDisplay />
</div>

<style>
    .plot-panel {
        overflow: auto;
    }
</style>



