<!-- ViewDisplay.svelte -->
<script>
	import { appState } from '$lib/core/theCore.svelte.js';
	import DataDisplay from '$lib/components/views/DataDisplay.svelte';
	import WorksheetDisplay from '$lib/components/views/WorksheetDisplay.svelte';
</script>

{#if appState.currentTab === 'data'}
	<DataDisplay />
{:else if appState.currentTab === 'worksheet'}
	<WorksheetDisplay />
{/if}
