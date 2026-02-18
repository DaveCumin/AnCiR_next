<script>
	import { onMount } from 'svelte';
	let {
		value = $bindable(),
		step = 1,
		min = -Infinity,
		max = Infinity,
		units = { default: 'value', value: 1 },
		onInput = () => {},
		selectedUnitStart = 'default',
		className = '',
		style = ''
	} = $props();

	let inputElement = $state(null);

	// eg units:
	// 		{
	// 		default: 'hr',
	// 		days: 24,
	// 		hr: 1,
	// 		min: 1 / 60,
	// 		sec: 1 / (60 * 60)
	// 		}

	// Clamp initial value to min/max
	onMount(() => {
		value = clamp(value, min, max);
		if (selectedUnitStart != 'default') {
			selectedUnit = selectedUnitStart;
		}
	});

	// State for selected unit
	let selectedUnit = $state(units['default']);

	// Derived unit factor
	let unitFactor = $derived(units[selectedUnit]);

	// Derived precision for display
	let precision_dp = $derived.by(() => {
		if (step >= 1) return 0;
		const stepStr = step.toString();
		const decimalIndex = stepStr.indexOf('.');
		return decimalIndex === -1 ? 0 : stepStr.length - decimalIndex + 1;
	});

	// Derived display value (reactive to value and unitFactor)
	let displayValue = $derived.by(() => {
		const val =
			typeof unitFactor === 'object' ? unitFactor.inverse(Number(value)) : value / unitFactor;
		return Number(val.toFixed(precision_dp));
	});

	// Clamp function
	function clamp(val, minVal, maxVal) {
		return Math.max(minVal, Math.min(maxVal, val));
	}

	// Update value from displayValue (triggered by input or drag)
	function updateValue(newDisplayValue) {
		let newValue =
			typeof unitFactor === 'object' && Object.keys(units).length > 1
				? unitFactor.forward(Number(newDisplayValue))
				: newDisplayValue * unitFactor;
		newValue = clamp(newValue, min, max);
		value = newValue;
		onInput(value);
	}
</script>

<span class="number-input-wrapper">
	<input
		bind:this={inputElement}
		type="number"
		{step}
		min={typeof unitFactor === 'object' ? min : min / unitFactor}
		max={typeof unitFactor === 'object' ? max : max / unitFactor}
		bind:value={displayValue}
		oninput={(e) => updateValue(e.target.value)}
		onwheel={(e) => {
			if (document.activeElement == inputElement) e.stopPropagation();
		}}
		class={'number-input ' + className}
		{style}
	/>
</span>

{#if Object.keys(units).length > 2}
	<select class="unitSelect" bind:value={selectedUnit}>
		{#each Object.keys(units) as unit}
			{#if unit !== 'default'}
				<option value={unit}>{unit}</option>
			{/if}
		{/each}
	</select>
{/if}

<style>
	.number-input-wrapper {
		display: inline-flex;
		align-items: stretch;
		position: relative;
	}

	.number-input {
		cursor: text;
		user-select: none;
	}

	.number-input:hover {
		border-color: #666;
	}

	.number-input:focus {
		outline: none;
		border-color: #007bff;
		box-shadow: 0 0 5px rgba(0, 123, 255, 0.3);
	}

	.unitSelect {
		user-select: none;
	}
</style>
