<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column, { getColumnById } from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';

	export const Tableplot_defaultDataInputs = [];

	export class Tableplotclass {
		parentBox = $state();
		columnRefs = $state([]);
		showCol = $state([]);
		colCurrent = $state(1);
		showColNumber = $state(true);
		decimalPlaces = $state(2);

		//work out the number of columns that can fit in the height of the parent
		Ncolumns = $derived.by(() => {
			const colHeightpx = 34; //TODO: change this to be the appState font size plus padding
			let Ncols = Math.floor((this.parentBox.height - 2.4 * colHeightpx) / colHeightpx);
			if (Ncols < 1) {
				Ncols = 1;
				this.parentBox.height = 5 * colHeightpx;
			}
			return Ncols;
		});
		longestCol = $derived.by(() => {
			let out = 0;
			for (let i = 0; i < this.columnRefs.length; i++) {
				out = Math.max(out, getColumnById(this.columnRefs[i]).getData().length);
			}
			return out;
		});
		startCol = $state(0);

		tableHeadings = $derived.by(() => {
			let out = [];
			if (this.showColNumber) {
				out.push('#');
			}
			for (let i = 0; i < this.columnRefs.length; i++) {
				if (this.showCol[i]) {
					//if the column is a time column with data, add the raw data
					if (
						getColumnById(this.columnRefs[i]).type === 'time' &&
						getColumnById(this.columnRefs[i]).data?.length > 0
					) {
						out.push(getColumnById(this.columnRefs[i]).name + ' (raw | time)');
					} else {
						//get the column name
						out.push(getColumnById(this.columnRefs[i]).name);
					}
				}
			}

			return out;
		});

		tableData = $derived.by(() => {
			let out = [];
			if (this.showColNumber) {
				out.push(new Array(this.Ncolumns).fill(1).map((x, i) => this.colCurrent - 1 + i + 1));
			}
			for (let i = 0; i < this.columnRefs.length; i++) {
				if (this.showCol[i]) {
					//if the column is a time column with data, add the raw data
					if (
						getColumnById(this.columnRefs[i]).type === 'time' &&
						getColumnById(this.columnRefs[i]).data?.length > 0
					) {
						const times = getColumnById(this.columnRefs[i]).data?.slice(
							this.colCurrent - 1,
							this.colCurrent + this.Ncolumns
						);
						const values = getColumnById(this.columnRefs[i])
							.hoursSinceStart.slice(this.colCurrent - 1, this.colCurrent + this.Ncolumns)
							.map((x) => (Number(x) == x ? x.toFixed(this.decimalPlaces) : x));
						out.push(times.map((t, j) => `${t} | ${values[j]}`));
					} else {
						out.push(
							getColumnById(this.columnRefs[i])
								.getData()
								.slice(this.colCurrent - 1, this.colCurrent + this.Ncolumns)
								.map((x) => (Number(x) == x ? x.toFixed(this.decimalPlaces) : x))
						);
					}
				}
			}

			return out;
		});

		constructor(parent, dataIN) {
			this.parentBox = parent;

			if (dataIN) {
				this.columnRefs = dataIN.columnRefs;
				this.showCol = dataIN.showCol ?? Array(this.columnRefs.length).fill(true);
			}
		}

		toJSON() {
			return {
				columnRefs: this.columnRefs
			};
		}
		static fromJSON(parent, json) {
			if (!json) {
				return new Tableplotclass(parent, null);
			}

			const table = new Tableplotclass(parent, null);
			table.columnRefs = json.columnRefs;

			return table;
		}
	}
</script>

<script>
	let { theData, which } = $props();
</script>

{#snippet controls(theData)}
	<p><input type="text" bind:value={theData.parentBox.name} /></p>
	<p>Col Numbers: <input type="checkbox" bind:checked={theData.showColNumber} /></p>
	<p>Round to decimals: <input type="number" min="0" bind:value={theData.decimalPlaces} /></p>
	<p>
		Row:
		<input type="number" min="1" max={theData.longestCol} bind:value={theData.colCurrent} />
		to {theData.colCurrent + theData.Ncolumns - 1} of {theData.longestCol}
	</p>

	Show columns:
	<ul>
		{#each theData.columnRefs as colId, i}
			<li>
				<input type="checkbox" bind:checked={theData.showCol[i]} />
				{getColumnById(colId).name}
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet plot(theData)}
	{#key theData.plot.showCol}
		<Table headers={theData.plot.tableHeadings} data={theData.plot.tableData} />
		<p style="margin-bottom: 0;">
			Row <input
				type="number"
				min="1"
				max={theData.plot.longestCol}
				bind:value={theData.plot.colCurrent}
			/>
			to {theData.plot.colCurrent + theData.plot.Ncolumns - 1} of {theData.plot.longestCol}
		</p>
	{/key}
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}
