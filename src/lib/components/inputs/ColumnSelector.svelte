<script>
	import { core } from '$lib/core/core.svelte.js';
	import { getColumnById } from '$lib/core/Column.svelte';
	let {
		onChange = (value) => {
			// console.log('selected col ' + value);
		},
		excludeColIds = [],
		value = $bindable(),
		multiple = false
	} = $props();

	//set up the values and labels for the data
	let options = new Map();
	//get all the columns in tables
	for (let t = 0; t < core.tables.length; t++) {
		for (let c = 0; c < core.tables[t].columns.length; c++) {
			if (!excludeColIds.includes(core.tables[t].columns[c].id)) {
				options.set(
					core.tables[t].name + ' : ' + core.tables[t].columns[c].name,
					core.tables[t].columns[c].id
				);
			}
		}
		//get the table process Ids also
		for (let p = 0; p < core.tables[t].processes.length; p++) {
			for (let o = 0; o < core.tables[t].processes[p].args.out.length; o++) {
				Object.keys(core.tables[t].processes[p].args.out).forEach((key) => {
					const ref = core.tables[t].processes[p].args.out[key];
					if (ref !== -1 && !excludeColIds.includes(ref)) {
						const processCol = getColumnById(ref);
						options.set(core.tables[t].name + ' : ' + processCol.name, processCol.id);
					}
				});
			}
		}
	}
</script>

{#if multiple}
	<select bind:value onchange={(e) => onChange(e.target.value)} multiple style="height: 200px">
		{#each core.tables as table}
			<optgroup label={table.name}>
				{#each table.columns as col}
					<option value={col.id}>{col.name}</option>
				{/each}
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
