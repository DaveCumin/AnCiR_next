<script>
	// @ts-nocheck
	import { formatDate } from './TimeUtils';
	import dayjs from './dayjsSetup.js';

	let { thedatetime = $bindable(), label = 'Date and Time:' } = $props();

	const inputId = $props.id();
	let picker = $state();

	function showpicker() {
		picker.showPicker();
	}

	function handleInput(event) {
		// Update thedatetime — keep parity with the previous Luxon impl, which
		// returned a DateTime instance. Callers downstream that need ms can
		// use `.valueOf()` / `.toISOString()`.
		thedatetime = dayjs(event.target.value);
	}

	//This is needed to make the picker have the correct time
	const inputDate = $derived(dayjs(thedatetime).format('YYYY-MM-DD[T]HH:mm'));
</script>

<div class="datetimeselect">
	<label for={inputId}>{label}</label>
	<button type="button" onclick={showpicker}>{formatDate(thedatetime)}</button>
	<input
		id={inputId}
		bind:this={picker}
		class="selection"
		type="datetime-local"
		value={inputDate}
		oninput={handleInput}
	/>
	<button type="button" class="icon" aria-label="Open the date picker" onclick={showpicker}
		>🗓️</button
	>
</div>

<style>
	button {
		margin: 0;
		padding: 0;
		border: none;
		background: none;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	.datetimeselect {
		cursor: pointer;
		display: inline-flex;
	}
	.selection {
		width: 0;
		height: 0;
		margin: 0px;
		padding: 0px;
		position: relative;
		left: 10px;
		z-index: 0;
	}
	.icon {
		position: relative;
		cursor: pointer;
	}
</style>
