<script module>
	// @ts-nocheck
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import { core } from '$lib/core/core.svelte';
	import Icon from '$lib/icons/Icon.svelte';

	export const Tableplot_defaultDataInputs = [];
	export const Tableplot_controlHeaders = ['Properties and Data'];
	export const Tableplot_displayName = 'Table';

	export class Tableplotclass {
		parentBox = $state();
		columnRefs = $state([]);
		showCol = $state([]);
		colCurrent = $state(1);
		showColNumber = $state(false);
		decimalPlaces = $state(2);
		Ncolumns = $derived.by(() => {
			const rowHeight = 33;
			// Draggable outer box is parentBox.height + 50, minus its title bar (~37)
			// and content padding (~16), leaving roughly parentBox.height - 3 for content.
			const usable = (this.parentBox?.height ?? 250) - 3;
			// Fixed overhead: table header row + "Row … of …" bar + wrapper margin
			const fixedOverhead = 75;
			return Math.max(1, Math.floor((usable - fixedOverhead) / rowHeight));
		});

		addColumn(colId) {
			if (!this.columnRefs.includes(colId)) {
				this.columnRefs = [...this.columnRefs, colId];
				this.showCol = [...this.showCol, true];
			}
		}

		addColumns(colIds) {
			const newCols = colIds.filter((id) => !this.columnRefs.includes(id));
			this.columnRefs = [...this.columnRefs, ...newCols];
			this.showCol = [...this.showCol, ...new Array(newCols.length).fill(true)];
		}

		removeColumn(index) {
			this.columnRefs = this.columnRefs.filter((_, i) => i !== index);
			this.showCol = this.showCol.filter((_, i) => i !== index);
		}

		moveColumn(fromIndex, toIndex) {
			const newRefs = [...this.columnRefs];
			const newShow = [...this.showCol];
			const [movedRef] = newRefs.splice(fromIndex, 1);
			const [movedShow] = newShow.splice(fromIndex, 1);
			newRefs.splice(toIndex, 0, movedRef);
			newShow.splice(toIndex, 0, movedShow);
			this.columnRefs = newRefs;
			this.showCol = newShow;
		}

		longestCol = $derived.by(() => {
			let out = 0;

			for (let i = 0; i < this.columnRefs.length; i++) {
				out = Math.max(out, getColumnById(this.columnRefs[i])?.getData()?.length ?? 0);
			}
			return out;
		});

		plotOrigins = $derived.by(() => {
			const origins = {};
			if (!core.plots) return origins;

			core.plots.forEach((plot) => {
				if (plot?.data && Array.isArray(plot.data)) {
					plot.data.forEach((d, seriesIdx) => {
						const roleItems = [
							{ refId: d.x?.refId, role: 'x' },
							{ refId: d.y?.refId, role: 'y' },
							{ refId: d.z?.refId, role: 'z' },
							{ refId: d.value?.refId, role: 'value' },
							{ refId: d.lower?.refId, role: 'lower' },
							{ refId: d.upper?.refId, role: 'upper' }
						];

						roleItems.forEach((item) => {
							if (item.refId == null || item.refId === -1) return;
							if (!origins[item.refId]) origins[item.refId] = [];
							origins[item.refId].push({
								plotId: plot.id,
								plotName: plot.name,
								role: item.role,
								seriesIdx
							});
						});
					});
				}

				if (plot.columnRefs && Array.isArray(plot.columnRefs)) {
					plot.columnRefs.forEach((refId) => {
						if (refId == null || refId === -1) return;
						if (!origins[refId]) origins[refId] = [];
						origins[refId].push({
							plotId: plot.id,
							plotName: plot.name,
							role: 'col',
							seriesIdx: 0
						});
					});
				}
			});
			console.log('Plot origins:', origins);
			return origins;
		});

		tableHeadings = $derived.by(() => {
			let out = this.showColNumber ? ['#'] : [];

			for (let i = 0; i < this.columnRefs.length; i++) {
				if (!this.showCol[i]) continue;
				const colId = this.columnRefs[i];
				const col = getColumnById(colId);
				if (!col) {
					out.push('???');
					continue;
				}

				let name = col.name;
				if (col.type === 'time' && col.data?.length > 0) {
					name += ' (raw | hrs since start)';
				}

				out.push(name);
			}
			return out;
		});

		tableData = $derived.by(() => {
			let out = [];
			if (this.showColNumber) {
				out.push(
					Array(this.Ncolumns)
						.fill(0)
						.map((_, i) => this.colCurrent - 1 + i + 1)
				);
			}

			for (let i = 0; i < this.columnRefs.length; i++) {
				if (!this.showCol[i]) continue;

				const col = getColumnById(this.columnRefs[i]);
				if (!col) {
					out.push(Array(this.Ncolumns).fill('—'));
					continue;
				}

				if (col.type === 'time' && col.data?.length > 0) {
					const times = col.data.slice(this.colCurrent - 1, this.colCurrent + this.Ncolumns);
					const hours = col.hoursSinceStart
						.slice(this.colCurrent - 1, this.colCurrent + this.Ncolumns)
						.map((x) => (Number.isFinite(x) ? x.toFixed(this.decimalPlaces) : x));
					out.push(times.map((t, j) => `${t} | ${hours[j]}`));
				} else {
					const data = col
						.getData()
						.slice(this.colCurrent - 1, this.colCurrent + this.Ncolumns)
						.map((x) => (Number.isFinite(x) ? x.toFixed(this.decimalPlaces) : x));
					out.push(data);
				}
			}
			return out;
		});

		constructor(parent, dataIN) {
			this.parentBox = parent;
			if (dataIN) {
				this.columnRefs = dataIN.columnRefs ?? [];
				this.showCol = dataIN.showCol ?? Array(this.columnRefs.length).fill(true);
				this.colCurrent = dataIN.colCurrent ?? 1;
				this.showColNumber = dataIN.showColNumber ?? false;
				this.decimalPlaces = dataIN.decimalPlaces ?? 2;
			}
		}

		getDownloadData() {
			const headers = [];
			const columns = [];
			for (let i = 0; i < this.columnRefs.length; i++) {
				if (!this.showCol[i]) continue;
				const col = getColumnById(this.columnRefs[i]);
				if (!col) continue;
				headers.push(col.name);
				columns.push(col.getData() ?? []);
			}
			const maxLen = Math.max(...columns.map((c) => c.length), 0);
			const rows = [];
			for (let r = 0; r < maxLen; r++) {
				rows.push(columns.map((col) => (r < col.length ? col[r] : '')));
			}
			return { headers, rows };
		}

		toJSON() {
			return {
				columnRefs: this.columnRefs,
				showCol: this.showCol,
				colCurrent: this.colCurrent,
				showColNumber: this.showColNumber,
				decimalPlaces: this.decimalPlaces
			};
		}

		static fromJSON(parent, json) {
			const table = new Tableplotclass(parent, null);
			if (json) {
				table.columnRefs = json.columnRefs ?? [];
				table.showCol = json.showCol ?? Array(table.columnRefs.length).fill(true);
				table.colCurrent = json.colCurrent ?? 1;
				table.showColNumber = json.showColNumber ?? false;
				table.decimalPlaces = json.decimalPlaces ?? 2;
			}
			return table;
		}
	}
