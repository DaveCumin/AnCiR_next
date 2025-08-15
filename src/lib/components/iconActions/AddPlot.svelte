<script>
	// @ts-nocheck
	import { core, pushObj, appConsts } from '$lib/core/core.svelte';
	import { Plot } from '$lib/core/Plot.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import Dropdown from '../reusables/Dropdown.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import AttributeSelect from '../inputs/AttributeSelect.svelte';
	import MakeNewPlotsMultiple from '../views/modals/MakeNewPlots_Multiple.svelte';
	import MakeNewPlot from '../views/modals/MakeNewPlot.svelte';

	let { showDropdown = $bindable(false), dropdownTop = 0, dropdownLeft = 0 } = $props();

	let showSingle = $state(false);
	let showMultiple = $state(false);

	function capitalise(str) {
		return str.charAt(0).toUpperCase() + str.slice(1);
	}
</script>

<Dropdown bind:showDropdown top={dropdownTop} left={dropdownLeft}>
	{#snippet groups()}
		<div class="action" onclick={(e) => (showSingle = true)}>
			<button> Create New Plot </button>
		</div>
		<div class="action" onclick={(e) => (showMultiple = true)}>
			<button> Create New Plots </button>
		</div>
	{/snippet}
</Dropdown>

<MakeNewPlotsMultiple bind:showModal={showMultiple} />
<MakeNewPlot bind:showModal={showSingle} />

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
</style>
