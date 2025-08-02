<script>
	// @ts-nocheck

	import { core } from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';
	import AddPlot from '../iconActions/AddPlot.svelte';

	let addBtnRef;
	let showAddPlot = $state(false);
	let dropdownTop = $state(0);
	let dropdownLeft = $state(0);
	let draggedIndex = $state(null);

	function recalculateDropdownPosition() {
		if (!addBtnRef) return;
		const rect = addBtnRef.getBoundingClientRect();
		dropdownTop = rect.top + window.scrollY;
		dropdownLeft = rect.right + window.scrollX + 12;
	}

	function openDropdown() {
		recalculateDropdownPosition();
		requestAnimationFrame(() => (showAddPlot = true));
		window.addEventListener('resize', recalculateDropdownPosition);
	}

	function viewToModelIndex(i) {
		return core.plots.length - 1 - i;
	}

	function handleDragStart(i) {
		draggedIndex = viewToModelIndex(i);
	}

	function handleDragOver(event) {
		event.preventDefault();
	}

	function handleDrop(i) {
		if (draggedIndex === null) return;

		const targetIndex = viewToModelIndex(i);
		if (draggedIndex === targetIndex) {
			draggedIndex = null;
			return;
		}

		const updated = [...core.plots];
		const [movedItem] = updated.splice(draggedIndex, 1);
		updated.splice(targetIndex, 0, movedItem);

		core.plots = updated;
		draggedIndex = null;
	}

	let openClps = $state({});
	function toggleClps(id) {
		openClps[id] = !openClps[id];
	}

	let openMenus = $state({});
	function toggleMenu(id) {
		openMenus[id] = !openMenus[id];
	}
</script>

<div class="heading">
	<p>Worksheet Layers</p>

	<div class="add">
		<button class="icon" bind:this={addBtnRef} onclick={openDropdown}>
			<Icon name="add" width={16} height={16} />
		</button>
	</div>
</div>

{#if showAddPlot}
	<AddPlot bind:showDropdown={showAddPlot} {dropdownTop} {dropdownLeft} />
{/if}

<div class="display-list">
	{#each core.plots.toReversed() as plot, i (plot.id)}
	<div class="clps-container">
		<details
			draggable="true"
			ondragstart={() => handleDragStart(i)}
			ondragover={handleDragOver}
			ondrop={() => handleDrop(i)}
		>
			<summary
				class="clps-title-container"
				onclick={(e) => {
					e.stopPropagation();
					toggleClps(plot.id);
				}}
			>
				<div class="clps-title">
					<p>{plot.name}</p>
				</div>
				
				<div class="clps-title-button">
					<button class="icon" onclick={(e) => {
						e.stopPropagation();
						toggleMenu(plot.id)
					}}>
						<Icon name="menu-horizontal-dots" width={20} height={20} className="menu-icon"/>
					</button>
					{#if openClps[plot.id]}
						<Icon name="caret-down" width={20} height={20} className="static-icon" />
					{:else}
						<Icon name="caret-right" width={20} height={20} className="static-icon" />
					{/if}
				</div>
				
			</summary>
		</details>
	</div>
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

		border-bottom: 1px solid var(--color-lightness-85);
		background-color: white;
	}

	.heading p {
		margin-left: 0.75rem;
		font-weight: bold;
	}

	.heading button {
		margin-right: 0.65rem;
	}

	.display-list {
		width: 100%;
		margin-top: 0.25rem;
	}

	details {
		margin: 0.25rem 0.5rem 0.25rem 0.75rem;
		padding: 0;
	}

	summary {
		list-style: none;

		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;

		margin: 0;
		padding: 0;
	}

	summary p {
		margin: 0;
		padding: 0;
	}

	summary button {
		margin: 0;
		padding: 0;
	}
</style>
