<!-- Handle click plot (plot id core state) -->
<script module>
	export function dataSettingsScrollTo(position = 'bottom') {
		const dataSettings = document.getElementsByClassName('control-display')[0].parentElement;
		const topPos =
			position == 'bottom' ? dataSettings.scrollHeight : position == 'top' ? 0 : position;
		if (dataSettings) {
			dataSettings.scrollTo({
				top: topPos,
				left: 0,
				behavior: 'smooth'
			});
		} else {
			console.error("Element with ID 'dataSettings' not found");
		}
	}

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

	import { appConsts, appState, core, snapToGrid } from '$lib/core/core.svelte';
	import NumberWithUnits from '../inputs/NumberWithUnits.svelte';
	import { select } from 'd3-selection';
	import { selectPlot, removePlots, getPlotById } from '$lib/core/Plot.svelte';
	import Editable from '../inputs/Editable.svelte';

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
		console.log('updating...');
		const val = $state.snapshot(theSameOptions.filter((p) => p.path == samepath)[0].value);
		core.plots.forEach((plot) => {
			console.log('ap: ', plot.id);
			if (plot.selected) {
				console.log('p ', plot.id);
				console.log('s ', samepath);
				console.log('val ', val);
				plot[samepath] = val;
			}
		});
	}

	function alignPlots(by) {
		//get the selected plots
		if (selectedPlots.length < 2) return;

		// Compute boundaries in one pass
		const boundaries = selectedPlots.reduce(
			(b, p) => ({
				top: Math.min(b.top, p.y),
				bottom: Math.max(b.bottom, p.y + p.height),
				left: Math.min(b.left, p.x),
				right: Math.max(b.right, p.x + p.width)
			}),
			{
				top: Infinity,
				bottom: -Infinity,
				left: Infinity,
				right: -Infinity
			}
		);

		// Compute middle and center for alignment
		boundaries.middle = (boundaries.top + boundaries.bottom) / 2;
		boundaries.center = (boundaries.left + boundaries.right) / 2;

		// Map plots to new positions based on 'by'
		core.plots.forEach((plot) => {
			if (plot.selected) {
				let newX = plot.x,
					newY = plot.y;

				switch (by) {
					case 'top':
						newY = boundaries.top;
						break;
					case 'middle':
						newY = Math.round(boundaries.middle - plot.height / 2);
						break;
					case 'bottom':
						newY = boundaries.bottom - plot.height;
						break;
					case 'left':
						newX = boundaries.left;
						break;
					case 'center':
						newX = Math.round(boundaries.center - plot.width / 2);
						break;
					case 'right':
						newX = boundaries.right - plot.width;
						break;
				}

				//update the plot
				plot.x = snapToGrid(newX);
				plot.y = snapToGrid(newY);
			}
		});
	}

	function getGap(by) {
		let gap = null;
		if (by == 'horizontal') {
			const sortedPlots = [...selectedPlots].sort((a, b) => a.x - b.x);
			const sortedPlotIds = sortedPlots.map((p) => p.id);
			const minX = Math.min(...sortedPlots.map((p) => p.x));
			const maxX = Math.max(...sortedPlots.map((p) => p.x + p.width + 25)); // need to add the 25 that makes up a bit of a margin
			const totalWidth = sortedPlots.reduce((sum, p) => sum + p.width + 25, 0);
			gap = snapToGrid(
				sortedPlots.length > 1 ? (maxX - minX - totalWidth) / (sortedPlots.length - 1) : 0
			);
		}

		if (by == 'vertical') {
			const sortedPlots = [...selectedPlots].sort((a, b) => a.y - b.y);
			const sortedPlotIds = sortedPlots.map((p) => p.id);
			const minY = Math.min(...sortedPlots.map((p) => p.y));
			const maxY = Math.max(...sortedPlots.map((p) => p.y + p.height + 50)); // need to add the 50 that makes up a bit of a margin and accounts for the header bar
			const totalHeight = sortedPlots.reduce((sum, p) => sum + p.height + 50, 0);
			gap = snapToGrid(
				sortedPlots.length > 1 ? (maxY - minY - totalHeight) / (sortedPlots.length - 1) : 0
			);
		}

		return gap;
	}
	function distributePlots(by, spacingIN = null) {
		if (selectedPlots.length < 2) return;

		// Handle distributions
		if (by === 'horizontalEqual') {
			//do calcs
			const sortedPlots = [...selectedPlots].sort((a, b) => a.x - b.x);
			const sortedPlotIds = sortedPlots.map((p) => p.id);
			const minX = Math.min(...sortedPlots.map((p) => p.x));
			if (spacingIN == null) {
				const maxX = Math.max(...sortedPlots.map((p) => p.x + p.width + 25));
				const totalWidth = sortedPlots.reduce((sum, p) => sum + p.width + 25, 0);
				spacingIN = snapToGrid(
					sortedPlots.length > 1 ? (maxX - minX - totalWidth) / (sortedPlots.length - 1) : 0
				);
			}

			console.log('spacing: ', spacingIN);
			//now distribute
			let currentX = minX;
			sortedPlotIds.forEach((id) => {
				getPlotById(id).x = snapToGrid(Math.max(0, currentX));
				currentX += getPlotById(id).width + 25 + spacingIN;
			});
		}

		if (by === 'verticalEqual') {
			const sortedPlots = [...selectedPlots].sort((a, b) => a.y - b.y);
			const sortedPlotIds = sortedPlots.map((p) => p.id);
			const minY = Math.min(...sortedPlots.map((p) => p.y));
			if (spacingIN == null) {
				const maxY = Math.max(...sortedPlots.map((p) => p.y + p.height + 50));
				const totalHeight = sortedPlots.reduce((sum, p) => sum + p.height + 50, 0);
				spacingIN = snapToGrid(
					sortedPlots.length > 1 ? (maxY - minY - totalHeight) / (sortedPlots.length - 1) : 0
				);
			}
			let currentY = minY;
			sortedPlotIds.forEach((id) => {
				console.log('setting plot ', id, ' to y: ', currentY);
				getPlotById(id).y = snapToGrid(Math.max(0, currentY));
				currentY += getPlotById(id).height + 50 + spacingIN;
			});
		}
	}

	function updateGap(by) {
		if (by === 'horizontal') {
			distributePlots('horizontalEqual', horizontalGap);
		}
		if (by === 'vertical') {
			distributePlots('verticalEqual', verticalGap);
		}
	}

	let selectedPlots = $derived(core.plots.filter((p) => p.selected));

	let horizontalGapIN = $state(null);
	let horizontalGap = $derived.by(() => {
		return horizontalGapIN != null && !isNaN(horizontalGapIN)
			? horizontalGapIN
			: getGap('horizontal');
	});
	let verticalGapIN = $state(null);
	let verticalGap = $derived.by(() => {
		return verticalGapIN != null && !isNaN(verticalGapIN) ? verticalGapIN : getGap('vertical');
	});

	let tempTab = 'properties';
	function updateCurrentControlTab(tab, type) {
		if (type === 'actogram') {
			appState.currentControlTab = tab;
		} else {
			if (appState.currentControlTab === 'annotations') {
				appState.currentControlTab = tempTab;
			} else {
				appState.currentControlTab = tab;
			}
		}
		//dataSettingsScrollTo('top');
		// console.log('DEBUG:', appState.currentControlTab);
	}
