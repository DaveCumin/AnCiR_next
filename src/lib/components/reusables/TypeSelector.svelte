<script>
	// @ts-nocheck

	import Icon from '$lib/icons/Icon.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';

	let { value = $bindable() } = $props();

	const options = [
		{ label: 'Time', value: 'time', icon: 'clock' },
		{ label: 'Number', value: 'number', icon: 'math' },
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
		requestAnimationFrame(() => {
			showDropdown = true;
		});
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
    {#if (value)}
        {@const iconName = options.find((o) => o.value === value).icon}
        <button class="icon" onclick={(e) => toggleDropdown(e)}>
            {#key iconName}
			<Icon name={iconName} width={16} height={16} className="control-component-icon"/>
			{/key}
        </button>

        {#if open}
            <Dropdown bind:showDropdown={showDropdown} top={top} left={left}>
                {#snippet groups()}
                    {#each options as option}
                        <div
							class="option dropdown-action"
                            class:selected={option.value === value}
                            onclick={() => selectOption(option)}
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
		display: inline-block;

		z-index: inherit;

		margin: 0;
		padding: 0;
	}

	.option-display {
		width: 20px;
		height: 20px;

		display: flex;
		align-items: center;
		justify-content: center;

		margin: 0 0 0 0;
		padding: 0;
	}

	.option-display:hover {
		border-radius: 4px;
		background-color: var(--color-lightness-90);
	}

	.option-display button {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;

		padding: 0;
		margin: 0;
		border: none;
		background: none;
		line-height: 0;

		margin: 0;
		padding: 0;
	}

	.option {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;
	}

	.option p {
		margin: 0;
		padding: 0;
		font-size: 14px;
		font-weight: normal;
		font-style: normal;
	}
</style>
