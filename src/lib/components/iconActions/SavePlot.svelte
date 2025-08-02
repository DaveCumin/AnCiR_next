<script>
	// @ts-nocheck
	import { core, pushObj, appConsts } from '$lib/core/core.svelte';
	import { Plot } from '$lib/core/Plot.svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';

	import { convertToImage, saveMultipleAsImage } from '$lib/components/plotbits/helpers/save.js';

	let { showDropdown = $bindable(false), dropdownTop = 0, dropdownLeft = 0, Id } = $props();

	let showModal = $state(false);
	let plotType = $state();
	let plotName = $derived.by(() => {
		return plotType + '_' + Math.round(Math.random() * 10, 2);
	});
	function openModal(type) {
		showModal = true;
		plotType = type;
	}
</script>

<Dropdown bind:showDropdown top={dropdownTop} left={dropdownLeft}>
	{#snippet groups()}
		{#each ['svg', 'png', 'jpeg'] as type}
			{#if Id.length > 0}
				<div
					class="action"
					onclick={() => {
						saveMultipleAsImage(Id, type);
					}}
				>
					<button>
						{type}
					</button>
				</div>
			{:else}
				<div
					class="action"
					onclick={() => {
						convertToImage(Id, type);
					}}
				>
					<button>
						{type}
					</button>
				</div>
			{/if}
		{/each}
	{/snippet}
</Dropdown>

<style>
	.action button {
		margin: 0.6em;
		font-size: 14px;
	}

	.action:hover {
		background-color: var(--color-lightness-95);
	}

	button {
		background-color: transparent;
		border: none;
		text-align: inherit;
		font: inherit;
		border-radius: 0;
		appearance: none;

		cursor: pointer;
	}

	.heading {
		display: flex;
		flex-direction: column;
	}
</style>
