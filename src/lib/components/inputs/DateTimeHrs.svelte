<script>
	import { DateTime } from 'luxon';

	let { value = $bindable(), zone = 'utc', onChange = () => {} } = $props();

	// Normalize value (supports Date object or timestamp)
	let dt = $derived.by(() => {
		if (value instanceof Date) return DateTime.fromJSDate(value, { zone });
		if (typeof value === 'number') return DateTime.fromMillis(value, { zone });
		return DateTime.now();
	});

	let displayDate = $derived(dt.toISODate());
	let displayTime = $derived(dt.toISOTime({ suppressMilliseconds: true }).slice(0, 5));

	// Local editing state
	let editingDate = $state(displayDate);
	let editingTime = $state(displayTime);

	// Sync when parent value changes
	$effect(() => {
		editingDate = displayDate;
		editingTime = displayTime;
	});

	function updateValue() {
		const newDt = DateTime.fromISO(`${editingDate}T${editingTime}`, { zone });
		if (newDt.isValid) {
			const newValue = newDt.toMillis();
			value = newValue;
			onChange(newValue);
		}
	}
</script>

<div class="datetime-container">
	<input type="date" bind:value={editingDate} oninput={updateValue} />

	<input type="time" bind:value={editingTime} oninput={updateValue} />
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
		border: 1px solid #ccc;
		border-radius: 4px;
	}
</style>
