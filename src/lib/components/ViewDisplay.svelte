<!-- ViewDisplay.svelte -->
<script>
    import { currentTab } from '$lib/store.svelte';
    import DataDisplay from '$lib/components/views/DataDisplay.svelte';
    import WorksheetDisplay from '$lib/components/views/WorksheetDisplay.svelte';

</script>

{#if currentTab.tab === 'data'}
	<DataDisplay />
{:else if currentTab.tab === 'worksheet'}
	<WorksheetDisplay />
{/if}
