<script>
	// @ts-nocheck
	/**
	 * The one time zone picker: the import row, a column's Properties row and Settings
	 * "Show times in" all use it, so the three offer the same choices in the same order.
	 *
	 * Values (utils/time/zones.js): 'utc', a fixed offset '+13:00', an IANA name, and, with
	 * `columnOption`, 'column' ("Each column's own zone"). The computer's own zone is offered
	 * near the top ("Pacific/Auckland (this computer)") and stores its IANA name, never a 'local' marker, so a session reads the same everywhere.
	 *
	 * Props:
	 *  - value: the selected zone (a value not in the lists, e.g. a zone this browser does not
	 *      know, is kept as its own option so it is shown rather than silently replaced)
	 *  - onChange(zone): called with the new value
	 *  - utcLabel: the label of 'utc' ("UTC", or "As written (no zone, UTC)" for a column)
	 *  - columnOption: offer 'column' first
	 *  - suggested: a zone to mark "(detected)"
	 *  - ariaLabel, testid, disabled, title
	 */
	import {
		UTC_ZONE,
		COMMON_FIXED_OFFSETS,
		allIanaZones,
		localZone,
		normalizeZone
	} from '$lib/utils/time/zones.js';
	import { COLUMN_ZONE } from '$lib/utils/time/displayTime.js';

	let {
		value = UTC_ZONE,
		onChange = () => {},
		utcLabel = 'UTC',
		columnOption = false,
		suggested = null,
		ariaLabel = 'Time zone',
		testid = undefined,
		disabled = false,
		title = undefined
	} = $props();

	const zones = allIanaZones();
	const mine = localZone();

	// The select's value is the stored value, normalised so '+0530' selects '+05:30'.
	let selected = $derived(
		value === COLUMN_ZONE && columnOption
			? COLUMN_ZONE
			: (normalizeZone(value) ?? value ?? UTC_ZONE)
	);
	let known = $derived(
		selected === COLUMN_ZONE ||
			selected === UTC_ZONE ||
			COMMON_FIXED_OFFSETS.includes(selected) ||
			zones.includes(selected)
	);

	function mark(z) {
		return suggested && normalizeZone(suggested) === z ? ' (detected)' : '';
	}
</script>

<select
	class="tz-select"
	aria-label={ariaLabel}
	data-testid={testid}
	{disabled}
	{title}
	value={selected}
	onchange={(e) => onChange(e.currentTarget.value)}
>
	{#if columnOption}
		<option value={COLUMN_ZONE}>Each column's own zone</option>
	{/if}
	<option value={UTC_ZONE}>{utcLabel}{mark(UTC_ZONE)}</option>
	{#if mine !== UTC_ZONE}
		<option value={mine}>{mine} (this computer){mark(mine)}</option>
	{/if}
	{#if !known}
		<option value={selected}>{selected}</option>
	{/if}
	<optgroup label="Fixed offset (no daylight saving)">
		{#each COMMON_FIXED_OFFSETS as z (z)}
			<option value={z}>UTC{z}{mark(z)}</option>
		{/each}
	</optgroup>
	<optgroup label="Time zone (follows daylight saving)">
		{#each zones as z (z)}
			<option value={z}>{z}{mark(z)}</option>
		{/each}
	</optgroup>
</select>

<style>
	.tz-select {
		min-width: 0;
		max-width: 100%;
	}
</style>
