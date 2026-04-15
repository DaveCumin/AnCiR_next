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
		// Use an array of {label, id} so duplicate column names both appear (Map keys would
		// silently drop one when two columns share the same table+name string).
		/** @type {{ label: string; id: number }[]} */
		let out = [];
		const seenIds = new Set();

		//get the other data in plots - TODO!!
		// Is this the best way?
		//console.time('getPlotSiblings');
		//--- Brute force approach
		if (getPlotSiblings !== -1) {
			//console.log('getPlotSiblings: ', getPlotSiblings.id);
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
							const _plotColId = core.plots[p].plot.data[d][key].id;
							if (!seenIds.has(_plotColId)) {
								seenIds.add(_plotColId);
								out.push({
									label: core.plots[p].name + ' : ' + core.plots[p].plot.data[d][key].name,
									id: _plotColId
								});
							}
						}
					});
				}
			}
		}

		//console.timeEnd('getPlotSiblings');

		//get all the columns in tables
		for (let t = 0; t < core.tables.length; t++) {
			//get the table process Ids also
			for (let p = 0; p < core.tables[t].processes.length; p++) {
				Object.keys(core.tables[t].processes[p].args.out).forEach((key) => {
					const ref = core.tables[t].processes[p].args.out[key];
					if (ref !== -1 && !excludeColIds.includes(ref)) {
						const processCol = getColumnById(ref);
						if (processCol && !seenIds.has(processCol.id)) {
							seenIds.add(processCol.id);
							out.push({ label: core.tables[t].name + ' : ' + processCol.name, id: processCol.id });
						}
					}
				});
			}

			//columns
			for (let c = 0; c < core.tables[t].columns.length; c++) {
				const col = core.tables[t].columns[c];
				if (!excludeColIds.includes(col.id) && !seenIds.has(col.id)) {
					seenIds.add(col.id);
					out.push({
						label: core.tables[t].name + ' : ' + col.name,
						id: col.id
					});
				}
			}
		}
		//console.log('out: ', out);
		return out;
	});
</script>

{#if multiple}
	<select bind:value onchange={() => onChange(value)} multiple>
		{#each options as { label, id } (id)}
			<option value={id}>{label}</option>
		{/each}
	</select>
{:else}
	{#key options}
		<select name="columnSelect" onchange={(e) => onChange(e.target.value)} bind:value>
			{#each options as { label, id } (id)}
				<option value={id}>{label}</option>
			{/each}
			<!-- add in columns that are not in core.data but not core.tables -->
		</select>
	{/key}
{/if}

<style>
	/* If issue with styling in other components apart from control, find alternative */
	select[multiple] {
		min-height: 180px;
	}

	select {
		width: 100%;
		min-width: 0;
		flex: 1 1 auto;
		box-sizing: border-box;

		font-size: 14px;
		font-weight: lighter;
		padding: 0.2rem 0.25rem;

		/* background-color: transparent; */
		background-color: var(--color-lightness-97);

		border: 1px solid var(--color-lightness-85);
		border-radius: 2px;
		transition: border-color 0.2s;

		/* direction: rtl; */
	}

	select:hover {
		border: 1px solid var(--color-lightness-35);
	}
</style>
