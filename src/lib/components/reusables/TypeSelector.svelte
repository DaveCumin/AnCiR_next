<script>
	// @ts-nocheck

	import Icon from '$lib/icons/Icon.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';

	let { value = $bindable(), onChange = () => {} } = $props();

	const allOptions = [
		{ label: 'Time', value: 'time', icon: 'clock' },
		{ label: 'Number', value: 'number', icon: 'math' },
		{ label: 'Bin', value: 'bin', icon: 'table' },
		{ label: 'Category', value: 'category', icon: 'list' }
	];

	const options = $derived(
		value === 'bin' ? allOptions : allOptions.filter((o) => o.value !== 'bin')
	);
	// A type with no entry above (an older or unknown one) still renders, with a neutral icon.
	const current = $derived(
		allOptions.find((o) => o.value === value) ?? { label: String(value), value, icon: 'math' }
	);

	let btnRef;
	let showDropdown = $state(false);
	let top = $state(0);
	let left = $state(0);

	function recalculateDropdownPosition() {
		if (!btnRef) return;
		const rect = btnRef.getBoundingClientRect();

		top = rect.top + window.scrollY;
		left = rect.right + window.scrollX + 12;
	}

	function toggleDropdown(e) {
		e.preventDefault();
		e.stopPropagation();

		if (value === 'bin') return;

		const rect = e.currentTarget.getBoundingClientRect();
		top = rect.bottom;
		left = rect.left;

		recalculateDropdownPosition();
		showDropdown = true;
	}

	function selectOption(e, option) {
		e.preventDefault();
		e.stopPropagation();
		value = option.value;
		showDropdown = false;
		onChange(option.value);
	}
</script>

<div class="type-selector" onclick={toggleDropdown}>
	<div class="type-selector">
		{#if value}
			<button
				class="icon"
				aria-label={`Type: ${current.label}. Change type`}
				aria-expanded={showDropdown}
				onclick={(e) => toggleDropdown(e)}
			>
				{#key current.icon}
					<Icon name={current.icon} width={16} height={16} className="static-icon" />
				{/key}
			</button>

			<!-- Dropdown shows and hides itself from showDropdown; no extra guard is needed. -->
			<Dropdown bind:showDropdown {top} {left}>
				{#snippet groups()}
					{#each options as option (option.value)}
						<!-- The row takes the mouse; its button (named, so it is announced) takes
						     the keyboard and its click bubbles up to the row. -->
						<div
							class="option dropdown-action"
							class:selected={option.value === value}
							onclick={(e) => selectOption(e, option)}
						>
							<button class="icon" type="button" aria-label={option.label}>
								<Icon name={option.icon} width={14} height={14} />
							</button>
							<span>{option.label}</span>
						</div>
					{/each}
				{/snippet}
			</Dropdown>
		{/if}
	</div>
</div>

<style>
	.type-selector {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;

		z-index: inherit;

		margin: 0;
		padding: 0;
	}

	.type-selector button:hover {
		border-radius: var(--radius-sm);
		background-color: var(--color-lightness-90);
	}

	.option {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;
	}
</style>
