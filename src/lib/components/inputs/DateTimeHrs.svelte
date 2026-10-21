<script>
	import { untrack } from 'svelte';
	import dayjs from '$lib/utils/time/dayjsSetup.js';
	import { getClockZone, zonedDayjs, parseShownTime } from '$lib/utils/time/displayTime.js';

	// `label` names the two fields for assistive tech ("Start time (date)", "Start time (time)").
	// The widget is two inputs, so one wrapping <label> cannot name it; each field gets its own.
	// `frame`: the column (or its time frame) the value is a time of. Given, the fields read and
	// write the time as that column's times are SHOWN (its zone, or "Show times in"), so an
	// axis limit reads like the axis. Without it (and without `zone`) the fields use the
	// clock-time zone, as before per-column zones (phase 2 gives those callers a column).
	let {
		value = $bindable(),
		zone = null,
		frame = null,
		onChange = () => {},
		label = ''
	} = $props();

	let effectiveZone = $derived(zone ?? getClockZone());
	let shown = $derived(zone == null && frame != null);

	function inZone(input) {
		if (shown) return zonedDayjs(input instanceof Date ? input.getTime() : input, frame);
		// Anchor a Date or ms value to `effectiveZone`. UTC takes a fast path
		// because dayjs.utc avoids the Intl.DateTimeFormat lookup.
		if (effectiveZone === 'utc') return dayjs.utc(input);
		return dayjs(input).tz(effectiveZone);
	}

	// Normalize value (supports Date object or timestamp)
	let dt = $derived.by(() => {
		if (value instanceof Date) return inZone(value);
		if (typeof value === 'number') return inZone(value);
		if (shown) return zonedDayjs(Date.now(), frame);
		return effectiveZone === 'utc' ? dayjs.utc() : dayjs().tz(effectiveZone);
	});

	let displayDate = $derived(dt.format('YYYY-MM-DD'));
	let displayTime = $derived(dt.format('HH:mm'));

	// Local editing state. Seeded once from the value; the effect below keeps each field in step
	// with the value while it is not being typed in.
	let editingDate = $state(untrack(() => displayDate));
	let editingTime = $state(untrack(() => displayTime));

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
		if (shown) {
			const ms = parseShownTime(wallClock, null, frame);
			if (Number.isFinite(ms)) {
				value = ms;
				onChange(ms);
			}
			return;
		}
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
		aria-label={label ? `${label} (date)` : 'Date'}
		bind:value={editingDate}
		onchange={updateValue}
		onfocus={() => (dateFocused = true)}
		onblur={() => (dateFocused = false)}
	/>

	<input
		type="time"
		aria-label={label ? `${label} (time)` : 'Time'}
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
		gap: var(--space-2);
	}

	/* Pin the dense-UI sizing (rather than inheriting) so the date/time inputs
	   render identically everywhere — e.g. the Split node's larger-font context
	   was ballooning these vs. the same control in the plot panel. */
	input {
		width: 100%;
		box-sizing: border-box;
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-sm);
		font-family: inherit;
		color: var(--color-lightness-25);
		border: 1px solid var(--color-lightness-80);
		border-radius: var(--radius-sm);
	}

	input:focus {
		outline: none;
		border-color: var(--color-accent);
	}
</style>
