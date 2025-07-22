<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column, { getColumnById } from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';

	export class Tableplotclass {
		parentBox = $state();
		columnRefs = $state([]);
		pageCurrent = $state(1);
		showColNumber = $state(true);

		//work out the number of columns that can fit in the height of the parent
		Ncolumns = $derived.by(() => {
			const colHeightpx = 34; //TODO: change this to be the appState font size plus padding
			let Ncols = Math.floor((this.parentBox.height - 3 * colHeightpx) / colHeightpx);
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
		pagesTotal = $derived.by(() => {
			const pagestotal = Math.ceil(this.longestCol / this.Ncolumns);
			if (this.pageCurrent > pagestotal) {
				this.pageCurrent = pagestotal;
			}
			return pagestotal;
		});

		nextPage() {
			this.pageCurrent += 1;
			if (this.pageCurrent > pagestotal) {
				this.pageCurrent = pagestotal;
			}
		}
		previousPage() {
			this.pageCurrent -= 1;
			if (this.pageCurrent < 1) {
				this.pageCurrent = 1;
			}
		}

		tableHeadings = $derived.by(() => {
			let out = [];
			if (this.showColNumber) {
				out.push('#');
			}
			for (let i = 0; i < this.columnRefs.length; i++) {
				out.push(getColumnById(this.columnRefs[i]).name);
			}
			console.log('headings: ', out);
			return out;
		});

		tableData = $derived.by(() => {
			let out = [];
			if (this.showColNumber) {
				out.push(
					new Array(this.Ncolumns)
						.fill(1)
						.map((x, i) => (this.pageCurrent - 1) * this.Ncolumns + i + 1)
				);
			}
			for (let i = 0; i < this.columnRefs.length; i++) {
				out.push(
					getColumnById(this.columnRefs[i])
						.getData()
						.slice(
							this.pageCurrent * this.Ncolumns,
							this.pageCurrent * this.Ncolumns + this.Ncolumns
						)
				);
			}
			return out;
		});

		constructor(parent, dataIN) {
			this.parentBox = parent;
			if (dataIN) {
				this.columnRefs = dataIN.columnRefs;
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
	import { preventDefault } from 'svelte/legacy';

	let { theData, which } = $props();
	console.log($state.snapshot(theData));
</script>

{#snippet controls(theData)}
	<p><input type="text" bind:value={theData.parentBox.name} /></p>
	<p>Col Numbers: <input type="checkbox" bind:checked={theData.showColNumber} /></p>

	<p>
		Page
		<input
			type="number"
			min="1"
			max={theData.pagesTotal}
			bind:value={theData.pageCurrent}
			onchange={(e) => console.log(e)}
		/>
		of {theData.pagesTotal}
	</p>
{/snippet}

{#snippet plot(theData)}
	<Table headers={theData.plot.tableHeadings} data={theData.plot.tableData} />
	<p>
		Page <input
			type="number"
			min="1"
			max={theData.plot.pagesTotal}
			bind:value={theData.plot.pageCurrent}
			onchange={(e) => console.log(e)}
		/>
		of {theData.plot.pagesTotal}
	</p>
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}
