<!-- Navbar.svelte -->
<script>
	import { appState } from '$lib/core/theCore.svelte.js';
	import Icon from '$lib/icon/Icon.svelte';

	function switchTab(tab) {
		appState.currentTab = tab;
		console.log('current tab:', tab);
	}
</script>

<nav class="container">
	<div class="icon-container">
		<button on:click={() => switchTab('data')}>
			<Icon
				name="table"
				style={appState.currentTab === 'data' ? 'fill: pink;' : 'fill: #D9D9D9;'}
			/>
			<!-- <TableIcon /> -->
		</button>

		<button on:click={() => switchTab('worksheet')}>
			<Icon
				name="layer"
				style={appState.currentTab === 'worksheet' ? 'fill: pink;' : 'fill: #D9D9D9;'}
			/>
			<!-- <WorksheetIcon /> -->
		</button>
	</div>

	<div class="icon-container">
		<button>
			<Icon name="gear" />
		</button>
		<button>
			<Icon name="query" />
		</button>
	</div>
</nav>

<style>
	.container {
		min-width: 48px;
		height: 100vh;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		align-items: center;

		position: fixed;
		top: 0;
		left: 0;

		border-right: 1px solid #d9d9d9;
	}

	.icon-container {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;

		margin-top: 24px;
		margin-bottom: 24px;
	}

	/* .icon-container :global(svg) {
        width: 24px;
        height: 24px;
        margin: 0.5rem;
    } */

	button {
		background-color: transparent;
		border: none;
		margin: 0.5rem;
		padding: 0;
		text-align: inherit;
		font: inherit;
		border-radius: 0;
		appearance: none;
	}
</style>
