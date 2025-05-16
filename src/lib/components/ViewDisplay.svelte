<!-- ViewDisplay.svelte -->
<script>
    import { currentState } from '$lib/store.svelte';
    import DataDisplay from '$lib/components/views/DataDisplay.svelte';
    import WorksheetDisplay from '$lib/components/views/WorksheetDisplay.svelte';

</script>

{#if currentState.tab === 'data'}
	<DataDisplay />
{:else if currentState.tab === 'worksheet'}
	<WorksheetDisplay />
{/if}
