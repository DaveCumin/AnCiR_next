<script module>
	import { appState } from '$lib/core/core.svelte';
	import { addNotification } from '$lib/core/notifications.svelte.js';
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
			addNotification('Error exporting JSON: ' + error.message);
		}
	}

	/** Yield once: flush Svelte updates AND give the browser a frame to
	 *  repaint (so the spinner stays visually responsive). */
	async function yieldFrame() {
		await tick();
		await new Promise((r) => requestAnimationFrame(() => r()));
	}

	export async function importJson(jsonData, onProgress) {
		//reset existing workflow
		core.data = [];
		core.tableProcesses = [];
		core.plots = [];
		core.groups = [];
		core.notes = [];
		core.nodeNotes = {};
		// Orphan processes are session-only; clear on import so the next
		// block can rehydrate them from the JSON if present.
		core.orphanProcesses = [];

		const dataEntries = Array.isArray(jsonData?.data) ? jsonData.data : [];
		const columnCount = jsonData?.rawData
			? Object.keys(jsonData.rawData).length
			: dataEntries.length;

		if (onProgress) onProgress(`Loading ${columnCount} columns…`);
		await yieldFrame();

		// Build the rawData Map once, then push all columns in one synchronous
		// sweep. Yielding inside the loop just causes per-column re-renders.
		if (!jsonData.rawData) {
			//legacy support for rawData as array
			core.rawData = new Map(
				Object.entries($state.snapshot(jsonData.data)).map(([id, data]) => [
					Number(data.id),
					data.data
				])
			);
			for (const cd of dataEntries) pushObj(Column.fromJSON(cd));
			for (let i = 0; i < core.data.length; i++) {
				core.data[i].data = Array.isArray(core.data[i].data) ? core.data[i].id : -1;
			}
		} else {
			core.rawData = new Map(
				Object.entries($state.snapshot(jsonData.rawData)).map(([key, value]) => [+key, value])
			);
			for (const cd of dataEntries) pushObj(Column.fromJSON(cd));
		}

		// Re-link shared args for linked processes after deserialization
		relinkLinkedProcessArgs();

		// New sessions persist groups + free TPs directly. Rehydrate those
		// before processing any legacy tables.
		if (Array.isArray(jsonData.groups)) {
			for (const g of jsonData.groups) {
				core.groups.push({
					id: g.id,
					name: g.name ?? 'Group',
					x: g.x ?? 80,
					y: g.y ?? 80,
					width: g.width ?? 240,
					height: g.height ?? 180,
					sourceColumnIds: Array.isArray(g.sourceColumnIds) ? [...g.sourceColumnIds] : [],
					allColumnIds: Array.isArray(g.allColumnIds) ? [...g.allColumnIds] : null,
					collapsed: g.collapsed === true,
					rowState: g.rowState ?? {}
				});
			}
		}
		if (Array.isArray(jsonData.notes)) {
			for (const n of jsonData.notes) {
				core.notes.push({
					id: n.id,
					text: n.text ?? '',
					x: n.x ?? 80,
					y: n.y ?? 80,
					width: n.width ?? 200,
					height: n.height ?? 120
				});
			}
		}
		if (jsonData.nodeNotes && typeof jsonData.nodeNotes === 'object') {
			core.nodeNotes = { ...jsonData.nodeNotes };
		}
		if (Array.isArray(jsonData.tableProcesses)) {
			for (const tp of jsonData.tableProcesses) {
				core.tableProcesses.push(new TableProcess(tp, null, tp.id));
			}
		}

		// Legacy: convert each saved `tables[]` into a Group node + free TPs.
		// The Group's sources = columns from columnRefs that AREN'T outputs of
		// any of this table's processes (i.e. the original sources only).
		// TableProcesses migrate to core.tableProcesses with parent = null.
		// Table.svelte is gone (Phase D), so we parse the legacy shape inline.
		const totalTables = jsonData.tables?.length ?? 0;
		for (let i = 0; i < totalTables; i++) {
			if (onProgress) onProgress(`Migrating legacy table ${i + 1} of ${totalTables}…`);
			await yieldFrame();
			const legacy = jsonData.tables[i];
			const tableId = legacy.id ?? legacy.tableid ?? i;
			const tableName = legacy.name ?? `Table ${tableId}`;
			const columnRefs = Array.isArray(legacy.columnRefs) ? legacy.columnRefs : [];

			// 1. Reconstitute each TableProcess as free-standing.
			const newTPs = [];
			for (const procJson of legacy.processes ?? []) {
				try {
					newTPs.push(new TableProcess(procJson, null, procJson.id));
				} catch (e) {
					console.warn('Failed to migrate legacy TableProcess', procJson, e);
				}
			}

			// 2. Collect TP-output column ids (these are NOT sources).
			const tpOutIds = new Set();
			for (const tp of newTPs) {
				for (const cid of Object.values(tp.args?.out ?? {})) {
					if (typeof cid === 'number' && cid >= 0) tpOutIds.add(cid);
				}
			}

			// 3. Build a Group with the table's original source columns.
			const sources = columnRefs.filter((cid) => !tpOutIds.has(cid));
			if (sources.length > 0 || newTPs.length === 0) {
				core.groups.push({
					id: `group_legacy_${tableId}`,
					name: tableName,
					x: 80 + i * 40,
					y: 80 + i * 40,
					width: 240,
					height: 180,
					sourceColumnIds: sources,
					allColumnIds: null,
					collapsed: false,
					rowState: {}
				});
			}

			// 4. Push the migrated TPs into the free store.
			for (const tp of newTPs) core.tableProcesses.push(tp);
		}

		// Plots: yield between each push so the canvas re-render is split
		// across frames. A single batched push freezes the compositor (and the
		// spinner) for the entire build, which is what we want to avoid here.
		const totalPlots = jsonData.plots?.length ?? 0;
		for (let i = 0; i < totalPlots; i++) {
			if (onProgress) onProgress(`Rebuilding plot ${i + 1} of ${totalPlots}…`);
			await yieldFrame();
			pushObj(Plot.fromJSON(jsonData.plots[i]), false);
		}

		// Orphan column-processes (unconnected, spawned via palette/paste).
		// Rehydrated as Process instances with parentCol = null so the canvas
		// re-renders them; the user re-wires after load.
		const orphanSnapshots = Array.isArray(jsonData.orphanProcesses)
			? jsonData.orphanProcesses
			: [];
		if (orphanSnapshots.length > 0) {
			core.orphanProcesses = orphanSnapshots
				.map((p) => {
					try {
						return Process.fromJSON(p, null);
					} catch (e) {
						console.warn('Failed to rehydrate orphan process', p, e);
						return null;
					}
				})
				.filter(Boolean);
		}

		if (jsonData.appState) {
			if (onProgress) onProgress('Restoring settings…');
			await yieldFrame();
			loadAppState(jsonData.appState);
		}

		// hoursSinceStart is already pre-computed in pushObj; no second pass.
		if (onProgress) onProgress('Finalising…');
		await yieldFrame();
	}
