<!-- TODO: fix setting dropdown position -->

<!-- Navbar.svelte -->
<script>
	// @ts-nocheck
	import { appState } from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';
	import Setting from '$lib/components/iconActions/Setting.svelte';
	import About from './views/modals/About.svelte';

	let gearBtnRef;
	let showSetting = $state(false);
	let dropdownTop = $state(0);
	let dropdownLeft = $state(0);
	let showAbout = $state(false);

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
		if (appState.currentTab == tab && appState.showDisplayPanel) {
			appState.showDisplayPanel = false;
			appState.currentTab = null;
		} else {
			appState.showDisplayPanel = true;
			appState.currentTab = tab;
		}
	}
</script>

<nav class="container" style="width: {appState.widthNavBar}px;">
	<div class="icon-container">
		<button onclick={() => switchTab('data')}>
			<Icon name="table" className={appState.currentTab === 'data' ? 'icon active' : 'icon'} />
			<!-- <TableIcon /> -->
		</button>

		<button onclick={() => switchTab('worksheet')}>
			<Icon name="layer" className={appState.currentTab === 'worksheet' ? 'icon active' : 'icon'} />
			<!-- <WorksheetIcon /> -->
		</button>
	</div>

	<div class="icon-container">
		<button bind:this={gearBtnRef} onclick={openDropdown}>
			<Icon name="gear" />
		</button>
		<button
			onclick={() => {
				showAbout = true;
			}}
		>
			<Icon name="query" />
		</button>
	</div>
</nav>

<Setting bind:showDropdown={showSetting} {dropdownTop} {dropdownLeft} />

<About bind:showModal={showAbout} />

<style>
	.container {
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
