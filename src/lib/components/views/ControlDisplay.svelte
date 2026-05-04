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

	// --- Path helpers used by the multi-select shared-options UI ---
	// Accept dot or bracket notation:
	//   'plot.paddingIN.top'   → plot.plot.paddingIN.top
	//   'plot.xlimsIN[0]'      → plot.plot.xlimsIN[0]
	function splitPath(path) {
		// Match any run of chars that isn't `.`, `[`, or `]`.
		return path.match(/[^.[\]]+/g) ?? [];
	}

	export function getByPath(obj, path) {
		if (!obj || !path) return undefined;
		const segments = splitPath(path);
		let cur = obj;
		for (const seg of segments) {
			if (cur == null) return undefined;
			cur = cur[seg];
		}
		return cur;
	}

	export function setByPath(obj, path, val) {
		if (!obj || !path) return;
		const segments = splitPath(path);
		let cur = obj;
		for (let i = 0; i < segments.length - 1; i++) {
			if (cur == null) return;
			cur = cur[segments[i]];
		}
		if (cur != null) cur[segments[segments.length - 1]] = val;
	}

	// Intersect a per-plot list of schema fields by `path`, preserving the
	// order from the first plot's schema. Mixed-type selections drop fields
	// that aren't in every type's schema.
	export function intersectFields(perPlotSchemas) {
		if (perPlotSchemas.length === 0) return [];
		const result = [];
		for (const field of perPlotSchemas[0]) {
			if (perPlotSchemas.every((s) => s.some((f) => f.path === field.path))) {
				result.push(field);
			}
		}
		return result;
	}

	// For each schema field, read the value from each source object and decide
	// whether they all agree. `distinctValues` drives the "Set all to …" pills
	// shown when the field is mixed.
	export function evaluateFields(schema, sources) {
		return schema.map((field) => {
			const perPlotValues = sources.map((s) => getByPath(s, field.path));
			const stringified = perPlotValues.map((v) => JSON.stringify(v));
			const allEqual = stringified.every((s) => s === stringified[0]);
			const distinctValues = [];
			const seenKeys = [];
			perPlotValues.forEach((v, i) => {
				const k = stringified[i];
				if (!seenKeys.includes(k)) {
					seenKeys.push(k);
					distinctValues.push(v);
				}
			});
			return {
				...field,
				perPlotValues,
				allEqual,
				value: allEqual ? perPlotValues[0] : null,
				distinctValues
			};
		});
	}

	// Group items by a key function. Returns an array of [key, items[]] tuples
	// (preserves insertion order; plain object/Map avoided to keep the linter
	// happy and because the result is immediately consumed by an {#each}).
	export function groupByKey(items, keyFn) {
		const out = [];
		for (const item of items) {
			const k = keyFn(item) ?? '';
			let bucket = out.find((b) => b[0] === k);
			if (!bucket) {
				bucket = [k, []];
				out.push(bucket);
			}
			bucket[1].push(item);
		}
		return out;
	}
</script>