</script>

<script>
	// @ts-nocheck
	import { slide } from 'svelte/transition';

	let { theData, which } = $props();

	let expandedTables = $state(new Set());
	let expandedPlots = $state(new Set());

	function toggleTable(id) {
		expandedTables = expandedTables.has(id)
			? new Set([...expandedTables].filter((x) => x !== id))
			: new Set([...expandedTables, id]);
	}

	function togglePlot(id) {
		expandedPlots = expandedPlots.has(id)
			? new Set([...expandedPlots].filter((x) => x !== id))
			: new Set([...expandedPlots, id]);
	}

	function isColumnSelected(colId) {
		return theData?.columnRefs?.includes(colId) ?? false;
	}

	function isTableSelected(table) {
		if (!table?.columnRefs?.length) return false;
		return table.columnRefs.every(isColumnSelected);
	}

	function isPlotSelected(plot) {
		let cols = [];
		if (plot?.data && Array.isArray(plot.plot.data)) {
			cols = plot.plot.data.flatMap((d) => [d.x?.refId, d.y?.refId, d.z?.refId]).filter(Boolean);
		} else if (plot?.columnRefs) {
			cols = plot.plot.columnRefs;
		}
		return cols.length > 0 && cols.every(isColumnSelected);
	}

	function toggleTableSelection(table) {
		if (!table?.columnRefs) return;
		const isSel = isTableSelected(table);
		if (isSel) {
			table.columnRefs.forEach((colId) => {
				const idx = theData.columnRefs.indexOf(colId);
				if (idx >= 0) theData.removeColumn(idx);
			});
		} else {
			theData.addColumns(table.columnRefs);
		}
	}

	function togglePlotSelection(plot) {
		let cols = [];
		if (plot?.data && Array.isArray(plot.data)) {
			cols = [
				...new Set(plot.data.flatMap((d) => [d.x?.refId, d.y?.refId, d.z?.refId]).filter(Boolean))
			];
		} else if (plot?.columnRefs) {
			cols = plot.columnRefs;
		}
		const isSel = isPlotSelected(plot);
		if (isSel) {
			cols.forEach((colId) => {
				const idx = theData.columnRefs.indexOf(colId);
				if (idx >= 0) theData.removeColumn(idx);
			});
		} else {
			theData.addColumns(cols);
		}
	}

	function toggleColumnSelection(colId) {
		console.log('Toggling column', colId, ', is currently selected:', isColumnSelected(colId));
		const isSel = isColumnSelected(colId);
		if (isSel) {
			const idx = theData.columnRefs.indexOf(colId);
			if (idx >= 0) theData.removeColumn(idx);
		} else {
			theData.addColumn(colId);
		}
	}

	function getPlotColumns(plot) {
		console.log('getting columns for plot', plot.name, plot);
		if (plot?.data && Array.isArray(plot.data)) {
			return [
				...new Set(
					plot.data
						.flatMap((d) => [d.x?.refId, d.y?.refId, d.z?.refId])
						.filter((id) => id != null && id !== -1)
				)
			];
		}
		if (plot?.columnRefs) return plot.columnRefs;
		return [];
	}

	let standaloneColumns = $derived.by(() => {
		const inTables = new Set();
		core.tables?.forEach((t) => t?.columnRefs?.forEach((id) => inTables.add(id)));
		return core.data?.filter((c) => !inTables.has(c.id)) ?? [];
	});

	function makeEdits(edit) {
		const colOffset = theData.plot.showColNumber ? 1 : 0;
		const tableCol = edit.col - colOffset;

		let visibleCount = 0;
		let actualIdx = -1;
		for (let i = 0; i < theData.plot.columnRefs.length; i++) {
			if (theData.plot.showCol[i]) {
				if (visibleCount === tableCol) {
					actualIdx = i;
					break;
				}
				visibleCount++;
			}
		}

		if (actualIdx < 0) return;

		const colId = theData.plot.columnRefs[actualIdx];
		const column = getColumnById(colId);
		if (!column) return;

		if (edit.row === 'h') {
			column.name = edit.value;
			return;
		}

		const rowIndex = Number(edit.row) + theData.plot.colCurrent - 1;
		if (rowIndex >= theData.plot.longestCol) return;

		if (column.processes?.at(-1)?.name !== 'EditValue') {
			column.addProcess('EditValue');
		}

		const proc = column.processes.at(-1);
		if (!proc.args.edits) proc.args.edits = [];

		const exIdx = proc.args.edits.findIndex((e) => e.position === rowIndex + 1);
		if (exIdx >= 0) {
			proc.args.edits[exIdx].value = Number(edit.value);
			proc.args.edits = [...proc.args.edits];
		} else {
			proc.args.edits = [
				...proc.args.edits,
				{ id: crypto.randomUUID(), position: rowIndex + 1, value: Number(edit.value) }
			];
		}
	}
