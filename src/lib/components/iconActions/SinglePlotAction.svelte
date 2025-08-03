<script>
	// @ts-nocheck
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';
	import SavePlot from './SavePlot.svelte';
	import { core } from '$lib/core/core.svelte';
	import { removePlot } from '$lib/core/Plot.svelte';

	let {
		showDropdown = $bindable(false),
		dropdownTop = 0,
		dropdownLeft = 0,
		plotId = $bindable(null)
	} = $props();
	let showModal = $state(false);

	//child item - Save
	let showSavePlot = $state(false);
	let dropdownTop_child = $derived(dropdownTop + 5);
	let dropdownLeft_child = $derived(dropdownLeft + 200);

	let keepopen = $state(true);
	function closeAll() {
		showSavePlot = false;
		//TODO: need to keep this open if it was a mouseleave, not a click... the SavePlot doesn't distinguish
		showDropdown = false;
	}
</script>

<Dropdown bind:showDropdown top={dropdownTop} left={dropdownLeft}>
	{#snippet groups()}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="dropdown-action"
			onmouseover={(e) => {
				showSavePlot = true;
			}}
		>
			<button> Save </button>
		</div>

		<div
			class="dropdown-action"
			onclick={() => removePlot(plotId)}
			onmouseover={(e) => {
				console.log('over delete');
				showSavePlot = false;
			}}
		>
			<button> Delete </button>
		</div>
	{/snippet}
</Dropdown>

<SavePlot
	bind:showDropdown={showSavePlot}
	dropdownTop={dropdownTop_child}
	dropdownLeft={dropdownLeft_child}
	Id={'plot' + plotId}
	on:Closed={closeAll}
	on:mouseOut={() => (showSavePlot = false)}
/>