<script>
	// @ts-nocheck
	import Icon from '$lib/icons/Icon.svelte';
	import SavePlot from '$lib/components/iconActions/SavePlot.svelte';

	import { appConsts, appState, core, snapToGrid } from '$lib/core/core.svelte';
	import NumberWithUnits from '../inputs/NumberWithUnits.svelte';
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

	// Schema-driven shared properties. Read from each selected plot's plotMap
	// entry (mixed-type selections still see common fields like width/height).
	const sharedFields = $derived.by(() => {
		const plots = core.plots.filter((p) => p.selected);
		if (plots.length < 2) return [];
		const perPlotSchemas = plots.map(
			(p) => appConsts.plotMap.get(p.type)?.sharedFields ?? []
		);
		const schema = intersectFields(perPlotSchemas);
		return evaluateFields(schema, plots);
	});

	const sharedFieldsByGroup = $derived(groupByKey(sharedFields, (f) => f.group ?? ''));

	// Per-row data fields, paired by index. Limited to the smallest data array
	// length so we never read off the end of a plot.
	const sharedDataRows = $derived.by(() => {
		const plots = core.plots.filter((p) => p.selected);
		if (plots.length < 2) return { rows: [], rowCount: 0 };
		const perPlotSchemas = plots.map(
			(p) => appConsts.plotMap.get(p.type)?.dataSharedFields ?? []
		);
		const schema = intersectFields(perPlotSchemas);
		if (schema.length === 0) return { rows: [], rowCount: 0 };
		const counts = plots.map((p) => p.plot?.data?.length ?? 0);
		const rowCount = Math.min(...counts);
		const rows = [];
		for (let i = 0; i < rowCount; i++) {
			const sources = plots.map((p) => p.plot.data[i]);
			rows.push({ index: i, fields: evaluateFields(schema, sources) });
		}
		return { rows, rowCount };
	});

	// Apply a value to all selected plots at the given dotted path.
	function setSharedField(path, val) {
		core.plots.forEach((p) => {
			if (p.selected) setByPath(p, path, val);
		});
	}

	// Apply a value to data row [rowIndex] of every selected plot.
	function setSharedDataField(rowIndex, path, val) {
		core.plots.forEach((p) => {
			if (!p.selected) return;
			const row = p.plot?.data?.[rowIndex];
			if (row) setByPath(row, path, val);
		});
	}

	function formatPillValue(val, input) {
		if (val == null) return '—';
		if (input === 'boolean') return val ? 'on' : 'off';
		if (input === 'number') return String(val);
		return String(val);
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
						<button class="icon" onclick={(e) => alignPlots('center')}>
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

		<!-- Shared properties, schema-driven. One block per `group`. -->
		{#if sharedFieldsByGroup.length > 0}
			<div class="control-component">
				<div class="control-component-title">
					<p>Shared properties</p>
				</div>

				{#each sharedFieldsByGroup as [groupName, fields] (groupName)}
					{#if groupName}
						<div class="control-component-subtitle">
							<p>{groupName}</p>
						</div>
					{/if}
					<div class="control-input-vertical">
						{#each fields as field (field.path)}
							<div class="control-input">
								<p>
									{field.label}
									{#if !field.allEqual}<span class="mixed-tag">mixed</span>{/if}
								</p>

								{#if field.input === 'number'}
									<NumberWithUnits
										value={field.allEqual ? field.value : (field.distinctValues[0] ?? 0)}
										step={field.step ?? appState.gridSize}
										onInput={(v) => setSharedField(field.path, parseFloat(v))}
									/>
								{:else if field.input === 'boolean'}
									<input
										type="checkbox"
										checked={field.value === true}
										indeterminate={!field.allEqual}
										onchange={(e) => setSharedField(field.path, e.currentTarget.checked)}
									/>
								{:else if field.input === 'select'}
									<select
										value={field.allEqual ? String(field.value ?? '') : ''}
										onchange={(e) => {
											const raw = e.currentTarget.value;
											const match = field.options.find((o) => String(o) === raw);
											setSharedField(field.path, match !== undefined ? match : raw);
										}}
									>
										{#if !field.allEqual}<option value="" disabled>(mixed)</option>{/if}
										{#each field.options as opt (String(opt))}
											<option value={String(opt)}>{opt}</option>
										{/each}
									</select>
								{:else if field.input === 'text'}
									<input
										type="text"
										value={field.allEqual ? (field.value ?? '') : ''}
										placeholder={field.allEqual ? '' : '(mixed)'}
										oninput={(e) => setSharedField(field.path, e.currentTarget.value)}
									/>
								{/if}
							</div>

							{#if !field.allEqual}
								<div class="set-all-row">
									<span class="muted">Set all to:</span>
									{#each field.distinctValues as dv (JSON.stringify(dv))}
										<button
											class="value-pill"
											onclick={() => setSharedField(field.path, dv)}
										>
											{formatPillValue(dv, field.input)}
										</button>
									{/each}
								</div>
							{/if}
						{/each}
					</div>
				{/each}
			</div>

			<div class="div-line"></div>
		{/if}

		<!-- Shared data rows, paired by index. Hidden when row counts differ. -->
		{#if sharedDataRows.rowCount > 0}
			<div class="control-component">
				<div class="control-component-title">
					<p>Shared data ({sharedDataRows.rowCount} row{sharedDataRows.rowCount === 1 ? '' : 's'} per plot)</p>
				</div>

				{#each sharedDataRows.rows as row (row.index)}
					<div class="dataBlock">
						<div class="control-component-subtitle">
							<p>Row {row.index + 1}</p>
						</div>
						<div class="control-input-vertical">
							{#each row.fields as field (field.path)}
								<div class="control-input">
									<p>
										{field.label}
										{#if !field.allEqual}<span class="mixed-tag">mixed</span>{/if}
									</p>

									{#if field.input === 'number'}
										<NumberWithUnits
											value={field.allEqual ? field.value : (field.distinctValues[0] ?? 0)}
											step={field.step ?? appState.gridSize}
											onInput={(v) => setSharedDataField(row.index, field.path, parseFloat(v))}
										/>
									{:else if field.input === 'boolean'}
										<input
											type="checkbox"
											checked={field.value === true}
											indeterminate={!field.allEqual}
											onchange={(e) =>
												setSharedDataField(row.index, field.path, e.currentTarget.checked)}
										/>
									{:else if field.input === 'select'}
										<select
											value={field.allEqual ? String(field.value ?? '') : ''}
											onchange={(e) => {
												const raw = e.currentTarget.value;
												const match = field.options.find((o) => String(o) === raw);
												setSharedDataField(
													row.index,
													field.path,
													match !== undefined ? match : raw
												);
											}}
										>
											{#if !field.allEqual}<option value="" disabled>(mixed)</option>{/if}
											{#each field.options as opt (String(opt))}
												<option value={String(opt)}>{opt}</option>
											{/each}
										</select>
									{:else if field.input === 'text'}
										<input
											type="text"
											value={field.allEqual ? (field.value ?? '') : ''}
											placeholder={field.allEqual ? '' : '(mixed)'}
											oninput={(e) =>
												setSharedDataField(row.index, field.path, e.currentTarget.value)}
										/>
									{/if}
								</div>

								{#if !field.allEqual}
									<div class="set-all-row">
										<span class="muted">Set all to:</span>
										{#each field.distinctValues as dv (JSON.stringify(dv))}
											<button
												class="value-pill"
												onclick={() => setSharedDataField(row.index, field.path, dv)}
											>
												{formatPillValue(dv, field.input)}
											</button>
										{/each}
									</div>
								{/if}
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}
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

	.control-component-subtitle {
		font-size: 0.85rem;
		font-weight: 600;
		opacity: 0.75;
		margin: 0.4rem 0 0.2rem;
	}

	.mixed-tag {
		display: inline-block;
		font-size: 0.7rem;
		padding: 0 0.3rem;
		margin-left: 0.3rem;
		border-radius: 0.2rem;
		background-color: #f3d27a;
		color: #4a3500;
		vertical-align: middle;
	}

	.set-all-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
		margin: 0.1rem 0 0.4rem 0.4rem;
		font-size: 0.75rem;
	}

	.muted {
		opacity: 0.65;
	}

	.value-pill {
		font-size: 0.75rem;
		padding: 0.05rem 0.4rem;
		border: 1px solid #ccc;
		border-radius: 0.5rem;
		background-color: #f7f7f7;
		cursor: pointer;
	}

	.value-pill:hover {
		background-color: #e9e9e9;
	}
</style>