</script>

{#snippet controls(theData)}
	<div class="control-component">
		<div class="control-component-title"><p>Table Settings</p></div>
		<div class="control-input-vertical">
			<div class="control-input-checkbox">
				<input type="checkbox" bind:checked={theData.showColNumber} />
				<p>Show row numbers</p>
			</div>
		</div>
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Decimal places</p>
				<NumberWithUnits min="0" step="1" bind:value={theData.decimalPlaces} />
			</div>
			<div class="control-input">
				<p>Starting row</p>
				<NumberWithUnits min="1" max={theData.longestCol} bind:value={theData.colCurrent} />
			</div>
		</div>
	</div>

	<div class="div-line"></div>

	<div class="control-component">
		<div class="control-component-title">
			<p>Columns</p>
			{#if theData.columnRefs.length}
				<span class="column-count">{theData.columnRefs.length} selected</span>
			{/if}
		</div>

		<div class="tree-list display-list">
			<!-- Tables -->
			{#each core.tables as table (table.id)}
				<details class="clps-item" open={expandedTables.has(table.id)}>
					<summary class="clps-title-container">
						<div class="clps-title">
							<input
								type="checkbox"
								checked={isTableSelected(table)}
								onchange={() => toggleTableSelection(table)}
							/>
							<span class="tree-name">{table.name}</span>
						</div>

						<div class="clps-title-button">
							{#if expandedTables.has(table.id)}
								<Icon
									name="caret-down"
									width={20}
									height={20}
									className="first-detail-title-icon"
								/>
							{:else}
								<Icon
									name="caret-right"
									width={20}
									height={20}
									className="first-detail-title-icon"
								/>
							{/if}
						</div>
					</summary>

					<div class="tree-children">
						{#each table.columnRefs as colId (colId)}
							{@const col = getColumnById(colId)}
							{#if col}
								<div class="tree-item-child">
									<input
										type="checkbox"
										checked={isColumnSelected(colId)}
										onchange={() => toggleColumnSelection(colId)}
									/>
									<span class="tree-name">{col.name}</span>
									<!-- <span class="tree-type">{col.type}</span> -->
									<!-- optional -->
								</div>
							{/if}
						{/each}
					</div>
				</details>
			{/each}

			<!-- Plots -->
			{#each core.plots as plot (plot.id)}
				{@const plotCols = getPlotColumns(plot)}
				{#if plotCols.length > 0}
					<details class="clps-item" open={expandedPlots.has(plot.id)}>
						<summary class="clps-title-container">
							<div class="clps-title">
								<input
									type="checkbox"
									checked={isPlotSelected(plot)}
									onchange={() => togglePlotSelection(plot)}
								/>
								<span class="tree-name">{plot.name}</span>
								<span class="tree-badge">Plot</span>
							</div>

							<div class="clps-title-button">
								{#if expandedPlots.has(plot.id)}
									<Icon
										name="caret-down"
										width={20}
										height={20}
										className="first-detail-title-icon"
									/>
								{:else}
									<Icon
										name="caret-right"
										width={20}
										height={20}
										className="first-detail-title-icon"
									/>
								{/if}
							</div>
						</summary>

						<div class="tree-children">
							{#each plotCols as colId (colId)}
								{@const col = getColumnById(colId)}
								{#if col}
									<div class="tree-item-child">
										<input
											type="checkbox"
											checked={isColumnSelected(colId)}
											onchange={() => toggleColumnSelection(colId)}
										/>
										<span class="tree-name">{col.name}</span>
										<!-- <span class="tree-type">{col.type}</span> -->
									</div>
								{/if}
							{/each}
						</div>
					</details>
				{/if}
			{/each}

			<!-- Standalone columns (flat, no grouping) -->
			{#each standaloneColumns as col (col.id)}
				<div class="tree-item-child standalone">
					<input
						type="checkbox"
						checked={isColumnSelected(col.id)}
						onchange={() => toggleColumnSelection(col.id)}
					/>
					<span class="tree-name">{col.name}</span>
					<!-- <span class="tree-type">{col.type}</span> -->
				</div>
			{/each}

			{#if !core.tables.length && !core.plots.length && !standaloneColumns.length}
				<p class="empty-state">No data available</p>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet plot(theData)}
	{#key theData.plot.showCol}
		{#if theData.plot.showCol.some((s) => s) || theData.plot.showColNumber}
			<div class="tableplot-layout">
				<div class="tableplot-body">
					<Table
						headers={theData.plot.tableHeadings}
						data={theData.plot.tableData}
						editable={true}
						onInput={makeEdits}
					/>
				</div>
				<p class="tableplot-row-bar">
					Row <NumberWithUnits
						min="1"
						max={theData.plot.longestCol}
						step="1"
						bind:value={theData.plot.colCurrent}
					/>
					to {Math.min(
						theData.plot.colCurrent + theData.plot.Ncolumns - 1,
						theData.plot.longestCol
					)} of
					{theData.plot.longestCol}
				</p>
			</div>
		{:else}
			<p style="color: #888; font-style: italic;">No columns selected</p>
		{/if}
	{/key}
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}

<style>
	.tableplot-layout {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.tableplot-body {
		flex: 1;
		overflow: hidden;
	}

	.tableplot-row-bar {
		flex-shrink: 0;
		margin: 0.4rem 0 0;
	}

	.display-list {
		width: 100%;
		margin-top: 0.25rem;
	}

	.clps-item {
		margin: 0.15rem 0;
	}

	.clps-title-container {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.35rem 0.5rem;
		border-radius: 4px;
		cursor: pointer;
		user-select: none;
		transition: background 0.15s;
	}

	.clps-title-container:hover {
		background: var(--color-lightness-98);
	}

	.clps-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
	}

	.clps-title input[type='checkbox'] {
		margin: 0;
	}

	.clps-title-button {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		opacity: 0.7;
	}

	.clps-item[open] .clps-title-container {
		font-weight: 500;
	}

	.tree-children {
		margin-left: 1.6rem;
		padding: 0.2rem 0;
	}

	.tree-item-child {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem;
		border-radius: 3px;
	}

	.tree-item-child:hover {
		background: var(--color-lightness-98);
	}

	.tree-item-child.standalone {
		padding-left: 2.2rem; /* indent more to align under children */
	}

	.tree-name {
		font-size: 13.5px;
		color: var(--color-lightness-15);
	}

	.tree-badge {
		font-size: 9.5px;
		color: var(--color-lightness-50);
		background: var(--color-lightness-92);
		padding: 1px 5px;
		border-radius: 3px;
		margin-left: 0.5rem;
	}

	.empty-state {
		color: var(--color-lightness-40);
		font-size: 12px;
		margin: 1rem 0.75rem;
		font-style: italic;
	}

	/* hide default summary arrow */
	.clps-item summary::-webkit-details-marker,
	.clps-item summary::marker {
		display: none;
	}
</style>
