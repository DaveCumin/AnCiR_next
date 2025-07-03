<script>
	import { onMount } from 'svelte';

	let {
		value = $bindable(),
		step = 0.1,
		min = -100,
		max = 100,
		limits = [-500, Infinity],
		units = {
			default: 'hr',
			days: 24,
			hr: 1,
			min: 1 / 60,
			sec: 1 / (60 * 60)
		}
	} = $props();
	let range = 1000;
	onMount(() => {
		range = max - min;
	});
	let lastUnit = $state(units['default']); // Keep track of the lasy unit used so when it changes can do the calculations into the new one
	let selectedUnit = $state(units['default']);
	let unitFactor = $derived.by(() => {
		return units[selectedUnit];
	});
	let displayValue = $state(value);
	let precision_dp = $derived.by(() => {
		if (step > 1) return 0;

		let stepStr = step.toString();
		let decimalIndex = stepStr.indexOf('.');
		if (decimalIndex === -1) {
			return 0;
		}
		return stepStr.length - decimalIndex - 1;
	});
	let displayMin = $derived.by(() => {
		if (typeof unitFactor === 'object') {
			return unitFactor.inverse(Number(min)).toFixed(precision_dp);
		} else {
			return (min / units[selectedUnit]).toFixed(precision_dp);
		}
	});
	let displayMax = $derived.by(() => {
		if (typeof unitFactor === 'object') {
			return unitFactor.inverse(Number(max)).toFixed(precision_dp);
		} else {
			return (max / units[selectedUnit]).toFixed(precision_dp);
		}
	});

	function updateDisplayValue() {
		if (typeof unitFactor === 'object') {
			displayValue = unitFactor.inverse(Number(value));
		} else {
			displayValue = value / units[selectedUnit];
		}
		//keep the precision
		displayValue = Number(displayValue.toFixed(precision_dp));
	}

	function updateValue() {
		if (typeof unitFactor === 'object') {
			value = unitFactor.forward(Number(displayValue));
		} else {
			value = displayValue * unitFactor;
		}

		//Keep the value within the hard limits
		if (value < limits[0]) {
			value = limits[0];
		}
		if (value > limits[1]) {
			value = limits[1];
		}
		updateDisplayValue();
	}

	function adjustLimits() {
		//ADJUST THE LIMITS IF NEEDED
		const bottom20 = Math.max(limits[0], min + range * 0.2);
		const top20 = Math.min(limits[1], max - range * 0.2);
		if (value > top20 || value < bottom20) {
			min = Math.max(limits[0], value - range);
			max = Math.min(limits[1], value + range);
		}
	}

	//Update the display value and step size when the units change
	function unitChange() {
		updateDisplayValue();
		lastUnit = selectedUnit; // update the last unit
		updateValue();
	}
</script>

<input
	style="width:20%"
	type="number"
	{step}
	min={displayMin}
	max={displayMax}
	bind:value={displayValue}
	oninput={updateValue}
	onchange={adjustLimits}
/>
{#if Object.keys(units).length > 1}
	<select class="unitSelect" bind:value={selectedUnit} onchange={unitChange}>
		{#each Object.keys(units) as unit}
			{#if unit != 'default'}
				<option value={unit}>{unit}</option>
			{/if}
		{/each}
	</select>
{/if}
<a>{displayMin}</a><input
	type="range"
	{step}
	min={displayMin}
	max={displayMax}
	bind:value={displayValue}
	oninput={updateValue}
	onchange={adjustLimits}
/><a>{displayMax}</a>
