<script>
	import { core } from '$lib/core/theCore.svelte.js';
	let {
		onChange = (value) => {
			console.log('selected col ' + value);
		},
		excludeColIds = [],
		value = $bindable()
	} = $props();
</script>

<select name="columnSelect" onchange={(e) => onChange(e.target.value)} bind:value>
	{#each core.data as c}
		{#if !excludeColIds.includes(c.columnID)}
			<option value={c.columnID}>{c.name}</option>
		{/if}
	{/each}
</select>
