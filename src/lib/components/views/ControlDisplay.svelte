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
	const theSameOptions = $derived.by(() => {
		// Get all plot objects using $state.snapshot
		const plots = $state.snapshot(core.plots.filter((p) => p.selected));
		console.log('plots: ', plots);

		// Compare all plots
		let options = compareJson(plots);
		console.log('options: ', options);

		// Filter paths
		options = filterPaths(options);
		console.log('filtered', options);
		return options;
	});

	function updateOptions(samepath) {
		core.plots.forEach((plot) => {
			if (plot.selected) {
				plot[samepath] = theSameOptions.filter((p) => p.path == samepath)[0].value;
			}
		});
	}
</script>

<div class="control-display">
	<!-- This is only for the first selected plot - need an #if to take care of multiple selections -->

	{#if core.plots.filter((p) => p.selected).length > 1}
		<div class="control-banner">
			<p>Multiple plots selected</p>

			<div class="control-banner-icons">
				<button class="icon" bind:this={addBtnRef} onclick={openDropdown}>
					<Icon name="disk" width={16} height={16} className="control-component-title-icon" />
				</button>
			</div>
		</div>

		<p>
			{core.plots
				.filter((p) => p.selected)
				.map((p) => p.id)
				.join(', ')}
		</p>
		<p>{JSON.stringify(theSameOptions, null, 2)}</p>
		<!-- This may need to be layed out, like the others, with loops only for the data (that way, easier to set min/max input values and label appropriately -->
		{#each theSameOptions as same}
			{#if toShow[same.path] == 'number'}
				<p>
					{same.path}
					<NumberWithUnits
						bind:value={same.value}
						step={appState.gridSize}
						units={{}}
						onInput={() => updateOptions(same.path)}
					/>
				</p>
			{:else}
				<p>{same.path} {toShow[same.path]} {same.value}</p>
			{/if}
		{/each}
	{:else if core.plots.filter((p) => p.selected).length == 1}
		{@const plot = core.plots.filter((p) => p.selected)[0]}
		{#if plot}
			{@const Plot = appConsts.plotMap.get(plot.type).plot ?? null}
			{#if Plot}
				<div class="control-banner">
					<p
						contenteditable="false"
						ondblclick={(e) => {
							e.target.setAttribute('contenteditable', 'true');
							e.target.focus();
						}}
						onfocusout={(e) => e.target.setAttribute('contenteditable', 'false')}
						bind:innerHTML={plot.name}
					></p>

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

				<Plot theData={plot.plot} which="controls" />
			{/if}
		{/if}
	{:else}
		<div class="control-banner">
			<p>Control Panel</p>
		</div>
		<p>Please select a plot or plots (with alt-click) to use the control panel.</p>
	{/if}

	<div class="div-block"></div>
</div>

<SavePlot
	bind:showDropdown={showSavePlot}
	{dropdownTop}
	{dropdownLeft}
	Id={core.plots.filter((p) => p.selected)}
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
