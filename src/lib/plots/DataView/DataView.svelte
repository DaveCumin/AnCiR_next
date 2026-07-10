<script module>
	// @ts-nocheck
	import { core } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';

	export const DataView_defaultDataInputs = [];
	export const DataView_controlHeaders = ['Properties'];
	export const DataView_displayName = 'Data View';

	export class DataViewclass {
		static descriptors = {
			decimalPlaces: { group: 'Display', label: 'Decimal places' },
			// Don't surface in the shared-properties panel.
			sourcePlotId: { skip: true },
			sourceType: { skip: true },
			staticHeaders: { skip: true },
			staticRows: { skip: true }
		};

		parentBox = $state();
		sourcePlotId = $state(null);
		sourceType = $state('reactive'); // 'reactive' or 'static'
		staticHeaders = $state([]);
		staticRows = $state([]);
		statsGetter = null; // live getter for reactive stats (not serialised)
		decimalPlaces = $state(2);

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

		constructor(parent, dataIN) {
			this.parentBox = parent;
			if (dataIN) {
				this.sourcePlotId = dataIN.sourcePlotId ?? null;
				this.sourceType = dataIN.sourceType ?? 'reactive';
				this.staticHeaders = dataIN.staticHeaders ?? [];
				this.staticRows = dataIN.staticRows ?? [];
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
	import VirtualList from '$lib/components/reusables/VirtualList.svelte';
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

	// ── Virtualised body (same look as the Table node): the full table renders
	// through a windowed list (only on-screen rows in the DOM), replacing the old
	// "Starting row + Ncolumns" pager. Read-only — it mirrors a plot's computed data.
	const DEFAULT_COL_W = 130;
	let headers = $derived(theData?.plot?.headers ?? []);
	let rows = $derived(theData?.plot?.rows ?? []);
	let rowCount = $derived(rows.length);
	let rowItems = $derived(Array.from({ length: rowCount }, (_, i) => i));
	let gridCols = $derived(headers.map(() => `${DEFAULT_COL_W}px`).join(' '));
	let tableMinWidth = $derived(headers.length * DEFAULT_COL_W);

	function formatCell(value) {
		if (value == null || value === '') return '';
		if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(theData.plot.decimalPlaces) : String(value);
		return value;
	}
</script>

{#snippet controls(theData)}
	<div class="control-component">
		<div class="control-component-title"><p>Data View</p></div>
		<div class="control-input-vertical">
			<ControlInput label="Source">
				<p class="source-name">
					{#if theData.sourceType === 'static'}
						(analysis stats)
					{:else}
						{theData.sourcePlot?.name ?? '(source plot not found)'}
					{/if}
				</p>
			</ControlInput>
		</div>
		<div class="control-input-horizontal">
			<ControlInput label="Decimal places">
				<NumberWithUnits min="0" step="1" bind:value={theData.decimalPlaces} />
			</ControlInput>
		</div>
	</div>
{/snippet}

{#snippet plot(theData)}
	{#if theData.plot.sourceType !== 'static' && theData.plot.sourcePlot == null}
		<div class="no-source">
			<p>Source plot not found.</p>
		</div>
	{:else if headers.length === 0}
		<div class="no-source">
			<p>No data available.</p>
		</div>
	{:else}
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
						{#each headers as h (h)}
							<div class="tp-th">{h}</div>
						{/each}
					</div>

					<VirtualList items={rowItems} fill itemHeight={44}>
						{#snippet row(_, i)}
							<div class="tp-tr" style="grid-template-columns:{gridCols};">
								{#each headers as _h, c (c)}
									<div class="tp-td">{formatCell(rows[i]?.[c])}</div>
								{/each}
							</div>
						{/snippet}
					</VirtualList>
				</div>
			</div>
			<p class="tableplot-row-bar">{rowCount} row{rowCount === 1 ? '' : 's'}</p>
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
		font-size: 0.85rem;
		/* On the workflow canvas the plot preview wrapper sets pointer-events:none;
		   re-enable so the table can be scrolled. The node stays draggable via its header. */
		pointer-events: auto;
	}

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
	}

	.tp-tr {
		display: grid;
	}

	.tp-tr:hover {
		background: var(--color-lightness-98);
	}

	.tp-td {
		padding: 4px 12px;
		border-bottom: 1px solid var(--color-lightness-90);
		border-right: 1px solid var(--color-lightness-90);
		overflow: hidden;
		min-width: 0;
		white-space: nowrap;
		text-overflow: ellipsis;
		display: flex;
		align-items: center;
	}

	.tp-th:last-child,
	.tp-td:last-child {
		border-right: none;
	}

	/* Workflow node preview scales the whole plot down, so keep a larger font there. */
	:global(.plot-preview-inner) .tp-scroll {
		font-size: 1.5rem;
	}

	.tableplot-row-bar {
		flex-shrink: 0;
		margin: 0.4rem 0 0;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.no-source {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	.source-name {
		font-style: italic;
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}
</style>
