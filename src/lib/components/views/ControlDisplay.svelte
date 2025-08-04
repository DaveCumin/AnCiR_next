<!-- Handle click plot (plot id core state) -->
<script module>
	const toShow = { width: 'number', height: 'number', 'plot.data.*.*.refId': 'Column' };

	function filterPaths(paths) {
		// Helper function to check if a path matches a pattern
		function isMatch(path, pattern) {
			// Convert pattern to regex, escaping dots and replacing * with .*
			const regexPattern = '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
			return new RegExp(regexPattern).test(path);
		}

		// Filter paths based on toShow
		return paths.filter((item) => Object.keys(toShow).some((key) => isMatch(item.path, key)));
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

<script>
	// @ts-nocheck
	import Icon from '$lib/icons/Icon.svelte';
	import SavePlot from '$lib/components/iconActions/SavePlot.svelte';

	import { appConsts, appState, core } from '$lib/core/core.svelte';
	import { convertToImage } from '$lib/components/plotbits/helpers/save.svelte.js';
	import NumberWithUnits from '../inputs/NumberWithUnits.svelte';

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
		showSavePlot = true;

		window.addEventListener('resize', recalculateDropdownPosition);
	}

	// get the options that are the same for all selected plots
	function getSameOptions(selectedPlotIds) {
		if (selectedPlotIds.length < 2) return [];

		// Get all plot objects using $state.snapshot
		const plots = selectedPlotIds.map((id) => $state.snapshot(core.plots.find((p) => p.id === id)));

		// Compare all plots
		let options = compareJson(plots);

		// Filter paths
		options = filterPaths(options);

		return options;
	}

	let theSameOptions = $state();
	$effect(() => {
		theSameOptions = getSameOptions(appState.selectedPlotIds);
	});
	function updateOptions(samepath) {
		core.plots.forEach((plot) => {
			if (appState.selectedPlotIds.includes(plot.id)) {
				plot[samepath] = theSameOptions.filter((p) => p.path == samepath)[0].value;
			}
		});
	}
</script>

<div class="control-display">
	<!-- This is only for the first selected plot - need an #if to take care of multiple selections -->

	{#key appState.selectedPlotIds}
		{#if appState.selectedPlotIds.length > 1}
			<div class="control-banner">
				<p>Control Panel</p>

				<div class="control-banner-icons"></div>
			</div>
			<!-- TODO: after fix put in control-banner-icons -->
			<button class="icon" bind:this={addBtnRef} onclick={openDropdown}>
				<Icon name="disk" width={16} height={16} className="control-component-title-icon" />
			</button>

			<p>{appState.selectedPlotIds}</p>
			<p>{JSON.stringify(theSameOptions, null, 2)}</p>
			<!-- This may need to be layed out, like the others, with loops only for the data (that way, easier to set min/max input values and label appropriately -->
			{#each theSameOptions as same}
				{#if toShow[same.path] == 'number'}
					<p>
						{same.path}
						<NumberWithUnits
							bind:value={same.value}
							units={{}}
							onInput={() => updateOptions(same.path)}
						/>
					</p>
				{:else}
					<p>{same.path} {toShow[same.path]} {same.value}</p>
				{/if}
			{/each}
		{:else if appState.selectedPlotIds.length == 1}
			{@const plot = core.plots.find((p) => p.id === appState.selectedPlotIds[0])}
			{#if plot}
				{@const Plot = appConsts.plotMap.get(plot.type).plot ?? null}
				{#if Plot}
					<!-- <p>{core.plots.find((p) => p.id === appState.selectedPlotIds[0])?.name}</p>
					<p>
						{JSON.stringify(core.plots.find((p) => p.id === appState.selectedPlotIds[0])?.plot)}
					</p> -->

					<div class="control-banner">
						<p>{plot.name}</p>

						<div class="control-banner-icons">
							<button class="icon" bind:this={addBtnRef} onclick={openDropdown}>
								<Icon name="disk" width={16} height={16} className="control-component-title-icon" />
							</button>
						</div>
					</div>

					<SavePlot
						bind:showDropdown={showSavePlot}
						{dropdownTop}
						{dropdownLeft}
						Id={'plot' + plot.plot.parentBox.id}
					/>

					<div class="control-tag">
						<button
							class={appState.currentControlTab === 'properties' ? 'active' : ''}
							onclick={() => (appState.currentControlTab = 'properties')}>Properties</button
						>
						<button
							class={appState.currentControlTab === 'data' ? 'active' : ''}
							onclick={() => (appState.currentControlTab = 'data')}>Data</button
						>
					</div>

					<div class="div-line"></div>
					<Plot theData={plot.plot} which="controls" />
				{/if}
			{/if}
		{:else}
			<div class="control-banner">
				<p>Control Panel</p>
			</div>
			<p>Please select a plot or plots (with alt-click) to use the control panel.</p>
		{/if}
	{/key}

	<div class="div-block"></div>
</div>

<SavePlot
	bind:showDropdown={showSavePlot}
	{dropdownTop}
	{dropdownLeft}
	Id={appState.selectedPlotIds}
/>

<style>
	.heading {
		position: sticky;
		top: 0;
		width: 100%;
		/* height: 4vh; */
		display: flex;
		flex-direction: row;
		justify-content: center;
		align-items: center;
		background-color: white;
	}

	.heading p {
		margin-left: 0.6rem;
		/* font-weight: bold; */
	}

	.control-display {
		top: 0;
		width: calc(100% - 2rem);
		margin-left: 1rem;
	}
</style>
