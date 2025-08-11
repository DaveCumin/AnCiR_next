<script>
	let { bindTo = $bindable(), label, options, optionsDisplay = options } = $props(); // options must be passed as array
</script>

{#if label}
	<label for={label}>{label}:</label>
{/if}
<select bind:value={bindTo} name={label} id={label}>
	<option value="" disabled selected>Select {label}</option>
	{#each options as option, i}
		<option value={option}>{optionsDisplay[i]}</option>
	{/each}
</select>

<style>
</style>
