<script>
	// @ts-nocheck

	import Icon from '$lib/icons/Icon.svelte';
	import AddPlot from '../iconActions/AddPlot.svelte';
	import SinglePlotAction from '../iconActions/SinglePlotAction.svelte';
	import SavePlot from '$lib/components/iconActions/SavePlot.svelte';

	import { appState, core } from '$lib/core/core.svelte.js';
	import { deselectAllPlots, selectAllPlots, selectPlot } from '$lib/core/Plot.svelte';
	import Editable from '../inputs/Editable.svelte';

	let addBtnRef;
	let showAddPlot = $state(false);
	let dropdownTop = $state(0);
	let dropdownLeft = $state(0);
	let draggedIndex = $state(null);
	let draggedViewIndex = $state(null);
	let dragOverIdx = $state(null);

	let showSinglePlotDropdown = $state(false);
	let selectedPlot = $state(null);
	function openSinglePlotDropdown(e, id) {
		selectedPlot = id;
		setDropdownPositionFromEvent(e);
		showSinglePlotDropdown = true;
	}
	function setDropdownPositionFromEvent(e) {
		const rect = e.currentTarget.getBoundingClientRect();
		dropdownTop = rect.top + window.scrollY;
		dropdownLeft = rect.right + window.scrollX + 6;
	}

	function recalculateDropdownPosition() {
		if (!addBtnRef) return;
		const rect = addBtnRef.getBoundingClientRect();
		dropdownTop = rect.top + window.scrollY;
		dropdownLeft = rect.right + window.scrollX + 6;
	}

	function openDropdown() {
		recalculateDropdownPosition();
		requestAnimationFrame(() => (showAddPlot = true));
		window.addEventListener('resize', recalculateDropdownPosition);
	}

	function viewToModelIndex(i) {
		return core.plots.length - 1 - i;
	}

	//DRAG AND DROP
	function handleDragStart(e, i) {
		draggedViewIndex = i;
		draggedIndex = viewToModelIndex(i);
		e.dataTransfer.effectAllowed = 'move';
	}

	function handleDragOver(event, i) {
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		dragOverIdx = i;
	}

	function handleDrop(i) {
		if (draggedIndex === null) return;

		const targetIndex = viewToModelIndex(i);
		if (draggedIndex === targetIndex) {
			draggedIndex = null;
			draggedViewIndex = null;
			dragOverIdx = null;
			return;
		}

		const updated = [...core.plots];
		const [movedItem] = updated.splice(draggedIndex, 1);
		updated.splice(targetIndex, 0, movedItem);

		core.plots = updated;
		draggedIndex = null;
		draggedViewIndex = null;
		dragOverIdx = null;
	}

	function handleDragEnd() {
		draggedIndex = null;
		draggedViewIndex = null;
		dragOverIdx = null;
	}

	let openClps = $state({});

	let openMenus = $state({});
	function toggleMenu(id) {
		openMenus[id] = !openMenus[id];
	}

	function changePlotVisibility(id) {
		if (appState.invisiblePlotIds.includes(id)) {
			appState.invisiblePlotIds = appState.invisiblePlotIds.filter((plotId) => plotId !== id);
		} else {
			appState.invisiblePlotIds.push(id);
		}
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

<AddPlot bind:showDropdown={showAddPlot} {dropdownTop} {dropdownLeft} />

<div class="display-list">
	{#each core.plots.toReversed() as plot, i (plot.id)}
		<div
			class="clps-container"
			class:drag-over={dragOverIdx === i && draggedViewIndex !== i}
			draggable="true"
			ondragstart={(e) => handleDragStart(e, i)}
			ondragover={(e) => handleDragOver(e, i)}
			ondrop={() => handleDrop(i)}
			ondragend={handleDragEnd}
		>
			<details bind:open={openClps[plot.id]}>
				<summary
					class="clps-title-container"
					style="background-color: {plot.selected ? 'var(--color-lightness-95)' : ''};"
					onclick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						selectPlot(e, plot.id);
					}}
					onkeydown={(e) => {
						if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) e.preventDefault();
					}}
				>
					<div class="drag-handle" title="Drag to reorder">⠇</div>

					<div class="clps-title">
						<button
							class="icon"
							onclick={(e) => {
								e.stopPropagation();
								changePlotVisibility(plot.id);
							}}
						>
							{#if appState.invisiblePlotIds.includes(plot.id)}
								<Icon name="eye-slash" width={16} height={16} />
							{:else}
								<Icon name="eye" width={16} height={16} className="visible" />
							{/if}
						</button>
						<p><Editable bind:value={plot.name} /></p>
					</div>

					<div class="clps-title-button">
						<button
							class="icon"
							onclick={(e) => {
								e.stopPropagation();
								openSinglePlotDropdown(e, plot.id);
							}}
						>
							<Icon name="menu-horizontal-dots" width={20} height={20} className="menu-icon" />
						</button>

						<!-- {#if openClps[plot.id]}
							<Icon name="caret-down" width={20} height={20} className="static-icon" />
						{:else}
							<Icon name="caret-right" width={20} height={20} className="static-icon" />
						{/if} -->
					</div>
				</summary>
			</details>
		</div>
	{/each}
</div>

<SinglePlotAction
	bind:showDropdown={showSinglePlotDropdown}
	{dropdownTop}
	{dropdownLeft}
	plotId={selectedPlot}
/>

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

	.clps-title {
		flex: 1;
	}

	.drag-handle {
		cursor: grab;
		user-select: none;
		font-size: 12px;
		line-height: 1;
		color: var(--color-lightness-65, #aaa);
		padding: 0 0.1rem;
		opacity: 0;
		transition: opacity 0.15s ease;
	}

	.drag-handle:active {
		cursor: grabbing;
	}

	.clps-container:hover .drag-handle {
		opacity: 1;
	}

	.drag-over {
		border-top: 2px solid var(--color-lightness-35, #555);
	}
</style>
