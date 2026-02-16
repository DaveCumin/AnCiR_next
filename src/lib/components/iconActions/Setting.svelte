<script module>
	export function exportJson() {
		try {
			// Get JSON string and validate
			const jsonStr = outputCoreAsJson();
			if (typeof jsonStr !== 'string' || !jsonStr) {
				throw new Error('Invalid or empty JSON string returned by outputCoreAsJson');
			}

			// Validate JSON content
			try {
				JSON.parse(jsonStr); // Ensure it's valid JSON
			} catch (e) {
				throw new Error('Invalid JSON format: ' + e.message);
			}

			// Create Blob with JSON content
			const blob = new Blob([jsonStr], { type: 'application/json' });
			const url = URL.createObjectURL(blob);

			// Create temporary <a> element
			const a = document.createElement('a');
			a.innerText = 'download';
			a.href = url;
			a.download = 'session.json'; // File name for download
			document.body.appendChild(a);

			// Programmatically trigger click
			a.click();

			// Clean up
			setTimeout(() => {
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
			}, 10); // Delay cleanup to ensure download starts
		} catch (error) {
			console.error('Failed to export JSON:', error.message);
			alert('Error exporting JSON: ' + error.message); // Notify user of error
		}
	}

	export async function importJson(jsonData, onProgress) {
		//reset existing workflow
		core.data = [];
		core.tables = [];
		core.plots = [];

		if (onProgress) onProgress('Loading raw data…');
		await tick();
		await new Promise((r) => setTimeout(r, 0));

		if (!jsonData.version || jsonData.version < 'β.5') {
			//legacy support for rawData as array
			core.rawData = new Map(
				Object.entries($state.snapshot(jsonData.data)).map(([id, data]) => [
					Number(data.id),
					data.data
				])
			);
			const totalData = jsonData.data.length;
			for (let i = 0; i < totalData; i++) {
				if (onProgress && i % 10 === 0) {
					onProgress(`Loading columns… ${i + 1} of ${totalData}`);
					await tick();
					await new Promise((r) => setTimeout(r, 0));
				}
				pushObj(Column.fromJSON(jsonData.data[i]));
			}
			for (let i = 0; i < core.data.length; i++) {
				core.data[i].data = Array.isArray(core.data[i].data) ? core.data[i].id : -1;
			}
		} else {
			core.rawData = new Map(
				Object.entries($state.snapshot(jsonData.rawData)).map(([key, value]) => [+key, value])
			);
			const totalData = jsonData.data.length;
			for (let i = 0; i < totalData; i++) {
				if (onProgress && i % 10 === 0) {
					onProgress(`Loading columns… ${i + 1} of ${totalData}`);
					await tick();
					await new Promise((r) => setTimeout(r, 0));
				}
				pushObj(Column.fromJSON(jsonData.data[i]));
			}
		}

		if (onProgress) onProgress('Building tables…');
		await tick();
		await new Promise((r) => setTimeout(r, 0));

		const totalTables = jsonData.tables.length;
		for (let i = 0; i < totalTables; i++) {
			if (onProgress && totalTables > 1) {
				onProgress(`Building table ${i + 1} of ${totalTables}…`);
				await tick();
				await new Promise((r) => setTimeout(r, 0));
			}
			pushObj(Table.fromJSON(jsonData.tables[i]));
		}

		if (onProgress) onProgress('Rebuilding plots…');
		await tick();
		await new Promise((r) => setTimeout(r, 0));

		const totalPlots = jsonData.plots.length;
		for (let i = 0; i < totalPlots; i++) {
			if (onProgress && totalPlots > 1) {
				onProgress(`Rebuilding plot ${i + 1} of ${totalPlots}…`);
				await tick();
				await new Promise((r) => setTimeout(r, 0));
			}
			pushObj(Plot.fromJSON(jsonData.plots[i]), false);
		}

		if (jsonData.appState) {
			if (onProgress) onProgress('Restoring settings…');
			await tick();
			loadAppState(jsonData.appState);
		}
	}
</script>

<script>
	// @ts-nocheck
	import { tick } from 'svelte';
	import { core, pushObj, outputCoreAsJson, loadAppState } from '$lib/core/core.svelte';
	import { Column } from '$lib/core/Column.svelte';
	import { Table } from '$lib/core/Table.svelte';
	import { Plot } from '$lib/core/Plot.svelte';

	import Modal from '$lib/components/reusables/Modal.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';
	import Settings from '../views/modals/Settings.svelte';
	import Icon from '$lib/icons/Icon.svelte';

	let showSettingsModal = $state(false);

	let showImportModal = $state(false);

	let importReady = $state(false);
	let importPreview = $state();
	let awaitingLoad = $state(false);
	let loadProgressDetail = $state('');

	let fileInput;
	let fileName = $state();

	let jsonData = $state();
	let error = '';

	let { showDropdown = $bindable(false), dropdownTop = 0, dropdownLeft = 0 } = $props();

	async function openImportModal() {
		showImportModal = true;
		awaitingLoad = false;
		loadProgressDetail = '';
		await tick();
		chooseFile();
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

	async function doImport() {
		awaitingLoad = true;
		loadProgressDetail = 'Starting…';
		await tick();

		await importJson(jsonData, (detail) => {
			loadProgressDetail = detail;
		});

		awaitingLoad = false;
		loadProgressDetail = '';
		showImportModal = false;
		importReady = false;
	}
</script>

<Dropdown bind:showDropdown top={dropdownTop} left={dropdownLeft}>
	{#snippet groups()}
		<div class="action" onclick={(e) => openImportModal()}>
			<button> Load session</button>
		</div>

		<div class="action" onclick={(e) => exportJson()}>
			<button> Save session </button>
		</div>

		<div
			class="action"
			onclick={(e) => {
				showSettingsModal = true;
			}}
		>
			<button> Settings </button>
		</div>
	{/snippet}
</Dropdown>

<Modal bind:showModal={showImportModal}>
	{#snippet header()}
		{#if awaitingLoad}
			<div class="title-container">
				<Icon name="spinner" width={32} height={32} className="spinner" />
				<div>
					<p>Loading session{fileName ? ` from ${fileName}` : ''}…</p>
					{#if loadProgressDetail}
						<p class="progress-detail">{loadProgressDetail}</p>
					{/if}
				</div>
			</div>
		{:else}
			<div class="heading">
				<h2>Import Session</h2>

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
		{/if}

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
		{#if !awaitingLoad}
			<div class="import-container">
				<div class="preview-placeholder">
					{#if jsonData}
						<div class="preview-table-wrapper">
							<p>Tables imported: {jsonData.tables.length}</p>
							<p>Data imported: {jsonData.data.length}</p>
							<p>Plots imported: {jsonData.plots.length}</p>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	{/snippet}

	{#snippet button()}
		<div class="dialog-button-container">
			{#if importReady && !awaitingLoad}
				<button class="dialog-button" onclick={doImport}>Confirm Import</button>
			{/if}
		</div>
	{/snippet}
</Modal>

<Settings bind:showModal={showSettingsModal} />

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

	.title-container {
		display: flex;
		justify-content: left;
		align-items: center;
		gap: 10px;
	}

	.progress-detail {
		font-size: 0.85em;
		color: var(--color-lightness-45, #777);
		margin-top: 2px;
	}
</style>
