<script module>
	import { appState } from '$lib/core/core.svelte';
	import { showError } from '$lib/core/core.svelte.js';
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
			showError('Error exporting JSON: ' + error.message);
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

		if (!jsonData.rawData) {
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

		// Re-link shared args for linked processes after deserialization
		relinkLinkedProcessArgs();

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

		if (onProgress) onProgress('Computing time axes…');
		await tick();
		for (const col of core.data) {
			void col.hoursSinceStart; //pre-compute better performance
		}
	}
</script>

<script>
	// @ts-nocheck
	import { tick } from 'svelte';
	import { core, pushObj, outputCoreAsJson, loadAppState } from '$lib/core/core.svelte';
	import { Column, relinkLinkedProcessArgs } from '$lib/core/Column.svelte';
	import { Table } from '$lib/core/Table.svelte';
	import { Plot } from '$lib/core/Plot.svelte';

	import Modal from '$lib/components/reusables/Modal.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';
	import Settings from '../views/modals/Settings.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

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

	let sessionUrl = $state('');
	let urlFetching = $state(false);

	let { showDropdown = $bindable(false), dropdownTop = 0, dropdownLeft = 0 } = $props();

	let exampleSessionMenuItem = $state();

	const exampleSessions = [
		{
			name: 'Example session',
			url: 'https://raw.githubusercontent.com/DaveCumin/AnCiR_next/refs/heads/main/test/testJSON.json'
		}
	];

	async function openImportModal() {
		showImportModal = true;
		awaitingLoad = false;
		loadProgressDetail = '';
		await tick();
		chooseFile();
	}

	async function openExampleSession(url) {
		showImportModal = true;
		awaitingLoad = false;
		loadProgressDetail = '';
		urlFetching = true;
		try {
			const response = await fetch(url);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			jsonData = await response.json();
			fileName = url.split('/').pop() || 'example-session';
			error = '';
			importReady = true;
		} catch (err) {
			error = `Failed to fetch: ${err.message}`;
			jsonData = null;
			importReady = false;
			showError(`Failed to load session from URL. \n\n${err.message}`);
		}
		urlFetching = false;
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

	async function fetchSessionFromURL() {
		if (!sessionUrl.trim()) return;
		urlFetching = true;
		try {
			const response = await fetch(sessionUrl.trim());
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			jsonData = await response.json();
			fileName = sessionUrl.split('/').pop() || 'url';
			error = '';
			importReady = true;
		} catch (err) {
			error = `Failed to fetch: ${err.message}`;
			jsonData = null;
			importReady = false;
			showError(`Failed to load session from URL. \n\n${err.message}`);
		}
		urlFetching = false;
	}

	async function doImport() {
		awaitingLoad = true;
		loadProgressDetail = 'Starting…';
		appState.loadingState.isLoading = true;
		appState.loadingState.loadingMsg = `Loading session${fileName ? ` from ${fileName}` : ''}…`;
		await tick();

		await importJson(jsonData, (detail) => {
			loadProgressDetail = detail;
			appState.loadingState.loadingMsg = detail;
		});

		appState.loadingState.isLoading = false;
		awaitingLoad = false;
		loadProgressDetail = '';
		showImportModal = false;
		importReady = false;
	}
</script>

<Dropdown bind:showDropdown top={dropdownTop} left={dropdownLeft}>
	{#snippet groups({ showSubmenu, hideSubmenu, keepSubmenuOpen, activeSubmenu, closeDropdown })}
		<div
			class="action"
			onclick={(e) => openImportModal()}
			onmouseenter={() => hideSubmenu('examples', 0)}
		>
			<button> Load session</button>
		</div>

		<div
			class="action dropdown-item has-submenu"
			bind:this={exampleSessionMenuItem}
			onmouseenter={() => showSubmenu('examples')}
			onmouseleave={() => hideSubmenu('examples', 150)}
		>
			<button class="menubutton">Use example session</button>
		</div>

		{#if activeSubmenu === 'examples' && exampleSessionMenuItem}
			<div
				class="submenu-bridge"
				style="top: {dropdownTop + exampleSessionMenuItem.offsetTop + 6}px; left: {dropdownLeft +
					200}px; width: 5px; height: {exampleSessionMenuItem.getBoundingClientRect().height}px;"
				onmouseenter={() => keepSubmenuOpen('examples')}
			></div>
			<div
				class="submenu"
				style="top: {dropdownTop + exampleSessionMenuItem.offsetTop - 40}px; left: {dropdownLeft +
					205}px;"
				onmouseenter={() => keepSubmenuOpen('examples')}
				onmouseleave={() => hideSubmenu('examples', 150)}
			>
				{#each exampleSessions as session}
					<button
						class="submenu-item"
						onclick={() => {
							closeDropdown();
							openExampleSession(session.url);
						}}
					>
						{session.name}
					</button>
				{/each}
			</div>
		{/if}

		<div
			class="action"
			onclick={(e) => exportJson()}
			onmouseenter={() => hideSubmenu('examples', 0)}
		>
			<button> Save session </button>
		</div>

		<div
			class="action"
			onmouseenter={() => hideSubmenu('examples', 0)}
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
			<LoadingSpinner
				message="Loading session{fileName ? ` from ${fileName}` : ''}…"
				detail={loadProgressDetail}
			/>
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
				<!-- <div class="url-input-container">
					<input
						class="url-input"
						type="text"
						bind:value={sessionUrl}
						placeholder="…or paste a URL to a session .json"
						onkeydown={(e) => {
							if (e.key === 'Enter') fetchSessionFromURL();
						}}
					/>
					 <button
						class="choose-file-button"
						onclick={fetchSessionFromURL}
						disabled={!sessionUrl.trim() || urlFetching}
					>
						{urlFetching ? 'Fetching…' : 'Load from URL'}
					</button>
				</div> -->
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

	.menubutton {
		background: transparent;
		border: none;
		font: inherit;
		padding: 0;
		text-align: left;
		cursor: pointer;
		margin-left: 0.4em !important;
	}

	.submenu-bridge {
		position: fixed;
		background: transparent;
		z-index: 1002;
		pointer-events: auto;
	}

	.submenu {
		position: fixed;
		min-width: 180px;
		background-color: white;
		border-radius: 4px;
		border: 1px solid var(--color-lightness-85);
		box-shadow:
			0 4px 8px 0 rgba(0, 0, 0, 0.2),
			0 6px 10px 0 rgba(0, 0, 0, 0.1);
		z-index: 1001;
		padding: 0;
	}

	.submenu-item {
		display: block;
		padding: 0.6em;
		cursor: pointer;
		border: none;
		background: transparent;
		text-align: left;
		font: inherit;
		width: 100%;
		font-size: 14px;
	}

	.submenu-item:hover {
		background-color: var(--color-lightness-95);
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

	.url-input-container {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.url-input {
		flex: 1;
		font-size: 13px;
		padding: 0.2rem 0.5rem;
		border: 1px solid var(--color-lightness-85);
		border-radius: 2px;
		background: var(--color-lightness-97);
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
