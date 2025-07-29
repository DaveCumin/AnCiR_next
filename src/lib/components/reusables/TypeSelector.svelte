<script>
    // @ts-nocheck

	import Icon from '$lib/icons/Icon.svelte';
    import Dropdown from '$lib/components/reusables/Dropdown.svelte';

	let { value = $bindable() } = $props();

	const options = [
		{ label: 'Time', value: 'time', icon: 'clock' },
		{ label: 'Number', value: 'number', icon: 'math' },
		{ label: 'Number', value: 'value', icon: 'math' },
		{ label: 'Category', value: 'category', icon: 'list' }
	];

	let open = $state(false);

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
        console.log("clicked");

        open = !open;

		e.stopPropagation();

		const rect = e.currentTarget.getBoundingClientRect();
		top = rect.bottom;
		left = rect.left;
        
		recalculateDropdownPosition();
        requestAnimationFrame(() => {
			showDropdown = true;
		});
	}

	function selectOption(option) {
		value = option.value;
		showDropdown = false;
	}
</script>

<div class="type-selector" onclick={toggleDropdown}>

	<div class="type-selector">
    {#if (value)}
        {@const iconName = options.find(o => o.value === value).icon}
        <button class="icon" onclick={toggleDropdown}>
            {#key iconName}
			<Icon name={iconName} width={16} height={16} className="control-component-icon"/>
			{/key}
        </button>

        {#if open}
            <Dropdown bind:showDropdown={showDropdown} top={top} left={left}>
                {#snippet groups()}
                    {#each options as option}
                        <div
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
	}

	/* Dropdown list styling */
	.dropdown {
		position: absolute;
		top: 110%;
		left: 0;
		min-width: 120px;
		background: var(--color-lightness-97);
		border: 1px solid var(--color-lightness-85);
		border-radius: 4px;
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);
		padding: 0.25rem 0;
		margin: 0;
		list-style: none;
		z-index: 100;
	}

	.dropdown li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.25rem 0.5rem;
		cursor: pointer;
		transition: background-color 0.2s ease;
	}

	.dropdown li:hover {
		background-color: var(--color-lightness-95);
	}

	.dropdown li.selected {
		background-color: var(--color-lightness-90);
		font-weight: 500;
	}
</style>