</script>

<div class="control-display">
	<!-- This is only for the first selected plot - need an #if to take care of multiple selections -->

	{#if selectedPlots.length > 1}
		<div class="control-banner">
			<div class="control-banner-title">
				<p>{selectedPlots.length} plots selected</p>

				<div class="control-banner-icons">
					<button class="icon" bind:this={addBtnRef} onclick={openDropdown}>
						<Icon name="disk" width={16} height={16} className="control-component-title-icon" />
					</button>
					<button
						class="icon"
						onclick={(e) => {
							e.stopPropagation();
							removePlots(selectedPlots.map((p) => p.id));
						}}
					>
						<Icon name="minus" width={20} height={20} className="menu-icon" />
					</button>
				</div>
			</div>
		</div>

		<div class="control-component">
			<div class="control-component-title">
				<p>Align Plots</p>
			</div>

			<div class="control-input-square">
				<div class="control-input">
					<p>Vertically</p>
					<div style="display: flex;  justify-content: flex-start; align-items: center; gap: 8px;">
						<button class="icon" onclick={(e) => alignPlots('top')}>
							<Icon
								name="align-top"
								width={24}
								height={24}
								className="control-component-title-icon"
							/>
						</button>
						<button class="icon" onclick={(e) => alignPlots('middle')}>
							<Icon
								name="align-middle"
								width={24}
								height={24}
								className="control-component-title-icon"
							/>
						</button>
						<button class="icon" onclick={(e) => alignPlots('bottom')}>
							<Icon
								name="align-bottom"
								width={24}
								height={24}
								className="control-component-title-icon"
							/>
						</button>
					</div>
				</div>

				<div class="control-input">
					<p>Horizontally</p>
					<div style="display: flex;  justify-content: flex-start; align-items: center; gap: 8px;">
						<button class="icon" onclick={(e) => alignPlots('left')}>
							<Icon
								name="align-left"
								width={24}
								height={24}
								className="control-component-title-icon"
							/>
						</button>
						<button class="icon" onclick={(e) => alignPlots('centre')}>
							<Icon
								name="align-centre"
								width={24}
								height={24}
								className="control-component-title-icon"
							/>
						</button>
						<button class="icon" onclick={(e) => alignPlots('right')}>
							<Icon
								name="align-right"
								width={24}
								height={24}
								className="control-component-title-icon"
							/>
						</button>
					</div>
				</div>
			</div>

			<div class="div-line"></div>

			<div class="control-component-title">
				<p>Distribute Plots</p>
			</div>

			<div class="control-input-square">
				<div class="control-input">
					<p>Vertically (gap)</p>
					<div style="display: flex;  justify-content: flex-start; align-items: center; gap: 8px;">
						<button class="icon" onclick={(e) => distributePlots('verticalEqual')}>
							<Icon
								name="distribute-vertical"
								width={24}
								height={24}
								className="control-component-title-icon"
							/>
						</button>
						<NumberWithUnits
							step={appState.gridSize}
							value={verticalGapIN ? verticalGapIN : verticalGap}
							onInput={(val) => {
								verticalGapIN = parseFloat(val);
								updateGap('vertical');
							}}
							style="width: calc(100% - {verticalGapIN != null && verticalGapIN !== verticalGap
								? 24
								: 0}px)"
						/>
					</div>
				</div>

				<div class="control-input">
					<p>Horizontally (gap)</p>
					<div style="display: flex;  justify-content: flex-start; align-items: center; gap: 8px;">
						<button class="icon" onclick={(e) => distributePlots('horizontalEqual')}>
							<Icon
								name="distribute-horizontal"
								width={24}
								height={24}
								className="control-component-title-icon"
							/>
						</button>
						<NumberWithUnits
							step={appState.gridSize}
							value={horizontalGapIN != null && !isNaN(horizontalGapIN)
								? horizontalGapIN
								: horizontalGap}
							onInput={(val) => {
								horizontalGapIN = parseFloat(val);
								updateGap('horizontal');
							}}
							style="width: calc(100% - {horizontalGapIN != null &&
							horizontalGapIN !== horizontalGap
								? 24
								: 0}px)"
						/>
					</div>
				</div>
			</div>

			<div class="div-line"></div>
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
	{:else if selectedPlots.length == 1}
		{@const plot = core.plots.filter((p) => p.selected)[0]}
		{#if plot}
			{@const Plot = appConsts.plotMap.get(plot.type).plot ?? null}
			{#if Plot}
				<div class="control-banner">
					<div class="control-banner-title">
						<p><Editable bind:value={plot.name} /></p>

						<div class="control-banner-icons">
							<button
								class="icon"
								bind:this={addBtnRef}
								onclick={(e) => {
									openDropdown();
								}}
							>
								<Icon name="disk" width={16} height={16} className="control-component-title-icon" />
							</button>

							<button
								class="icon"
								onclick={(e) => {
									e.stopPropagation();
									removePlots([plot.id]);
								}}
							>
								<Icon name="minus" width={20} height={20} className="menu-icon" />
							</button>
						</div>
					</div>

					<div class="control-tab">
						{#each appConsts.plotMap.get(plot.type).controlHeaders as header}
							<button
								class={appState.currentControlTab === header.toLowerCase() ? 'active' : ''}
								onclick={(e) => {
									updateCurrentControlTab(header.toLowerCase(), plot.type);
									e.target.scrollIntoView({ behavior: 'smooth' });
								}}
							>
								{header}
							</button>
						{/each}
					</div>
					<div class="div-line"></div>
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
	Id={core.plots.filter((p) => p.selected).map((p) => p.id)}
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
		position: absolute;
		top: 0;
		width: calc(100% - 2rem);

		padding-left: 1rem;
		padding-right: 1rem;
	}
</style>
