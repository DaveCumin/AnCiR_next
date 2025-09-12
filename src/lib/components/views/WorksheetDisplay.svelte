<script>
	// @ts-nocheck

	import Icon from '$lib/icons/Icon.svelte';
	import AddPlot from '../iconActions/AddPlot.svelte';
	import SinglePlotAction from '../iconActions/SinglePlotAction.svelte';
	import SavePlot from '$lib/components/iconActions/SavePlot.svelte';

	import { appState, core } from '$lib/core/core.svelte.js';
	import { deselectAllPlots, selectAllPlots, selectPlot } from '$lib/core/Plot.svelte';

	let addBtnRef;
	let showAddPlot = $state(false);
	let dropdownTop = $state(0);
	let dropdownLeft = $state(0);
	let draggedIndex = $state(null);

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
	{#if core.plots.length > 1}
		<div class="clps-container">
			<details>
				<summary>
					<input
						type="checkbox"
						oninput={(e) => {
							if (e.target.checked) {
								selectAllPlots();
							} else {
								deselectAllPlots();
							}
						}}
					/>
				</summary>
			</details>
		</div>
		<hr />
	{/if}
	{#each core.plots.toReversed() as plot, i (plot.id)}
		<div class="clps-container">
			<details
				draggable="true"
				ondragstart={() => handleDragStart(i)}
				ondragover={handleDragOver}
				ondrop={() => handleDrop(i)}
				bind:open={openClps[plot.id]}
			>
				<summary
					class="clps-title-container"
					style="background-color: {plot.selected ? 'var(--color-lightness-95)' : ''};"
					onclick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						selectPlot(e, plot.id);
					}}
				>
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
						<p
							contenteditable="false"
							ondblclick={(e) => {
								e.target.setAttribute('contenteditable', 'true');
								e.target.focus();
							}}
							onfocusout={(e) => e.target.setAttribute('contenteditable', 'false')}
							bind:innerHTML={plot.name}
						></p>
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
		height: 2rem;
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
