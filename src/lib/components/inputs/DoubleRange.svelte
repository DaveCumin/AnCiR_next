<script>
	//inspired by https://w3collective.com/double-range-slider-html-css-js/
	let { min = 0, max = 100, step = 1, minVal = $bindable(), maxVal = $bindable() } = $props();

	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	//TODO: need to deal with min>max and other edge cases, etc.
	//TODO: can still enter fractions into the number input, even if step is 1. Would be good to prevent this.
	//TODO: style this !!
</script>

<div class="range">
	<div class="range-slider">
		<span class="range-selected"></span>
	</div>
	<div class="range-input">
		<input type="range" class="min" {min} {max} bind:value={minVal} {step} />
		<input type="range" class="max" {min} {max} bind:value={maxVal} {step} />
	</div>

	<div class="range-price">
		<label for="min">Min</label>
		<NumberWithUnits name="min" {min} {max} bind:value={minVal} />
		<label for="max">Max</label>
		<NumberWithUnits name="max" {min} {max} bind:value={maxVal} />
	</div>
</div>

<style>
	.range-slider {
		height: 5px;
		position: relative;
		background-color: #e1e9f6;
		border-radius: 2px;
	}
	.range-selected {
		height: 100%;
		left: 30%;
		right: 30%;
		position: absolute;
		border-radius: 5px;
		background-color: #1b53c0;
	}

	.range-input {
		position: relative;
	}
	.range-input input {
		position: absolute;
		width: 100%;
		height: 5px;
		top: -7px;
		background: none;
		pointer-events: none;
		-webkit-appearance: none;
		-moz-appearance: none;
	}
	.range-input input::-webkit-slider-thumb {
		height: 20px;
		width: 20px;
		border-radius: 50%;
		border: 3px solid #1b53c0;
		background-color: #fff;
		pointer-events: auto;
		-webkit-appearance: none;
	}
	.range-input input::-moz-range-thumb {
		height: 15px;
		width: 15px;
		border-radius: 50%;
		border: 3px solid #1b53c0;
		background-color: #fff;
		pointer-events: auto;
		-moz-appearance: none;
	}

	.range-price {
		margin: 30px 0;
		width: 100%;
		display: flex;
		justify-content: center;
		align-items: center;
	}
	.range-price label {
		margin-right: 5px;
	}
	.range-price input {
		width: 40px;
		padding: 5px;
	}
	.range-price input:first-of-type {
		margin-right: 15px;
	}
</style>
