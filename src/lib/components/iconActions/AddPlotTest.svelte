<script>
	// @ts-nocheck
	import { core, pushObj, appConsts } from '$lib/core/core.svelte';
	import { Plot } from '$lib/core/Plot.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';

	let { showModal = false } = $props();

	let plotType = $state();
	let plotName = $derived.by(() => {
		return plotType + '_' + Math.round(Math.random() * 10, 2);
	});

	function openModal(type) {
		showModal = true;
		plotType = type;
	}

	let xCol = $state();
	let yCol = $state();

	function confirmImport() {
		const newPlot = new Plot({ name: plotName, type: plotType });
		newPlot.plot.addData( {
			x: {refId: xCol},
			y: {refId: yCol}
		});
		pushObj(newPlot);

		showModal = false;
	}

</script>

<Modal bind:showModal>
	{#snippet header()}
		<div class="heading">
			<h2>Create New {plotType}</h2>

			<div class="choose-file-container">
				<div>
					<label for="plotType">Choose a Plot Type:</label>

					<select bind:value={plotType} name="plotType" id="plot-type">
						<option value="actogram">Actogram</option>
						<option value="periodogram">Periodogram</option>
						<option value="scatterplot">ScatterPlot</option>
					</select>
				</div>

				<div class="selected">
					<p class="selected-preview">
						Name: {plotName}
						<!-- TODO: double click to change name -->
					</p>
				</div>
			</div>
		</div>
	{/snippet}

	{#snippet children()}
		<div class="import-container">
			<div class="preview-placeholder">
				<!-- TODO: make these draggable? -->
				<!-- TODO: interface control -->
				<div>
					<label for="xCol">x:</label>
					<select bind:value={xCol} name="xCol" id="plot-x">
						<option value="" disabled selected>Select x</option>
						{#each core.tables as table (table.id)}
							{#each table.columns as col (col.id)}
								<option value={col.id}>{table.name + ': ' + col.name}</option>
							{/each}
						{/each}
					</select>
				</div>
				<div>
					<label for="yCol">y:</label>
					<select bind:value={yCol} name="yCol" id="plot-y">
						<option value="" disabled selected>Select y</option>
						{#each core.tables as table (table.id)}
							{#each table.columns as col (col.id)}
								<option value={col.id}>{table.name + ': ' + col.name}</option>
							{/each}
						{/each}
					</select>
				</div>
			</div>

			<div class="import-button-container">
				<button class="import-button" onclick={confirmImport}>Confirm Import</button>
			</div>
		</div>
	{/snippet}
</Modal>