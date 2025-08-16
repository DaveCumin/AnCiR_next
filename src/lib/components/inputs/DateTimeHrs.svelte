<script>
	import { DateTime } from 'luxon';
	let { value = $bindable(), zone = 'utc', hours = false } = $props();

	let displayDate = $state(DateTime.fromMillis(value, { zone: zone }).toISO().substring(0, 16));
	let displayHours = $state(Number(new Date(value)) / 3600000);

	function dateToValue() {
		value = DateTime.fromISO(displayDate, { zone: zone }).toMillis();
		displayHours = value / 3600000;
	}
	function numberToValue() {
		value = displayHours * 3600000;
		displayDate = DateTime.fromMillis(value, { zone: zone }).toISO().substring(0, 16);
	}
</script>

{#if hours}
	<input type="number" bind:value={displayHours} oninput={numberToValue} />
{:else}
	<input type="datetime-local" bind:value={displayDate} oninput={dateToValue} />
	<!-- <input type="text" bind:value={zone} oninput={dateToValue} /> -->
{/if}

<!-- <p>{displayDate}</p>
<p>{displayHours}</p>
<p>{Number(new Date(value))}</p>
<p><strong>{value}</strong></p> -->
