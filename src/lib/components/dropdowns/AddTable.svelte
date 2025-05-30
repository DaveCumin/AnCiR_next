<script>
	// @ts-nocheck
	import { appState } from '$lib/core/theCore.svelte';
	import Icon from '$lib/icon/Icon.svelte';
	import { simulateData, ImportData } from '$lib/models/data/dataTree.svelte';
	import Modal from '../modal/Modal.svelte';

	let showModal = $state(false);
	let preview = $state();
	let importReady = $state(false);

    const { top = 0, left = 0 } = $props();

	function openModal() {
		showModal = true;
		// appState.addIcon = ''; // not working, close dropdown but modal not invoked
	}

	async function onFileChange(e) {
		ImportData.setFilesToImport(e.target.files);
		await ImportData.utils.parseFile(6);
		preview = ImportData.utils.makeTempTable(ImportData.getTempData());
		importReady = true;
	}

	function chooseFile() {
		ImportData.utils.openFileChoose();
	}

	async function confirmImport() {
		await ImportData.utils.loadData();
		showModal = false; 
		importReady = false;
		preview = '';
		appState.addIcon = ''; // works but not the best ux
	}
</script>

<div class="dropdown" style="top: {top}px; left: {left + 12}px">
    <div class="group">
		<div class="action">
			<button onclick={openModal}>
				Import Data
			</button>
		</div>
		
		<div class="action">
			<button onclick={simulateData}>
				Simulate Data
			</button>
		</div>
	</div>
</div>

<Modal bind:showModal>
	{#snippet header()}
		<div class="heading">
			<h2>Import Data</h2>
			<!-- <button class="btn" onclick={chooseFile}>Choose File</button> -->
			
			<div class="choose-file-container">
				<button class="choose-file-button" onclick={chooseFile}>
					Upload File
				</button>
				<div class="filename">
					<p class="filename-preview">
						Selected: 
						{#if ImportData.getFilesToImport()?.[0]}
							{ImportData.getFilesToImport()[0].name}
						{/if}
					</p>
				</div>
			</div>
			
		</div>

		<!-- input style not shown -->
		<input id="fileInput" type="file" accept=".csv,.awd" onchange={onFileChange} style="display: none;"/>
	{/snippet}

	{#snippet children()}
		<div class="import-container">
			<div class="preview-placeholder">
				{#if preview}
					<!-- <p>Preview Data</p> -->
					<div class="preview-table-wrapper">
						{@html preview}
					</div>
				{:else}
					<!-- <p>Choose file to preview data</p> -->
				{/if}
			</div>

			<div class="import-button-container">
				<!-- Add this if you define `let importReady = true;` inside <script> -->
				{#if importReady}
					<button class="import-button" onclick={confirmImport}>Confirm Import</button>
				{/if}
			</div>
		</div>
	{/snippet}
</Modal>



<style>
	.dropdown {
		position: fixed;
		z-index: 999;
		width: 200px;

		display: flex;
		flex-direction: column;
		
		margin-top: 4px;
		margin-left: 8px;

		background-color: white;
		border-radius: 4px;
		border: 1px solid var(--color-lightness-85);

		/* box-shadow: 0 4px 8px 0 var(--color-lightness-85), 0 6px 10px 0 var(--color-lightness-95); */
	}

	.group {
		display: flex;
		flex-direction: column;
	}

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
		margin-bottom: 1rem;
	}

	:global(.preview-table-wrapper table) {
		width: 100%;
		border-collapse: collapse;
		font-size: 14px;
		background-color: white;
	}

	/* :global(.preview-table-wrapper thead) {
		position: sticky;
		top: 0;
		z-index: 1;
	} */

	:global(.preview-table-wrapper th) {
		padding: 8px 12px;
		border: 1px solid var(--color-lightness-85);
		background-color: var(--color-lightness-95);
		text-align: left;
	}


	:global(.preview-table-wrapper td) {
		padding: 8px 12px;
		border: 1px solid var(--color-lightness-85);
		text-align: left;
	}

	/* :global(.preview-table-wrapper tbody tr:hover) {
		background-color: var(--color-lightness-85); 
	}*/

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