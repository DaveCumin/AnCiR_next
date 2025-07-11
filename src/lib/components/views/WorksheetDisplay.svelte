<script>
	// @ts-nocheck

	import { core } from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';
	import AddPlot from '$lib/components/iconActions/AddPlot.svelte';

	let addBtnRef;
	let showAddPlot = $state(false);
	let dropdownTop = $state(0);
	let dropdownLeft = $state(0);

	function recalculateDropdownPosition() {
		if (!addBtnRef) return;
		const rect = addBtnRef.getBoundingClientRect();

		dropdownTop = rect.top + window.scrollY;
		dropdownLeft = rect.right + window.scrollX + 12;
	}

	function openDropdown() {
		recalculateDropdownPosition();
		requestAnimationFrame(() => {
			showAddPlot = true;
		});
		window.addEventListener('resize', recalculateDropdownPosition);
	}
</script>

<div class="heading">
	<p>Worksheet Layers</p>

	<div class="add">
		<button bind:this={addBtnRef} onclick={openDropdown}>
			<Icon name="add" width={16} height={16} />
		</button>
	</div>
</div>

{#if showAddPlot}
	<AddPlot bind:showDropdown={showAddPlot} {dropdownTop} {dropdownLeft} />
{/if}

<div class="display-list">
	{#each core.plots.toReversed() as plot (plot.id)}
		<details>
			<summary>{plot.name}</summary>
		</details>
	{/each}
</div>

<style>
	.heading {
		position: sticky;
		top: 0;

		width: 100%;
		height: 4vh;
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		align-items: center;

		border-bottom: 1px solid #d9d9d9;
		background-color: white;
	}

	.heading p {
		margin-left: 1rem;
		font-weight: bold;
	}

	button {
		background-color: transparent;
		border: none;
		margin-right: 0.6rem;
		padding: 0;
		text-align: inherit;
		font: inherit;
		border-radius: 0;
		appearance: none;
		display: flex;
		justify-content: center;
		align-items: center;
	}

	.display-list {
		width: 100%;
		margin-top: 0.5rem;
	}
</style>
