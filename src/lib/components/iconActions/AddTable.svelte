<!-- TODO: Import data/table logic might need re-work -->
<script>
	// @ts-nocheck
	import Icon from '$lib/icons/Icon.svelte';
	import { simulateData, ImportData } from '$lib/data/dataTree.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';
	import { on } from 'svelte/events';

	let showImportModal = $state(false);
	let importPreview = $state();
	let importReady = $state(false);
	let hasHeader = $state(true);
	let delimiter = $state('');
	let targetFile = $state();

	let { showDropdown = $bindable(false), dropdownTop = 0, dropdownLeft = 0 } = $props();

	function openImportModal() {
		showImportModal = true;
		ImportData.utils.openFileChoose();
	}

	async function onFileChange(e) {
		targetFile = e.target.files[0];
		doPreview();
	}
	async function doPreview() {
		await ImportData.utils.parseFile(targetFile, 6, hasHeader, delimiter);
		importPreview = ImportData.utils.makeTempTable(ImportData.getTempData());
		importReady = true;
	}

	function chooseFile() {
		ImportData.utils.openFileChoose();
	}

	async function confirmImport() {
		await ImportData.utils.loadData(targetFile, hasHeader, delimiter);
		showImportModal = false;
		importReady = false;
		importPreview = '';
		showDropdown = false;
	}
</script>

<Dropdown bind:showDropdown top={dropdownTop} left={dropdownLeft}>
	{#snippet groups()}
		<div class="action">
			<button onclick={openImportModal}> Import Data </button>
		</div>

		<div class="action">
			<button onclick={simulateData}> Simulate Data </button>
			<!-- since we are handling simulation with a modal, doesn't matter if dropdown closes after action at this stage -->
		</div>
	{/snippet}
</Dropdown>

<Modal bind:showModal={showImportModal} onclose={() => (showDropdown = false)}>
	{#snippet header()}
		<div class="heading">
			<h2>Import Data</h2>
			<!-- <button class="btn" onclick={chooseFile}>Choose File</button> -->

			<div class="choose-file-container">
				<button class="choose-file-button" onclick={chooseFile}> Upload File </button>
				<div class="filename">
					<p class="filename-preview">
						Selected:
						{#if targetFile}
							{targetFile.name}
						{/if}
					</p>
				</div>
			</div>
		</div>

		<!-- input style not shown -->
		<input
			id="fileInput"
			type="file"
			accept=".csv,.awd,.txt"
			onchange={onFileChange}
			style="display: none;"
		/>
	{/snippet}

	{#snippet children()}
		<div class="import-container">
			<div class="preview-placeholder">
				{#if importPreview}
					<p>
						Header: <input type="checkbox" bind:checked={hasHeader} onchange={() => doPreview()} />
						Delimiter:
						<!-- <input bind:value={delimiter} type="text" oninput={() => doPreview()} /> -->
						<select bind:value={delimiter} onchange={() => doPreview()}>
							<option value="">auto</option>
							<option value=",">, (comma)</option>
							<option value=";">; (semicolon)</option>
							<option value="\t">Tab</option>
							<option value="|">| (pipe)</option>
							<option value=" ">(space)</option>
						</select>
					</p>
					<div class="preview-table-wrapper">
						{@html importPreview}
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