</script>

<script>
	// @ts-nocheck
	import { tick } from 'svelte';
	import { core, pushObj, outputCoreAsJson, loadAppState } from '$lib/core/core.svelte';
	import { Column, relinkLinkedProcessArgs } from '$lib/core/Column.svelte';
	import { TableProcess } from '$lib/core/TableProcess.svelte';
	import { Plot } from '$lib/core/Plot.svelte';
	import { Process } from '$lib/core/Process.svelte';

	import Modal from '$lib/components/reusables/Modal.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';
	import Settings from '../views/modals/Settings.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

	import { dev } from '$app/environment';
	import { base } from '$app/paths';

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

	// Example sessions are listed from a manifest fetched at runtime (so the demo
	// files live outside the app bundle, under static/sessions/demos/). The
	// manifest is lazy-loaded the first time the user opens the submenu.
	let exampleSessions = $state([]);
	let examplesRequested = $state(false);
	let examplesError = $state('');

	const exampleGroups = $derived.by(() => {
		const groups = new Map();
		for (const s of exampleSessions) {
			const family = s.family || 'Examples';
			if (!groups.has(family)) groups.set(family, []);
			groups.get(family).push(s);
		}
		return [...groups.entries()];
	});

	async function ensureExampleIndex() {
		if (examplesRequested) return;
		examplesRequested = true;
		examplesError = '';
		try {
			const res = await fetch(`${base}/sessions/demos/index.json`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const idx = await res.json();
			exampleSessions = Array.isArray(idx?.sessions) ? idx.sessions : [];
		} catch (err) {
			examplesError = err.message;
			examplesRequested = false; // allow a retry on next hover
		}
	}

	// Resolve a (possibly relative) manifest URL against the app base path.
	function resolveExampleUrl(url) {
		return /^https?:\/\//.test(url) ? url : `${base}/${url.replace(/^\//, '')}`;
	}

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
			addNotification(`Failed to load session from URL.\n\n${err.message}`);
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
			addNotification(`Failed to load session from URL.\n\n${err.message}`);
		}
		urlFetching = false;
	}

	async function doImport() {
		if (dev) {
			performance.mark('importSession-start');
		}
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
		if (dev) {
			performance.mark('importSession-end');
			performance.measure('importSession', 'importSession-start', 'importSession-end');
			const measure = performance.getEntriesByName('importSession')[0];
			console.log(`Session import took ${measure.duration.toFixed(2)} ms`);
		}
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
			onmouseenter={() => {
				showSubmenu('examples');
				ensureExampleIndex();
			}}
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
				{#if examplesError}
					<div class="submenu-item submenu-muted">Could not load examples</div>
				{:else if exampleSessions.length === 0}
					<div class="submenu-item submenu-muted">Loading examples…</div>
				{:else}
					{#each exampleGroups as [family, sessions]}
						<div class="submenu-group-label">{family}</div>
						{#each sessions as session}
							<button
								class="submenu-item"
								title={session.description ?? ''}
								onclick={() => {
									closeDropdown();
									openExampleSession(resolveExampleUrl(session.url));
								}}
							>
								{session.name}
							</button>
						{/each}
					{/each}
				{/if}
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
							<p>
								Data imported: {Array.isArray(jsonData?.data)
									? jsonData.data.length
									: Object.keys(jsonData?.rawData ?? {}).length}
							</p>
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

	.submenu-group-label {
		padding: 0.4em 0.6em 0.2em;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.6;
	}

	.submenu-muted {
		opacity: 0.6;
		font-style: italic;
		cursor: default;
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
