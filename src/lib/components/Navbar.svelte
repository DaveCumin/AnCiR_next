<!-- TODO: fix setting dropdown position -->

<!-- Navbar.svelte -->
<script>
	// @ts-nocheck
	import { appState } from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';
	import Setting from './iconActions/Setting.svelte';

	let gearBtnRef;
	let showSetting = $state(false);
	let dropdownTop = $state(0);
	let dropdownLeft = $state(0);

	function recalculateDropdownPosition() {
		if (!gearBtnRef) return;
		const rect = gearBtnRef.getBoundingClientRect();

		dropdownTop = rect.top + window.scrollY;
		dropdownLeft = rect.right + window.scrollX + 12;
	}

	function openDropdown() {
		recalculateDropdownPosition();
		requestAnimationFrame(() => {
			showSetting = true;
		});
		window.addEventListener('resize', recalculateDropdownPosition);
	}

	function switchTab(tab) {
		appState.currentTab = tab;
	}
	
</script>

<nav class="container">
	<div class="icon-container">
		<button onclick={() => switchTab('data')}>
			<Icon
				name="table"
				className={appState.currentTab === 'data' ? 'icon active' : 'icon'}
			/>
			<!-- <TableIcon /> -->
		</button>

		<button onclick={() => switchTab('worksheet')}>
			<Icon
				name="layer"
				className={appState.currentTab === 'worksheet' ? 'icon active' : 'icon'}
			/>
			<!-- <WorksheetIcon /> -->
		</button>
	</div>

	<div class="icon-container">
		<button bind:this={gearBtnRef} onclick={openDropdown}>
			<Icon name="gear" />
		</button>
		<button>
			<Icon name="query" />
		</button>
	</div>
</nav>

{#if showSetting}
	<Setting bind:showDropdown={showSetting} dropdownTop={dropdownTop} dropdownLeft={dropdownLeft} />
{/if}

<style>
	.container {
		min-width: 56px;
		height: 100vh;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		align-items: center;

		background-color: white;

		position: fixed;
		top: 0;
		left: 0;

		border-right: 1px solid #d9d9d9;

		z-index: 1000;
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
