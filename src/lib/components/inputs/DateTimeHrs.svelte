<script>
	import dayjs from '$lib/utils/time/dayjsSetup.js';
	import { getDisplayZone } from '$lib/utils/time/displayTime.js';

	let { value = $bindable(), zone = null, onChange = () => {} } = $props();

	// Fall back to the app-wide display zone when no explicit zone is passed,
	// so changing appState.displayTimezone propagates to every input.
	let effectiveZone = $derived(zone ?? getDisplayZone());

	function inZone(input) {
		// Anchor a Date or ms value to `effectiveZone`. UTC takes a fast path
		// because dayjs.utc avoids the Intl.DateTimeFormat lookup.
		if (effectiveZone === 'utc') return dayjs.utc(input);
		return dayjs(input).tz(effectiveZone);
	}

	// Normalize value (supports Date object or timestamp)
	let dt = $derived.by(() => {
		if (value instanceof Date) return inZone(value);
		if (typeof value === 'number') return inZone(value);
		return effectiveZone === 'utc' ? dayjs.utc() : dayjs().tz(effectiveZone);
	});

	let displayDate = $derived(dt.format('YYYY-MM-DD'));
	let displayTime = $derived(dt.format('HH:mm'));

	// Local editing state
	let editingDate = $state(displayDate);
	let editingTime = $state(displayTime);

	// Track which field is being edited. We must NOT write the reparsed value back
	// into a field while the user is typing in it: doing so resets the native date
	// input's segment mid-entry and corrupts multi-digit years (typing 2026 gave
	// 1926). So sync from the parent value only for the field that isn't focused.
	let dateFocused = $state(false);
	let timeFocused = $state(false);

	$effect(() => {
		if (!dateFocused) editingDate = displayDate;
		if (!timeFocused) editingTime = displayTime;
	});

	function updateValue() {
		const wallClock = `${editingDate}T${editingTime}`;
		// Wall-clock interpretation: same string, different absolute instant
		// depending on the chosen zone.
		const newDt =
			effectiveZone === 'utc' ? dayjs.utc(wallClock) : dayjs.tz(wallClock, effectiveZone);
		if (newDt.isValid()) {
			const newValue = newDt.valueOf();
			value = newValue;
			onChange(newValue);
		}
	}
</script>

<div class="datetime-container">
	<input
		type="date"
		bind:value={editingDate}
		onchange={updateValue}
		onfocus={() => (dateFocused = true)}
		onblur={() => (dateFocused = false)}
	/>

	<input
		type="time"
		bind:value={editingTime}
		onchange={updateValue}
		onfocus={() => (timeFocused = true)}
		onblur={() => (timeFocused = false)}
	/>
</div>

<style>
	.datetime-container {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	input {
		width: 100%;
		padding: 8px;
		border: 1px solid var(--color-lightness-80);
		border-radius: var(--radius-sm);
	}
</style>
