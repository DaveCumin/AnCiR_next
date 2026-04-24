<script module>
	// @ts-nocheck
	import { core } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';

	export const DataView_defaultDataInputs = [];
	export const DataView_controlHeaders = ['Properties'];
	export const DataView_displayName = 'Data View';

	export class DataViewclass {
		parentBox = $state();
		sourcePlotId = $state(null);
		sourceType = $state('reactive'); // 'reactive' or 'static'
		staticHeaders = $state([]);
		staticRows = $state([]);
		statsGetter = null; // live getter for reactive stats (not serialised)
		colCurrent = $state(1);
		decimalPlaces = $state(2);

		Ncolumns = $derived.by(() => {
			const rowHeight = 33;
			const usable = (this.parentBox?.height ?? 250) - 3;
			const fixedOverhead = 75;
			return Math.max(1, Math.floor((usable - fixedOverhead) / rowHeight));
		});

		sourcePlot = $derived.by(() => {
			if (this.sourcePlotId == null) return null;
			return core.plots.find((p) => p.id === this.sourcePlotId) ?? null;
		});

		downloadData = $derived.by(() => {
			if (this.sourceType === 'static') {
				return { headers: this.staticHeaders, rows: this.staticRows };
			}
			const sp = this.sourcePlot;
			if (!sp?.plot || typeof sp.plot.getDownloadData !== 'function') {
				return { headers: [], rows: [] };
			}
			return sp.plot.getDownloadData();
		});

		headers = $derived(this.downloadData.headers ?? []);
		rows = $derived(this.downloadData.rows ?? []);
		totalRows = $derived(this.rows.length);

		// Column-major data for the current page (matches what Table.svelte expects)
		tableData = $derived.by(() => {
			if (this.headers.length === 0) return [];
			const start = this.colCurrent - 1;
			const pageRows = this.rows.slice(start, start + this.Ncolumns);
			return this.headers.map((_, colIdx) =>
				pageRows.map((row) => {
					const cell = row[colIdx];
					if (cell == null) return '';
					if (typeof cell === 'number' && Number.isFinite(cell)) {
						return cell.toFixed(this.decimalPlaces);
					}
					return cell;
				})
			);
		});

		constructor(parent, dataIN) {
			this.parentBox = parent;
			if (dataIN) {
				this.sourcePlotId = dataIN.sourcePlotId ?? null;
				this.sourceType = dataIN.sourceType ?? 'reactive';
				this.staticHeaders = dataIN.staticHeaders ?? [];
				this.staticRows = dataIN.staticRows ?? [];
				this.colCurrent = dataIN.colCurrent ?? 1;
				this.decimalPlaces = dataIN.decimalPlaces ?? 2;
			}
		}

		getDownloadData() {
			return this.downloadData;
		}

		toJSON() {
			return {
				sourcePlotId: this.sourcePlotId,
				sourceType: this.sourceType,
				staticHeaders: this.headers,
				staticRows: this.rows,
				colCurrent: this.colCurrent,
				decimalPlaces: this.decimalPlaces
			};
		}

		static fromJSON(parent, json) {
			const dv = new DataViewclass(parent, null);
			if (json) {
				dv.sourcePlotId = json.sourcePlotId ?? null;
				dv.sourceType = json.sourceType ?? 'reactive';
				dv.staticHeaders = json.staticHeaders ?? [];
				dv.staticRows = json.staticRows ?? [];
				dv.colCurrent = json.colCurrent ?? 1;
				dv.decimalPlaces = json.decimalPlaces ?? 2;
			}
			return dv;
		}
	}

	export const definition = {
		displayName: DataView_displayName,
		defaultDataInputs: DataView_defaultDataInputs,
		controlHeaders: DataView_controlHeaders,
		plotClass: DataViewclass
	};
</script>

<script>
	// @ts-nocheck
	import { untrack } from 'svelte';
	let { theData, which } = $props();

	// Bridge reactive stats: the getter reads $state from the source component,
	// so running it inside an $effect establishes proper dependencies.
	// When the source data changes, the effect re-fires, updating staticHeaders/staticRows.
	$effect(() => {
		const plot = theData?.plot;
		if (plot?.sourceType === 'static' && typeof plot.statsGetter === 'function') {
			try {
				const result = plot.statsGetter();
				if (result?.headers?.length) {
					untrack(() => {
						plot.staticHeaders = result.headers;
						plot.staticRows = result.rows;
					});
				}
			} catch (e) {
				console.warn('Stats getter update failed:', e.message);
			}
		}
	});
</script>

{#snippet controls(theData)}
	<div class="control-component">
		<div class="control-component-title"><p>Data View</p></div>
		<div class="control-input-vertical">
			<div class="control-input">
				<p>Source</p>
				<p class="source-name">
					{#if theData.sourceType === 'static'}
						(table process stats)
					{:else}
						{theData.sourcePlot?.name ?? '(source plot not found)'}
					{/if}
				</p>
			</div>
		</div>
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Decimal places</p>
				<NumberWithUnits min="0" step="1" bind:value={theData.decimalPlaces} />
			</div>
			<div class="control-input">
				<p>Starting row</p>
				<NumberWithUnits min="1" max={theData.totalRows} bind:value={theData.colCurrent} />
			</div>
		</div>
	</div>
{/snippet}

{#snippet plot(theData)}
	{#if theData.plot.sourceType !== 'static' && theData.plot.sourcePlot == null}
		<div class="no-source">
			<p>Source plot not found.</p>
		</div>
	{:else if theData.plot.headers.length === 0}
		<div class="no-source">
			<p>No data available.</p>
		</div>
	{:else}
		<div class="tableplot-layout">
			<div class="tableplot-body">
				<Table headers={theData.plot.headers} data={theData.plot.tableData} editable={false} />
			</div>
			<p class="row-indicator">
				Row <NumberWithUnits
					min="1"
					max={theData.plot.totalRows}
					step="1"
					bind:value={theData.plot.colCurrent}
				/>
				to {Math.min(theData.plot.colCurrent + theData.plot.Ncolumns - 1, theData.plot.totalRows)} of
				{theData.plot.totalRows}
			</p>
		</div>
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
		overflow: hidden;
	}

	.tableplot-body {
		flex: 1;
		overflow: hidden;
	}

	.row-indicator {
		font-size: 0.8rem;
		color: var(--color-lightness-60);
		margin: 4px 8px 2px;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.no-source {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--color-lightness-60);
		font-size: 0.9rem;
	}

	.source-name {
		font-style: italic;
		color: var(--color-lightness-50);
		font-size: 0.85rem;
	}
</style>
