<script>
	import { untrack } from 'svelte';

	let {
		value = $bindable(),
		label,
		options,
		optionsDisplay = options,
		other = false,
		placeholder = '',
		onChange = () => {}
	} = $props(); // options must be passed as array
	let otherValInternal = crypto.randomUUID().replaceAll('-', '').slice(0, 6);
	let selected = $state();
	let selectComponent = $state();
	let otherComponent = $state();
	// What the "Other" text field shows. Seeded from an incoming out-of-vocabulary
	// value so a saved custom entry is visible and editable, not invisible.
	let otherText = $state('');

	// Which preset `value` is, if any. The comparison is loose on purpose: a <select>
	// onchange hands back `e.target.value` as a STRING, so a numeric option (0.95) that
	// has been through the control once comes back as '0.95' and a strict match would
	// no longer find it.
	const matchIndex = $derived(
		Array.isArray(options) && value !== undefined && value !== null
			? options.findIndex((o) => o === value || String(o) === String(value))
			: -1
	);
	// A value outside the preset list is not a mistake when `other` is on: that option
	// exists precisely so a custom pattern (a stroke-dasharray such as '5,5') can be
	// typed. Treat it as a custom entry rather than leaving the <select> blank.
	const isCustom = $derived(
		other &&
			matchIndex < 0 &&
			value !== undefined &&
			value !== null &&
			value !== '' &&
			value !== otherValInternal
	);

	// Keep the control in step with `value`, including a value that arrives from a saved
	// session. `value` itself is NEVER written here: silently rewriting someone's saved
	// dash pattern to the nearest preset is worse than the blank select this fixes.
	$effect(() => {
		if (matchIndex >= 0) {
			// The canonical option, not `value`, so a stringified number re-selects its
			// own <option> instead of matching nothing.
			selected = options[matchIndex];
		} else if (isCustom) {
			selected = otherValInternal;
			// Strings only. A consumer that rejects a half-typed pattern by writing back a
			// sentinel (Line.svelte writes -1 for an invalid dasharray) must not overwrite
			// what the user is in the middle of typing.
			if (typeof value === 'string') {
				untrack(() => {
					if (otherText !== value) otherText = value;
				});
			}
		}
		// Otherwise leave `selected` alone: with `other` off there is nothing sensible to
		// show for an unknown value, and the user's own pick must not be clobbered.
	});
</script>

{#if label}
	<label for={label}>{label}:</label>
{/if}
<div class="select-container">
	<select
		bind:this={selectComponent}
		bind:value={selected}
		name={label}
		id={label}
		onchange={(e) => {
			value = e.target.value;
			if (value == otherValInternal) {
				otherComponent.focus();
			}
			onChange(e.target.value);
		}}
	>
		<option value="" disabled selected>Select {label}</option>
		{#each options as option, i (i)}
			<option value={option}>{optionsDisplay[i]}</option>
		{/each}
		{#if other}
			<option value={otherValInternal}>Other</option>
		{/if}
	</select>
	{#if selected == otherValInternal}
		<input
			bind:this={otherComponent}
			class="other-input"
			type="text"
			{placeholder}
			bind:value={otherText}
			oninput={(e) => {
				value = e.target.value;
				onChange(e.target.value);
			}}
		/>
	{/if}
</div>

<style>
	.other-input {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		width: calc(100% - 1rem);

		padding: 2px;
		border-right: none;
		z-index: 10;
	}
	.other-input:hover {
		outline: none;
		border-right: none;
	}

	.other-input:focus {
		outline: none;
		border-right: none;
	}
	.other-input:focus-visible {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}
	.select-container {
		position: relative;
	}
</style>
