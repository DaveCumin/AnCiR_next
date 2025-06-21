<!-- Navbar.svelte -->
<script>
	import { appState } from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';

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
				className={appState.currentTab === 'data' ? 'icon active' : 'icon'}
			/>
			<!-- <TableIcon /> -->
		</button>

		<button on:click={() => switchTab('worksheet')}>
			<Icon
				name="layer"
				className={appState.currentTab === 'worksheet' ? 'icon active' : 'icon'}
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
		min-width: 56px;
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

		margin-top: 28px;
		margin-bottom: 28px;
	}


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
