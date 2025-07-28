<!-- Handle click plot (plot id core state) -->
<script module>
	export function closeControlPanel() {
		appState.selectedPlotIds = [];
		appState.showControlPanel = false;
	}
</script>

<script>
	// @ts-nocheck
	import Icon from '$lib/icons/Icon.svelte';
	import SavePlot from '$lib/components/iconActions/SavePlot.svelte';
	import { appConsts, appState, core } from '$lib/core/core.svelte';

	let addBtnRef;
	let showSavePlot = $state(false);
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
			showSavePlot = true;
		});
		window.addEventListener('resize', recalculateDropdownPosition);
	}

	// get the options that are the same for all selected plots
	function getSameOptions(selectedPlotIds) {
		if (selectedPlotIds.length < 2) return [];

		// Get all plot objects using $state.snapshot
		const plots = selectedPlotIds.map((id) => $state.snapshot(core.plots.find((p) => p.id === id)));

		// Compare all plots
		const options = compareJson(plots);
		console.log('OPTIONS: ', options);

		//TODO: I think we need a manual list to check against and show only those that are on that (to avoid exposing things like the GUIDs)

		return options;
	}

	function compareJson(jsonArray) {
		const matches = [];

		// Helper function to get all keys, including private ones
		function getKeys(obj) {
			if (typeof obj.getAllFields === 'function') {
				return Object.keys(obj.getAllFields());
			}
			return Object.keys(obj);
		}

		// Helper function to get value, handling private fields
		function getValue(obj, key) {
			if (typeof obj.getAllFields === 'function') {
				return obj.getAllFields()[key];
			}
			return obj[key];
		}

		// Helper function to recursively compare objects
		function compare(objects, path = '') {
			// Ensure all inputs are objects
			if (objects.some((obj) => !obj || typeof obj !== 'object')) {
				return;
			}

			// Get keys from all objects
			const keySets = objects.map((obj) => new Set(getKeys(obj)));
			// Find common keys (intersection of all key sets)
			const commonKeys = [...keySets[0]].filter((key) => keySets.every((set) => set.has(key)));

			for (const key of commonKeys) {
				const newPath = path ? `${path}.${key}` : key;

				// Get values for the key from all objects
				const values = objects.map((obj) => getValue(obj, key));

				// Check if values are objects (not arrays) for recursion
				if (values.every((val) => typeof val === 'object')) {
					compare(values, newPath);
				} else {
					// Check if all values are equal (using deep comparison for arrays)
					const areEqual = values.every(
						(val, i, arr) => JSON.stringify(val) === JSON.stringify(arr[0])
					);

					// Store the common value or null
					matches.push({
						path: newPath,
						value: areEqual ? values[0] : null
					});
				}
			}
		}

		compare(jsonArray);
		return matches;
	}
</script>

<div class="heading">
	<p>Control Panel</p>

	<div class="add">
		<button onclick={closeControlPanel}>
			<Icon name="close" width={16} height={16} className="close" />
		</button>
	</div>
</div>

<div class="control-display">
	<!-- This is only for the first selected plot - need an #if to take care of multiple selections -->

	{#key appState.selectedPlotIds}
		{#if appState.selectedPlotIds.length > 1}
			<p>{appState.selectedPlotIds}</p>
			<p>{JSON.stringify(getSameOptions(appState.selectedPlotIds), null, 2)}</p>
			<div><button bind:this={addBtnRef} onclick={openDropdown}>Save</button></div>
		{/if}
		{#if appState.selectedPlotIds.length == 1}
			{@const plot = core.plots.find((p) => p.id === appState.selectedPlotIds[0])}
			{#if plot}
				{@const Plot = appConsts.plotMap.get(plot.type).plot ?? null}
				{#if Plot}
					<Plot theData={plot.plot} which="controls" />
				{/if}
			{/if}
		{/if}
	{/key}
</div>
{#if showSavePlot}
	<SavePlot
		bind:showDropdown={showSavePlot}
		{dropdownTop}
		{dropdownLeft}
		Id={appState.selectedPlotIds}
	/>
{/if}

<style>
	.heading {
		position: sticky;
		top: 0;
		width: 100%;
		height: 4vh;
		display: flex;
		flex-direction: row;
		justify-content: center;
		align-items: center;
		/* border-bottom: 1px solid #d9d9d9; */
		background-color: white;
	}

	.heading p {
		margin-left: 0.6rem;
		/* font-weight: bold; */
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

	.control-display {
		margin-left: 1rem;
		margin-right: 1rem;
	}
</style>
