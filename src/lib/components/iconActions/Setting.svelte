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

	let showSettingsModal = $state(false);

	let showImportModal = $state(false);

	let importReady = $state(false);
	let importPreview = $state();

	let fileInput;
	let fileName = $state();

	let jsonData = $state();
	let error = '';

	let { showDropdown = $bindable(false), dropdownTop = 0, dropdownLeft = 0 } = $props();

	async function openImportModal() {
		showImportModal = true;
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
				console.log('jsonData:', $state.snapshot(jsonData));
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

		if (!jsonData.version || jsonData.version < 'β.5') {
			//legacy support for rawData as array
			core.rawData = new Map(
				Object.entries($state.snapshot(jsonData.data)).map(([id, data]) => [+id, data.data])
			);
			jsonData.data.map((datajson) => {
				pushObj(Column.fromJSON(datajson));
			});
			for (let i = 0; i < core.data.length; i++) {
				core.data[i].data = Array.isArray(core.data[i].data) ? core.data[i].id : -1;
			}
		} else {
			core.rawData = new Map(
				Object.entries($state.snapshot(jsonData.rawData)).map(([key, value]) => [+key, value])
			);
			jsonData.data.map((datajson) => {
				pushObj(Column.fromJSON(datajson));
			});
		}

		jsonData.tables.map((tablejson) => {
			pushObj(Table.fromJSON(tablejson));
		});

		jsonData.plots.map((plotjson) => {
			pushObj(Plot.fromJSON(plotjson), false);
		});

		if (jsonData.appState) {
			loadAppState(jsonData.appState);
		}

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
						<p>Data imported: {jsonData.data.length}</p>
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
</style>
