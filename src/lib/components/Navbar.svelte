<!-- TODO: fix setting dropdown position -->

<!-- Navbar.svelte -->
<script>
	// @ts-nocheck
	import { appState } from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';
	import Setting from '$lib/components/iconActions/Setting.svelte';
	import About from './views/modals/About.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';

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
		showSetting = true;

		window.addEventListener('resize', recalculateDropdownPosition);
	}

	function toggleDataView() {
		// Data panel is independent of the canvas view — it can be open or
		// closed alongside either the plot canvas or the workflow canvas.
		if (appState.currentTab === 'data' && appState.showDisplayPanel) {
			appState.showDisplayPanel = false;
			appState.currentTab = null;
		} else {
			appState.showDisplayPanel = true;
			appState.currentTab = 'data';
		}
	}

	function selectWorksheetView() {
		// Worksheet view = plot canvas + worksheet layer panel. Clicking the
		// button when the worksheet panel is already open toggles the panel
		// off but leaves the plot canvas active.
		appState.view = 'plots';
		if (appState.currentTab === 'worksheet' && appState.showDisplayPanel) {
			appState.showDisplayPanel = false;
			appState.currentTab = null;
		} else {
			appState.currentTab = 'worksheet';
			appState.showDisplayPanel = true;
		}
	}

	function selectWorkflowView() {
		// Workflow view = workflow canvas. Close the worksheet panel if it
		// was open; leave a data panel alone since data is orthogonal.
		appState.view = 'canvas';
		if (appState.currentTab === 'worksheet') {
			appState.currentTab = null;
			appState.showDisplayPanel = false;
		}
	}
</script>

<nav class="container" style="width: {appState.widthNavBar}px;">
	<div class="icon-container">
		<button onclick={toggleDataView} {@attach tooltip('Data View')}>
			<Icon name="table" className={appState.currentTab === 'data' ? 'icon active' : 'icon'} />
		</button>

		<button onclick={selectWorksheetView} {@attach tooltip('Worksheet View')}>
			<Icon name="layer" className={appState.view === 'plots' ? 'icon active' : 'icon'} />
		</button>

		<button onclick={selectWorkflowView} {@attach tooltip('Workflow View')}>
			<Icon
				name="process"
				className={appState.view === 'canvas' ? 'icon active' : 'icon'}
			/>
		</button>
	</div>

	<div class="icon-container">
		<button bind:this={gearBtnRef} onclick={openDropdown} {@attach tooltip('Settings')}>
			<Icon name="gear" />
		</button>
		<button
			onclick={() => {
				showAbout = true;
			}}
			{@attach tooltip('About AnCiR')}
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
