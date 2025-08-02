<script>
	import { core } from '$lib/core/core.svelte.js';
	import { getColumnById } from '$lib/core/Column.svelte';
	let {
		onChange = (value) => {
			// console.log('selected col ' + value);
		},
		excludeColIds = [],
		value = $bindable()
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

<select name="columnSelect" onchange={(e) => onChange(e.target.value)} bind:value>
	{#each Array.from(options.entries()) as [key, value]}
		<option {value}>{key}</option>
	{/each}
	<!-- add in columns that are not in core.data but not core.tables -->
</select>
