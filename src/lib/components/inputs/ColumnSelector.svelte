<script>
	import { core } from '$lib/core/core.svelte.js';
	import { Column, getColumnById } from '$lib/core/Column.svelte';
	let {
		onChange = (value) => {
			// console.log('selected col ' + value);
		},
		getPlotSiblings = -1,
		excludeColIds = [],
		value = $bindable(),
		multiple = false
	} = $props();

	//set up the values and labels for the data
	let options = $derived.by(() => {
		let out = new Map();

		//get the other data in plot - TODO!!
		// Might it be better to pass in the plot id and data id directly?
		// Need to also update getColumnById() to take in something like {plotId:0, dataId:1, colId:1}
		// Is this the best way?
		console.time('getPlotSiblings');
		if (getPlotSiblings !== -1) {
			console.log('getPlotSiblings: ', getPlotSiblings.id);
			for (let p = 0; p < core.plots.length; p++) {
				for (let d = 0; d < core.plots[p].plot.data?.length; d++) {
					Object.keys(core.plots[p].plot.data[d].toJSON()).forEach((key) => {
						let tempFlag = false;
						let tempGroup = [];
						if (core.plots[p].plot.data[d][key] instanceof Column) {
							const colId = core.plots[p].plot.data[d][key].id;
							tempGroup.push(colId);
							if (colId == getPlotSiblings) {
								tempFlag = true;
							}
							console.log(
								'TODO: need to add plot ',
								p,
								' (',
								core.plots[p].name,
								'), col ',
								core.plots[p].plot.data[d][key].id,
								' (',
								core.plots[p].plot.data[d][key].name,
								'): tempFlag = ',
								tempFlag,
								'tempGroup = ',
								tempGroup
							);
						}
					});
				}
			}
		}
		console.timeEnd('getPlotSiblings');

		//get all the columns in tables
		for (let t = 0; t < core.tables.length; t++) {
			//get the table process Ids also
			for (let p = 0; p < core.tables[t].processes.length; p++) {
				Object.keys(core.tables[t].processes[p].args.out).forEach((key) => {
					const ref = core.tables[t].processes[p].args.out[key];
					if (ref !== -1 && !excludeColIds.includes(ref)) {
						const processCol = getColumnById(ref);
						out.set(core.tables[t].name + ' : ' + processCol.name, processCol.id);
					}
				});
			}

			//columns
			for (let c = 0; c < core.tables[t].columns.length; c++) {
				if (!excludeColIds.includes(core.tables[t].columns[c].id)) {
					out.set(
						core.tables[t].name + ' : ' + core.tables[t].columns[c].name,
						core.tables[t].columns[c].id
					);
				}
			}
		}
		return out;
	});
</script>

{#if multiple}
	<select bind:value onchange={(e) => onChange(e.target.value)} multiple style="height: 200px">
		{#each core.tables as table}
			<optgroup label={table.name}>
				<!-- include the tableProces data also -->
				{#each table.processes as p}
					{#each p.args.out as o}
						{@const key = Object.keys(o)}
						{#each key as k}
							{@const col = getColumnById(o[k])}
							<option value={col.id}>{col.name}</option>
						{/each}
					{/each}
				{/each}

				<!-- columns-->
				{#each table.columns as col}
					<option value={col.id}>{col.name}</option>
				{/each}
			</optgroup>
		{/each}
	</select>
{:else}
	<select name="columnSelect" onchange={(e) => onChange(e.target.value)} bind:value>
		{#each Array.from(options.entries()) as [key, value]}
			<option {value}>{key}</option>
		{/each}
		<!-- add in columns that are not in core.data but not core.tables -->
	</select>
{/if}

<style>
	/* If issue with styling in other components apart from control, find alternative */
	select {
		width: 100%;
		min-width: 0;
		flex: 1 1 0;
		box-sizing: border-box;

		font-size: 14px;
		padding: 0.2rem 0.5rem;
		background-color: transparent;

		border: 1px solid var(--color-lightness-85);
		border-radius: 2px;

		/* direction: rtl; */
	}
</style>
