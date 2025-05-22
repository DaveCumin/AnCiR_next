<!-- ViewDisplay.svelte -->
<script>
	import { app_state } from '$lib/core/theCore.svelte.js';
	import DataDisplay from '$lib/components/views/DataDisplay.svelte';
	import WorksheetDisplay from '$lib/components/views/WorksheetDisplay.svelte';
</script>

{#if app_state.current_tab === 'data'}
	<DataDisplay />
{:else if app_state.current_tab === 'worksheet'}
	<WorksheetDisplay />
{/if}
