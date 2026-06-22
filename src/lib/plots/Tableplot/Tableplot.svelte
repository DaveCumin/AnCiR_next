<script module>
	// @ts-nocheck
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { core } from '$lib/core/core.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
	import { formatDateTime } from '$lib/utils/time/displayTime.js';

	export const Tableplot_defaultDataInputs = [];
	export const Tableplot_controlHeaders = ['Properties and Data'];
	export const Tableplot_displayName = 'Table';

	export class Tableplotclass {
		static descriptors = {
			showColNumber: { group: 'Display', label: 'Show row numbers' },
			decimalPlaces: { group: 'Display', label: 'Decimal places' },
			colCurrent: { group: 'Display', label: 'Starting row' }
		};

		parentBox = $state();
		columnRefs = $state([]);
		showCol = $state([]);
		colWidths = $state({}); // colId -> px width (missing → default); user-resizable
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

				out.push(col.name);
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

				if (col.type === 'bin') {
					const rawArr = core.rawData.get(col.data);
					if (Array.isArray(rawArr)) {
						const start = this.colCurrent - 1;
						const binStep = col.binStep ?? col.binWidth ?? 0;
						const halfRange = (col.binWidth ?? 0) / 2;
						const rangeStr = `±${halfRange.toFixed(2)}`;
						if (col.originTime_ms != null) {
							// Time-based bins: show center as datetime
							out.push(
								rawArr.slice(start, start + this.Ncolumns).map((x) => {
									if (!Number.isFinite(x)) {
										return { raw: '-', computed: '-', isTime: true };
									}
									const centerMs = col.originTime_ms + (x + binStep / 2) * 3600000;
									return {
										raw: Number.isFinite(centerMs) ? formatDateTime(centerMs) : '-',
										computed: Number.isFinite(centerMs) ? rangeStr : '-',
										isTime: true
									};
								})
							);
						} else {
							// Numeric bins: show center value with ± range
							out.push(
								rawArr.slice(start, start + this.Ncolumns).map((x) => {
									if (!Number.isFinite(x)) {
										return { raw: '-', computed: '-', isTime: true };
									}
									return {
										raw: (x + binStep / 2).toFixed(this.decimalPlaces),
										computed: rangeStr,
										isTime: true
									};
								})
							);
						}
					} else {
						out.push(Array(this.Ncolumns).fill('—'));
					}
				} else if (col.type === 'time' && !col.isReferencial() && col.compression !== 'awd') {
					const rawArr = core.rawData.get(col.data);
					if (Array.isArray(rawArr)) {
						const start = this.colCurrent - 1;
						const rawSlice = rawArr.slice(start, start + this.Ncolumns);
						const hours = (col.hoursSinceStart ?? [])
							.slice(start, start + this.Ncolumns)
							.map((x) => (Number.isFinite(x) ? x.toFixed(this.decimalPlaces) : String(x)));
						// If raw data is UNIX ms (numbers from tableProcess output), format as readable date
						const isUnixMs = rawSlice.length > 0 && typeof rawSlice[0] === 'number';
						const displayStrings = isUnixMs ? rawSlice.map(formatTimeFromUNIX) : rawSlice;
						out.push(displayStrings.map((t, j) => ({ raw: t, computed: hours[j], isTime: true })));
					} else {
						// AWD or missing rawData — fall back to numeric display
						const data = col
							.getData()
							.slice(this.colCurrent - 1, this.colCurrent + this.Ncolumns)
							.map((x) => (Number.isFinite(x) ? x.toFixed(this.decimalPlaces) : x));
						out.push(data);
					}
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
				colWidths: this.colWidths,
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
				table.colWidths = json.colWidths ?? {};
				table.colCurrent = json.colCurrent ?? 1;
				table.showColNumber = json.showColNumber ?? false;
				table.decimalPlaces = json.decimalPlaces ?? 2;
			}
			return table;
		}
	}

	export const definition = {
		displayName: Tableplot_displayName,
		defaultDataInputs: Tableplot_defaultDataInputs,
		controlHeaders: Tableplot_controlHeaders,
		plotClass: Tableplotclass
	};
