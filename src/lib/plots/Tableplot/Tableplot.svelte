<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	import { getColumnById } from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';

	export const Tableplot_defaultDataInputs = [];

	export class Tableplotclass {
		parentBox = $state();
		columnRefs = $state([]);
		showCol = $state([]);
		colCurrent = $state(1);
		showColNumber = $state(false);
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
						out.push(getColumnById(this.columnRefs[i]).name + ' (raw | hrs since start)');
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
								.map((x) => (Number(x) === x ? x.toFixed(this.decimalPlaces) : x))
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

	function makeEdits(edit) {
		// Adjust column index if showColNumber is true (first column is row numbers)
		// Adjust for showColNumber
		const colOffset = theData.plot.showColNumber ? 1 : 0;
		const tableCol = edit.col - colOffset;

		// Map table column index to columnRefs index, accounting for showCol
		let visibleColCount = 0;
		let actualCol = -1;
		for (let i = 0; i < theData.plot.columnRefs.length; i++) {
			if (theData.plot.showCol[i]) {
				if (visibleColCount === tableCol) {
					actualCol = i;
					break;
				}
				visibleColCount++;
			}
		}
		//Get the correct column
		const colId = theData.plot.columnRefs[actualCol];
		const column = getColumnById(colId);

		if (edit.row === 'h') {
			// Editing header: change column name
			if (actualCol >= 0 && actualCol < theData.plot.columnRefs.length) {
				const colId = theData.plot.columnRefs[actualCol];
				getColumnById(colId).name = edit.value;
			}
		} else {
			// Editing data: update value at specific row
			const rowIndex = Number(edit.row) + theData.plot.colCurrent - 1; // Adjust for colCurrent
			if (
				actualCol >= 0 &&
				actualCol < theData.plot.columnRefs.length &&
				rowIndex < theData.plot.longestCol
			) {
				//TODO - complete this (needs type checking, especially for time)
				console.log('editing.. ', rowIndex, ' of ', column.name, ' with ', edit);
			}
		}
	}
</script>

{#snippet controls(theData)}
	<p>Col Numbers: <input type="checkbox" bind:checked={theData.showColNumber} /></p>
	<p>Round to decimals: <NumberWithUnits min="0" bind:value={theData.decimalPlaces} /></p>
	<p>
		Row:
		<NumberWithUnits min="1" max={theData.longestCol} bind:value={theData.colCurrent} />
		to {theData.colCurrent + theData.Ncolumns - 1} of {theData.longestCol}
	</p>

	Show columns:
	<p>
		<a
			style="cursor: pointer;"
			onclick={(e) => {
				for (let i = 0; i < theData.showCol.length; i++) {
					theData.showCol[i] = true;
				}
			}}>All</a
		>
		|
		<a
			style="cursor: pointer;"
			onclick={(e) => {
				for (let i = 0; i < theData.showCol.length; i++) {
					theData.showCol[i] = false;
				}
			}}>None</a
		>
	</p>
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
		{#if theData.plot.showCol.some((s) => s) || theData.plot.showColNumber}
			<Table
				headers={theData.plot.tableHeadings}
				data={theData.plot.tableData}
				editable={true}
				onInput={(edit) => makeEdits(edit)}
			/>
			<p style="margin-bottom: 0;">
				Row <NumberWithUnits
					min="1"
					max={theData.plot.longestCol}
					bind:value={theData.plot.colCurrent}
				/>
				to {theData.plot.colCurrent + theData.plot.Ncolumns - 1} of {theData.plot.longestCol}
			</p>
		{/if}
	{/key}
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}
