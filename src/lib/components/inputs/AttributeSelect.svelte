<script>
	let {
		value = $bindable(),
		label,
		options,
		optionsDisplay = options,
		other = false,
		placeholder = '',
		onChange = () => {}
	} = $props(); // options must be passed as array
	let otherValInternal = crypto.randomUUID().replaceAll('-', '').slice(0, 6);
	let selected = $state();
	let selectComponent = $state();
	let otherComponent = $state();
</script>

{#if label}
	<label for={label}>{label}:</label>
{/if}
<div class="select-container">
	<select
		bind:this={selectComponent}
		bind:value={selected}
		name={label}
		id={label}
		onchange={(e) => {
			value = e.target.value;
			if (value == otherValInternal) {
				otherComponent.focus();
			}
			onChange(e.target.value);
		}}
	>
		<option value="" disabled selected>Select {label}</option>
		{#each options as option, i}
			<option value={option}>{optionsDisplay[i]}</option>
		{/each}
		{#if other}
			<option value={otherValInternal}>Other</option>
		{/if}
	</select>
	{#if selected == otherValInternal}
		<input
			bind:this={otherComponent}
			class="other-input"
			type="text"
			{placeholder}
			oninput={(e) => {
				value = e.target.value;
				onChange(e.target.value);
			}}
		/>
	{/if}
</div>

<style>
	.other-input {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		width: calc(100% - 1rem);

		padding: 2px;
		border-right: none;
		z-index: 10;
	}
	.other-input:hover {
		outline: none;
		border-right: none;
	}

	.other-input:focus {
		outline: none;
		border-right: none;
	}
	.select-container {
		position: relative;
	}
</style>