</script>

<script>
	// @ts-nocheck
	import dayjs from '$lib/utils/time/dayjsSetup.js';
	import VirtualList from '$lib/components/reusables/VirtualList.svelte';
	import Editable from '$lib/components/inputs/Editable.svelte';

	let { theData, which } = $props();

	let expandedTables = $state(new Set());
	let expandedPlots = $state(new Set());

	// ── Virtualised body helpers ──────────────────────────────────────────────
	// The table renders the FULL series via a windowed list (only on-screen rows in
	// the DOM), with per-cell formatting computed lazily, replacing the old
	// "Starting row + Ncolumns" pager.
	let visibleColumns = $derived.by(() => {
		const tp = theData?.plot;
		if (!tp) return [];
		const out = [];
		for (let i = 0; i < tp.columnRefs.length; i++) {
			// Columns added by WIRING only extend columnRefs (not showCol), so an
			// undefined entry means "not hidden" — default to visible.
			if (tp.showCol[i] === false) continue;
			const col = getColumnById(tp.columnRefs[i]);
			out.push({ colId: tp.columnRefs[i], col });
		}
		return out;
	});
	let rowCount = $derived(theData?.plot?.longestCol ?? 0);
	let rowItems = $derived(Array.from({ length: rowCount }, (_, i) => i));
	let hasTwoLineCol = $derived(
		visibleColumns.some(
			(c) =>
				c.col &&
				(c.col.type === 'bin' ||
					(c.col.type === 'time' && !c.col.isReferencial() && c.col.compression !== 'awd'))
		)
	);
	// Row height tracks the 1.5rem (~24px) cell font: ~44px for one line, more for
	// the two-line time cells (value + "computed hrs" sub-line).
	let rowH = $derived(hasTwoLineCol ? 64 : 44);
	const DEFAULT_COL_W = 130;
	const MIN_COL_W = 56;
	const widthFor = (colId) => theData?.plot?.colWidths?.[colId] ?? DEFAULT_COL_W;
	let colOffsetPx = $derived(theData?.plot?.showColNumber ? '44px ' : '');
	// Fixed px column widths (not 1fr) so the sticky header grid and the row grids
	// stay aligned regardless of the body's vertical scrollbar, and so columns can
	// be resized + overflow can ellipsis.
	let gridCols = $derived(
		`${colOffsetPx}${visibleColumns.map((vc) => `${widthFor(vc.colId)}px`).join(' ')}`
	);
	let tableMinWidth = $derived(
		(theData?.plot?.showColNumber ? 44 : 0) +
			visibleColumns.reduce((sum, vc) => sum + widthFor(vc.colId), 0)
	);

	// Drag a column header's right edge to resize that column.
	function startColResize(e, colId) {
		e.preventDefault();
		e.stopPropagation();
		const startX = e.clientX;
		const startW = widthFor(colId);
		const onMove = (ev) => {
			const w = Math.max(MIN_COL_W, Math.round(startW + (ev.clientX - startX)));
			theData.plot.colWidths = { ...theData.plot.colWidths, [colId]: w };
		};
		const onUp = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}

	// Format one cell (column, absolute row index) — mirrors the per-type logic the
	// class used to bake into `tableData`, but one cell at a time.
	function formatCell(col, i) {
		if (!col) return '—';
		const dp = theData.plot.decimalPlaces;
		if (col.type === 'bin') {
			const rawArr = core.rawData.get(col.data);
			if (!Array.isArray(rawArr)) return '—';
			const x = rawArr[i];
			if (!Number.isFinite(x)) return { raw: '-', computed: '-', isTime: true };
			const binStep = col.binStep ?? col.binWidth ?? 0;
			const rangeStr = `±${((col.binWidth ?? 0) / 2).toFixed(2)}`;
			if (col.originTime_ms != null) {
				const centerMs = col.originTime_ms + (x + binStep / 2) * 3600000;
				return {
					raw: Number.isFinite(centerMs) ? formatDateTime(centerMs) : '-',
					computed: Number.isFinite(centerMs) ? rangeStr : '-',
					isTime: true
				};
			}
			return { raw: (x + binStep / 2).toFixed(dp), computed: rangeStr, isTime: true };
		}
		if (col.type === 'time' && !col.isReferencial() && col.compression !== 'awd') {
			const rawArr = core.rawData.get(col.data);
			if (Array.isArray(rawArr)) {
				const v = rawArr[i];
				const hours = col.hoursSinceStart?.[i];
				const hoursStr = Number.isFinite(hours) ? hours.toFixed(dp) : String(hours ?? '');
				const raw = typeof v === 'number' ? formatTimeFromUNIX(v) : v;
				return { raw, computed: hoursStr, isTime: true };
			}
		}
		const v = col.getData()?.[i];
		return Number.isFinite(v) ? v.toFixed(theData.plot.decimalPlaces) : (v ?? '');
	}

	// Visible-column position → the `col` index makeEdits expects (row-number column
	// occupies slot 0 when shown).
	function editColIndex(visIndex) {
		return visIndex + (theData.plot.showColNumber ? 1 : 0);
	}

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
		//console.log('Toggling column', colId, ', is currently selected:', isColumnSelected(colId));
		const isSel = isColumnSelected(colId);
		if (isSel) {
			const idx = theData.columnRefs.indexOf(colId);
			if (idx >= 0) theData.removeColumn(idx);
		} else {
			theData.addColumn(colId);
		}
	}

	function getPlotColumns(plot) {
		//console.log('getting columns for plot', plot.name, plot);
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
		// "Standalone" = columns not absorbed by any Group node.
		const grouped = new Set();
		for (const g of core.groups ?? []) {
			for (const cid of g.sourceColumnIds ?? []) grouped.add(cid);
		}
		return core.data?.filter((c) => !grouped.has(c.id)) ?? [];
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

		const rowIndex = Number(edit.row); // virtualised rows pass an absolute index
		if (rowIndex >= theData.plot.longestCol) return;

		// Time columns: edit the raw data directly
		if (column.type === 'time' && !column.isReferencial() && column.compression !== 'awd') {
			const rawArr = core.rawData.get(column.data);
			if (Array.isArray(rawArr) && rowIndex < rawArr.length) {
				if (typeof rawArr[0] === 'number') {
					// UNIX ms time data from tableProcess output — parse "DD MMM YYYY HH:mm:ss" back to ms
					const dt = dayjs.utc(edit.value, 'DD MMM YYYY HH:mm:ss', true);
					if (dt.isValid()) {
						rawArr[rowIndex] = dt.valueOf();
						column.rawDataVersion++;
					}
				} else {
					// Raw string time data (imported) — store edited string directly
					rawArr[rowIndex] = edit.value;
					column.rawDataVersion++;
				}
			}
			return;
		}

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
			<!-- Groups (replace tables) -->
			{#each core.groups as group (group.id)}
				<details class="clps-item" open={expandedTables.has(group.id)}>
					<summary
						class="clps-title-container"
						onclick={(e) => e.preventDefault()}
						onkeydown={(e) => {
							if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget)
								e.preventDefault();
						}}
					>
						<div class="clps-title">
							<input
								type="checkbox"
								checked={(group.sourceColumnIds ?? []).every((cid) => isColumnSelected(cid))}
								onclick={(e) => {
									e.stopPropagation();
									const all = (group.sourceColumnIds ?? []).every((cid) => isColumnSelected(cid));
									for (const cid of group.sourceColumnIds ?? []) {
										if (all) {
											if (isColumnSelected(cid)) toggleColumnSelection(cid);
										} else {
											if (!isColumnSelected(cid)) toggleColumnSelection(cid);
										}
									}
								}}
							/>
							<span class="tree-name">{group.name}</span>
						</div>

						<div class="clps-title-button">
							<button
								class="icon"
								onclick={() => {
									toggleTable(group.id);
								}}
							>
								{#if expandedTables.has(group.id)}
									<Icon name="caret-down" width={20} height={20} />
								{:else}
									<Icon name="caret-right" width={20} height={20} />
								{/if}
							</button>
						</div>
					</summary>

					<div class="tree-children">
						{#each group.sourceColumnIds ?? [] as colId (colId)}
							{@const col = getColumnById(colId)}
							{#if col}
								<div class="tree-item-child">
									<input
										type="checkbox"
										checked={isColumnSelected(colId)}
										onchange={() => toggleColumnSelection(colId)}
									/>
									<span class="tree-name">{col.name}</span>
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
						<summary
							class="clps-title-container"
							onclick={(e) => e.preventDefault()}
							onkeydown={(e) => {
								if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget)
									e.preventDefault();
							}}
						>
							<div class="clps-title">
								<input
									type="checkbox"
									checked={isPlotSelected(plot)}
									onclick={(e) => {
										e.stopPropagation();
										togglePlotSelection(plot);
									}}
								/>
								<span class="tree-name">{plot.name}</span>
								<span class="tree-badge">Plot</span>
							</div>

							<div class="clps-title-button">
								<button
									class="icon"
									onclick={() => {
										togglePlot(plot.id);
									}}
								>
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
								</button>
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

			{#if !core.groups.length && !core.plots.length && !standaloneColumns.length}
				<p class="empty-state">No data available</p>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet plot(theData)}
	{#if visibleColumns.length > 0 || theData.plot.showColNumber}
		<div class="tableplot-layout">
			<div
				class="tp-scroll"
				role="presentation"
				onwheel={(e) => {
					if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
				}}
			>
				<div class="tp-inner" style="min-width:{tableMinWidth}px;">
					<div class="tp-head" style="grid-template-columns:{gridCols};">
						{#if theData.plot.showColNumber}
							<div class="tp-th tp-num">#</div>
						{/if}
						{#each visibleColumns as vc, vi (vc.colId)}
							<div class="tp-th">
								<Editable
									editable={true}
									value={vc.col?.name ?? '???'}
									onInput={(v) => makeEdits({ col: editColIndex(vi), row: 'h', value: v })}
								/>
								<!-- Drag the right edge to resize this column. -->
								<div
									class="tp-resize"
									role="separator"
									aria-orientation="vertical"
									title="Drag to resize column"
									onpointerdown={(e) => startColResize(e, vc.colId)}
								></div>
							</div>
						{/each}
					</div>

					<VirtualList items={rowItems} fill itemHeight={rowH}>
						{#snippet row(_, i)}
							<div class="tp-tr" style="grid-template-columns:{gridCols};">
								{#if theData.plot.showColNumber}
									<div class="tp-td tp-num">{i + 1}</div>
								{/if}
								{#each visibleColumns as vc, vi (vc.colId)}
									{@const cell = formatCell(vc.col, i)}
									<div class="tp-td">
										{#if cell && cell.isTime}
											<div class="time-cell">
												<Editable
													value={cell.raw}
													onInput={(v) => makeEdits({ col: editColIndex(vi), row: i, value: v })}
												/>
												{#if String(cell.computed) !== String(cell.raw)}
													<div class="computed-time">{cell.computed} hrs</div>
												{/if}
											</div>
										{:else if cell == null}
											<span class="null-value">-</span>
										{:else}
											<Editable
												value={cell}
												onInput={(v) => makeEdits({ col: editColIndex(vi), row: i, value: v })}
											/>
										{/if}
									</div>
								{/each}
							</div>
						{/snippet}
					</VirtualList>
				</div>
			</div>
			<p class="tableplot-row-bar">{rowCount} row{rowCount === 1 ? '' : 's'}</p>
		</div>
	{:else}
		<p style="color: #888; font-style: italic;">No columns selected</p>
	{/if}
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
		min-height: 0;
	}

	.tp-scroll {
		flex: 1;
		min-height: 0;
		overflow-x: auto;
		overflow-y: hidden;
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		background: var(--surface-card);
		/* Workspace renders the table at native 1:1, so use a normal table font.
		   The workflow node preview (.plot-preview-inner) scales the whole plot
		   down, so it restores the larger design font below. */
		font-size: 0.85rem;
		/* On the workflow canvas the plot preview wrapper sets pointer-events:none
		   (so the node stays draggable); re-enable it here so the table can be
		   scrolled/edited. The node is still draggable via its header. */
		pointer-events: auto;
	}

	/* Full height of .tp-scroll so the fill VirtualList can take the space left
	   under the sticky header and scroll vertically. */
	.tp-inner {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.tp-head {
		display: grid;
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--color-lightness-97);
		flex-shrink: 0;
	}

	.tp-th {
		padding: 6px 12px;
		font-weight: 600;
		border-bottom: 1px solid var(--color-lightness-85);
		border-right: 1px solid var(--color-lightness-85);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		position: relative; /* anchors the resize grip */
	}

	/* Drag handle straddling each header's right border. */
	.tp-resize {
		position: absolute;
		top: 0;
		right: -3px;
		width: 7px;
		height: 100%;
		cursor: col-resize;
		z-index: 2;
		touch-action: none;
	}
	.tp-resize:hover {
		background: color-mix(in srgb, var(--color-accent) 35%, transparent);
	}

	/* Truncate over-long cell/header text with an ellipsis (the values are
	   rendered by the Editable child, hence the :global span target). The fixed
	   column width gives it something to truncate against. */
	.tp-th :global(.inline-edit-span),
	.tp-td :global(.inline-edit-span) {
		display: block;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-tr {
		display: grid;
	}

	.tp-tr:hover {
		background: var(--color-lightness-98, #fafafa);
	}

	.tp-td {
		padding: 4px 12px;
		border-bottom: 1px solid var(--color-lightness-90, #eee);
		border-right: 1px solid var(--color-lightness-90);
		overflow: hidden;
		min-width: 0; /* let the fixed grid track clip overflow rather than expand */
		display: flex;
		flex-direction: column;
		justify-content: center;
	}

	.tp-num {
		color: var(--color-lightness-50, #888);
		font-size: 0.8em;
		text-align: center;
		justify-content: center;
	}

	/* Workflow node preview scales the whole plot down, so keep the original
	   design font there (it reads fine once scaled). */
	:global(.plot-preview-inner) .tp-scroll {
		font-size: 1.5rem;
	}

	.tp-th:last-child,
	.tp-td:last-child {
		border-right: none;
	}

	.time-cell {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		min-width: 0;
		max-width: 100%;
	}

	.computed-time {
		font-size: 0.75em;
		color: var(--color-lightness-50, #888);
		line-height: 1.1;
		padding-left: 4px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}

	.null-value {
		color: var(--color-lightness-70, #aaa);
	}

	.tableplot-row-bar {
		flex-shrink: 0;
		margin: 0.4rem 0 0;
		font-size: 0.8rem;
		color: var(--color-lightness-50, #888);
	}

	.display-list {
		width: 100%;
		margin-top: var(--space-2);
	}

	.clps-item {
		margin: 0.15rem 0;
	}

	.clps-title-container {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.35rem var(--space-4);
		border-radius: var(--radius-sm);
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
		gap: var(--space-4);
		flex: 1;
	}

	.clps-title input[type='checkbox'] {
		margin: 0;
	}

	.clps-title-button {
		display: flex;
		align-items: center;
		gap: var(--space-2);
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
		gap: var(--space-4);
		padding: var(--space-2) var(--space-4);
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
		margin-left: var(--space-4);
	}

	.empty-state {
		color: var(--color-lightness-40);
		font-size: var(--font-sm);
		margin: var(--space-6) var(--space-5);
		font-style: italic;
	}

	/* hide default summary arrow */
	.clps-item summary::-webkit-details-marker,
	.clps-item summary::marker {
		display: none;
	}
</style>
