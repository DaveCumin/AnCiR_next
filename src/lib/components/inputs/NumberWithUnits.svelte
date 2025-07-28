<script>
	import { onMount } from 'svelte';
	let {
		value = $bindable(0),
		step = 0.1,
		min = -100,
		max = 100,
		limits = [-500, Infinity],
		units = {
			default: 'hr',
			day: 24,
			hr: 1,
			min: 1 / 60,
			sec: 1 / (60 * 60)
		},
		selectedUnitStart = null,
		onInput = () => {}
	} = $props();
	let range = 1000;
	let isUpdating = $state(false);

	onMount(() => {
		//Take care of the case where no units are explicitly provided
		if (Object.keys(units).length < 2) {
			units = {
				default: 'value',
				value: 1
			};
			unitFactor = 1;
			selectedUnit = units['default'];
			lastUnit = units['default'];
		}
		range = max - min;
		if (selectedUnitStart) {
			selectedUnit = selectedUnitStart;
		}
		unitChange();
	});

	let lastUnit = $state(units['default']); // Keep track of the last unit used so when it changes can do the calculations into the new one
	let selectedUnit = $state(units['default']);
	let unitFactor = $derived.by(() => {
		return units[selectedUnit];
	});
	let displayValue = $state(value);
	let precision_dp = $derived.by(() => {
		if (step > 1) return 0;
		let stepStr = step.toString();
		let decimalIndex = stepStr.indexOf('.');
		if (decimalIndex === -1) return 0;
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
		if (isUpdating) return;
		isUpdating = true;
		if (typeof unitFactor === 'object') {
			displayValue = unitFactor.inverse(Number(value));
		} else {
			displayValue = value / units[selectedUnit];
		}
		displayValue = Number(displayValue.toFixed(precision_dp));
		isUpdating = false;
	}

	function updateValue() {
		if (isUpdating) return;
		isUpdating = true;
		if (typeof unitFactor === 'object') {
			value = unitFactor.forward(Number(displayValue));
		} else {
			value = displayValue * unitFactor;
		}
		if (value < limits[0]) value = limits[0];
		if (value > limits[1]) value = limits[1];
		updateDisplayValue();
		isUpdating = false;
		onInput();
	}

	function adjustLimits() {
		const bottom20 = Math.max(limits[0], min + range * 0.2);
		const top20 = Math.min(limits[1], max - range * 0.2);
		if (value > top20 || value < bottom20) {
			min = Math.max(limits[0], value - range);
			max = Math.min(limits[1], value + range);
		}
	}

	function unitChange() {
		updateDisplayValue();
		lastUnit = selectedUnit; // update the last unit
		updateValue();
	}

	//--------------------------------------------------------
	//Dragging functionality
	//--------------------------------------------------------
	let isDragging = false;
	let startX = 0;
	let startValue = $state(0);
	let sensitivity = 0.1;
	let inputElement = $state(null);

	function startDrag(event) {
		isDragging = true;
		startX = event.clientX;
		startValue = displayValue;
		//inputElement.requestPointerLock();
		window.addEventListener('mousemove', handleMouseMove, { capture: true });
		window.addEventListener('mouseup', stopDrag, { capture: true });
	}

	function handleMouseMove(event) {
		if (isDragging) {
			document.body.style.cursor = 'ew-resize';
			const deltaX = event.clientX - startX;
			const deltaValue = deltaX * sensitivity * step;
			let newValue = startValue + deltaValue;
			newValue = Math.round(newValue / step) * step; // Round to avoid floating-point precision issues
			newValue = Number(newValue.toFixed(6));
			displayValue = newValue;
			updateValue();
		}
	}

	function stopDrag(event) {
		isDragging = false;
		document.body.style.cursor = 'default';
		//document.exitPointerLock();
		window.removeEventListener('mousemove', handleMouseMove, { capture: true });
		window.removeEventListener('mouseup', stopDrag, { capture: true });
	}
</script>

<input
	bind:this={inputElement}
	style="width:20%"
	type="number"
	{step}
	min={displayMin}
	max={displayMax}
	bind:value={displayValue}
	oninput={updateValue}
	onchange={adjustLimits}
	onmousedown={startDrag}
	onmouseover={(e) => {
		e.target.focus(); //to enable scrolling for changing the value
	}}
	onwheel={(e) => {
		e.stopPropagation();
	}}
	class="draggable-number-input"
/>

<!-- onmouseover={startScroll}
	onmouseleave={stopScroll}
	onwheel={handleWheel} -->
{#if Object.keys(units).length > 2}
	<select class="unitSelect" bind:value={selectedUnit} onchange={unitChange}>
		{#each Object.keys(units) as unit}
			{#if unit != 'default'}
				<option value={unit}>{unit}</option>
			{/if}
		{/each}
	</select>
{/if}

<!-- <a>{displayMin}</a><input
	type="range"
	{step}
	min={displayMin}
	max={displayMax}
	bind:value={displayValue}
	oninput={updateValue}
	onchange={adjustLimits}
/><a>{displayMax}</a> -->

<style>
	.draggable-number-input {
		padding: 8px;
		font-size: 14px;
		border: 1px solid #ccc;
		border-radius: 4px;
		width: 100px;
		cursor: ew-resize;
		user-select: none;
	}

	.draggable-number-input:hover {
		border-color: #666;
	}

	.draggable-number-input:focus {
		outline: none;
		border-color: #007bff;
		box-shadow: 0 0 5px rgba(0, 123, 255, 0.3);
	}

	.unitSelect {
		user-select: none;
	}
</style>
