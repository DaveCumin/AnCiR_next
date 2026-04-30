<script>
	// @ts-nocheck
	import { formatDate } from './TimeUtils';
	import dayjs from './dayjsSetup.js';

	//params
	export let thedatetime;
	export let label = 'Date and Time:';

	let picker;

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
	$: inputDate = getInputDate(thedatetime);
	function getInputDate(dateIN) {
		return dayjs(dateIN).format('YYYY-MM-DD[T]HH:mm');
	}
</script>

<div class="datetimeselect">
	<!-- svelte-ignore a11y-label-has-associated-control -->
	<label>{label}</label>
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<span onclick={showpicker}>{formatDate(thedatetime)}</span>
	<input
		bind:this={picker}
		class="selection"
		type="datetime-local"
		value={inputDate}
		on:input={handleInput}
	/>
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<span class="icon" onclick={showpicker}>🗓️</span>
</div>

<style>
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
