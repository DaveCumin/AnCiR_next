<!-- 
 TODO:
 need to fix dropdown ui ()
 dynamic import and export (cores)
 add import on top of existing?
-->

<script>
	// @ts-nocheck
	import { core, pushObj, outputCoreAsJson } from '$lib/core/core.svelte';
	import { Column } from '$lib/core/Column.svelte';
	import { Table } from '$lib/core/Table.svelte.js';
	import { Plot } from '$lib/core/Plot.svelte';

	import Modal from '$lib/components/reusables/Modal.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';

	let showImportModal = $state(false);
	let showExportModal = $state(false);

	let importReady = $state(false);
	let importPreview = $state();

	let fileInput;
	let fileName = $state();

	let jsonData = $state();
	let error = '';

	let { showDropdown = $bindable(false), dropdownTop = 0, dropdownLeft = 0 } = $props();

	function openImportModal() {
		showImportModal = true;
	}

	function openExportModal() {
		showExportModal = true;
	}

	function chooseFile() {
		fileInput.click();
	}

	function handleFileChange(event) {
		const file = event.target.files[0];
		importPreview = false;

		if (!file) return;

		fileName = file.name;

		const reader = new FileReader();
		reader.onload = (e) => {
			try {
				jsonData = JSON.parse(e.target.result);
				error = '';
			} catch (err) {
				error = 'Invalid JSON file';
				jsonData = null;
			}
		};

		reader.readAsText(file);

		importReady = true;
	}

	function importJson() {
		//reset existing workflow
		core.data = [];
		core.tables = [];
		core.plots = [];

		jsonData.data.map((datajson) => {
			pushObj(Column.fromJSON(datajson));
		});

		jsonData.tables.map((tablejson) => {
			pushObj(Table.fromJSON(tablejson));
		});

		jsonData.plots.map((plotjson) => {
			core.plots.push(Plot.fromJSON(plotjson));
		});

		showImportModal = false;
		importReady = false;
		showDropdown = false;
	}

	function exportJson() {
		const jsonStr = outputCoreAsJson();

		const blob = new Blob([jsonStr], { type: 'application/json' });
		const url = URL.createObjectURL(blob);

		// Create temp <a> element and auto click it
		const a = document.createElement('a');
		a.href = url;
		a.download = 'workflow.json';
		document.body.appendChild(a);
		a.click();

		document.body.removeChild(a);
		URL.revokeObjectURL(url);

		showDropdown = false;
	}
</script>

<Dropdown bind:showDropdown top={dropdownTop} left={dropdownLeft}>
	{#snippet groups()}
		<div class="action">
			<button onclick={openImportModal}> Import Working JSON </button>
		</div>

		<div class="action">
			<button onclick={exportJson}> Export Working JSON </button>
		</div>
	{/snippet}
</Dropdown>

<Modal bind:showModal={showImportModal}>
	{#snippet header()}
		<div class="heading">
			<h2>Import Workflow</h2>

			<div class="choose-file-container">
				<button class="choose-file-button" onclick={chooseFile}> Upload File </button>
				<div class="filename">
					<p class="filename-preview">
						Selected:
						{#if fileName}
							{fileName}
						{/if}
					</p>
				</div>
			</div>
		</div>

		<!-- input style not shown -->
		<input
			bind:this={fileInput}
			type="file"
			accept=".json"
			onchange={handleFileChange}
			style="display: none;"
		/>
	{/snippet}

	{#snippet children()}
		<div class="import-container">
			<div class="preview-placeholder">
				{#if jsonData}
					<!-- <p>Preview Data</p> -->
					<div class="preview-table-wrapper">
						<!-- {@html importPreview} -->
						<p>Tables imported: {jsonData.tables.length}</p>
						<p>Plots imported: {jsonData.plots.length}</p>
					</div>
				{:else}
					<!-- <p>Choose file to preview data</p> -->
				{/if}
			</div>

			
		</div>
	{/snippet}

	{#snippet button()}
		<div class="dialog-button-container">
			{#if importReady}
				<button class="dialog-button" onclick={importJson}>Confirm Import</button>
			{/if}
			<!-- ux^: could have an else state to reflect error -->
		</div>
	{/snippet}
</Modal>

<!-- potential modal for export? -->

<!-- <Modal bind:showModal={showExportModal}>
    {#snippet header()}
		<div class="heading">
			<h2>Export Workflow</h2>
			<div class="choose-file-container">
				<button class="choose-file-button" onclick={exportJson}>
					Export Current Workflow
				</button>
			</div>
			
		</div>
    {/snippet}
</Modal> -->

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
		min-height: 200px;
	}

	.filename-preview {
		color: var(--color-lightness-35);
		font-size: 14px;
	}

	/* preview table */
	:global(.preview-table-wrapper) {
		overflow-x: auto;
		margin-top: 1.5rem;
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
