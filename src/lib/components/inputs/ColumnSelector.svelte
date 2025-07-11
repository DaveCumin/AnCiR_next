<script>
	import { core } from '$lib/core/core.svelte.js';
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
		{#if !excludeColIds.includes(c.id)}
			<option value={c.id}>{c.name}</option>
		{/if}
	{/each}
</select>
