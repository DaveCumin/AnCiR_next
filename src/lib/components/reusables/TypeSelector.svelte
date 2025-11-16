<script>
	// @ts-nocheck

	import Icon from '$lib/icons/Icon.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';

	let { value = $bindable() } = $props();

	const options = [
		{ label: 'Time', value: 'time', icon: 'clock' },
		{ label: 'Number', value: 'number', icon: 'math' },
		{ label: 'Bin', value: 'bin', icon: 'table' },
		{ label: 'Category', value: 'category', icon: 'list' }
	];

	let selected = $state();

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
	}
</script>

<div class="type-selector" onclick={toggleDropdown}>
	<div class="type-selector">
		{#if value}
			{@const iconName = options.find((o) => o.value === value).icon}
			<button class="icon" onclick={(e) => toggleDropdown(e)}>
				{#key iconName}
					<Icon name={iconName} width={16} height={16} className="static-icon" />
				{/key}
			</button>

			{#if open}
				<Dropdown bind:showDropdown {top} {left}>
					{#snippet groups()}
						{#each options as option}
							<div
								class="option dropdown-action"
								class:selected={option.value === value}
								onclick={(e) => selectOption(e, option)}
							>
								<button class="icon">
									<Icon name={option.icon} width={14} height={14} />
								</button>
								<span>{option.label}</span>
							</div>
						{/each}
					{/snippet}
				</Dropdown>
			{/if}
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
		border-radius: 4px;
		background-color: var(--color-lightness-90);
	}

	.option {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;
	}
</style>
