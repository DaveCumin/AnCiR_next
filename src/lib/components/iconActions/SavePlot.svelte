<script>
	// @ts-nocheck
	import { simulateData, ImportData } from '$lib/data/dataTree.svelte';
	import { core, pushObj, appConsts } from '$lib/core/core.svelte';
	import { Plot } from '$lib/core/Plot.svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';

	import { convertToImage } from '$lib/components/plotbits/helpers/save.js';
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
			<div class="action">
				<button
					onclick={() => {
						convertToImage(Id, type);
					}}
				>
					{type}
				</button>
			</div>
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

	.choose-file-container {
		height: 2em;
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 1rem;
	}

	.choose-file-button {
		background-color: var(--color-lightness-95);
		padding: 8px 12px;
		border-radius: 4px;

		font-size: 14px;
		text-align: center;
	}

	.choose-file-button:hover {
		background-color: var(--color-hover);
	}

	.preview-placeholder {
		width: 100%;
		min-height: 100px;
	}

	.selected-preview {
		color: var(--color-lightness-35);
		font-size: 14px;
	}

	.import-button-container {
		display: flex;
		justify-content: flex-end;
		/* margin-right: 1rem; */
	}

	.import-button {
		margin-top: 10px;
		background-color: var(--color-lightness-95);
		border-radius: 4px;
		padding: 10px;
		padding-right: 12px;

		font-size: 14px;
		text-align: center;
	}

	.import-button:hover {
		background-color: var(--color-hover);
	}
</style>
