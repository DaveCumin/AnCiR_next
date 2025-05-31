<!-- ViewDisplay.svelte -->
<script>
	import { appState } from '$lib/core/theCore.svelte.js';
	import DataDisplay from '$lib/components/views/DataDisplay.svelte';
	import WorksheetDisplay from '$lib/components/views/WorksheetDisplay.svelte';
</script>

<div class="view-container">
	{#if appState.currentTab === 'data'}
		<DataDisplay />
	{:else if appState.currentTab === 'worksheet'}
		<WorksheetDisplay />
	{/if}
</div>

<style>
	.view-container {
		z-index: -1;
		overflow-y: auto;
		min-width: 300px;
		width: 20vw;
		height: 100%;
		display: flex;
		flex-direction: column;
		justify-content: start;
		align-items: start;

		position: fixed;
		top: 0;
		left: 56px;

		border-right: 1px solid #d9d9d9;
	}

	.view-container::-webkit-scrollbar {
		display: none; /* Chrome, Safari */
	}

</style>
