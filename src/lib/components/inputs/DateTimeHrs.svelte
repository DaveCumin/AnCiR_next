<script>
	import { DateTime } from 'luxon';
	let { value = $bindable(), zone = 'utc', hours = false, onChange = () => {} } = $props();

	// Use $derived to automatically update when value changes
	let displayDate = $derived(DateTime.fromMillis(value, { zone: zone }).toISO().substring(0, 16));
	let displayHours = $derived(value / 3600000);

	// Store local editing state
	let editingDate = $state(displayDate);
	let editingHours = $state(displayHours);

	// Sync editing state when value changes externally
	$effect(() => {
		editingDate = displayDate;
		editingHours = displayHours;
	});

	function dateToValue() {
		value = DateTime.fromISO(editingDate, { zone: zone }).toMillis();
		onChange(value);
	}

	function numberToValue() {
		value = editingHours * 3600000;
		onChange(value);
	}
</script>

{#if hours}
	<input type="number" bind:value={editingHours} oninput={numberToValue} />
{:else}
	<input type="datetime-local" bind:value={editingDate} oninput={dateToValue} />
	<!-- <input type="text" bind:value={zone} oninput={dateToValue} /> -->
{/if}

<!-- <p>{displayDate}</p>
<p>{displayHours}</p>
<p>{Number(new Date(value))}</p>
<p><strong>{value}</strong></p> -->
