<script module>
	// @ts-nocheck
	import Icon from '$lib/icons/Icon.svelte';
	import { ImportData } from '$lib/data/dataTree.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import { tick } from 'svelte';

	let importPreview = $state();
	let importReady = $state(false);
	let hasHeader = $state(true);
	let delimiter = $state('');
	let targetFile = $state();
	let buttonText = $derived(targetFile ? 'Change file' : 'Choose File');

	let showImportModal = $state(false);
	let fileInput = $state();

	export function openImportModal() {
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

	async function chooseFile() {
		ImportData.utils.openFileChoose();
		fileInput.click();
	}

	async function confirmImport() {
		await ImportData.utils.loadData(targetFile, hasHeader, delimiter);
		showImportModal = false;
		importReady = false;
		importPreview = '';
	}
</script>

<script>
	$effect(() => {
		if (showImportModal && fileInput) {
			//click file input on show
			fileInput.click();
		}
	});
</script>

<Modal bind:showModal={showImportModal}>
	{#snippet header()}
		<div class="heading">
			<h2>Import Data</h2>
			<!-- <button class="btn" onclick={chooseFile}>Choose File</button> -->

			<div class="choose-file-container">
				<button class="choose-file-button" onclick={chooseFile}>{buttonText}</button>
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
			bind:this={fileInput}
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
		</div>
	{/snippet}

	{#snippet button()}
		<div class="dialog-button-container">
			{#if importReady}
				<button class="dialog-button" onclick={confirmImport}>Confirm Import</button>
			{/if}
		</div>
	{/snippet}
</Modal>
