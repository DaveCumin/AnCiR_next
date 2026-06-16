<script>
	// @ts-nocheck
	import { tick } from 'svelte';
	import { dev } from '$app/environment';
	import { base } from '$app/paths';

	import Modal from '$lib/components/reusables/Modal.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

	import { appState } from '$lib/core/core.svelte.js';
	import { addNotification } from '$lib/core/notifications.svelte.js';
	import { importJson } from '$lib/components/iconActions/Setting.svelte';

	let { showModal = $bindable(false), initialSourceMode = 'file' } = $props();

	// Tabbed source picker. 'file' is the default since it's the most common
	// path; switching tabs is one click and the demo index is fetched lazily.
	// Callers can open straight to a given tab (e.g. 'example') via
	// `initialSourceMode`; the close-reset below restores that choice.
	let sourceMode = $state(initialSourceMode);

	let fileInput;
	let sessionUrl = $state('');

	let loading = $state(false);
	let progressDetail = $state('');
	let fileName = $state('');
	let activeExampleUrl = $state(null);
	let loadError = $state('');

	// Example sessions are listed from a manifest fetched at runtime (so the demo
	// files live outside the app bundle, under static/sessions/demos/). The
	// manifest is lazy-loaded the first time the Example tab opens.
	let exampleSessions = $state([]);
	let examplesRequested = $state(false);
	let examplesError = $state('');
	// Palette-style search across the example gallery. Matches the manifest's
	// `keywords` blob (node key + display name + family + description) so users can
	// find a session by the node/function it showcases.
	let exampleSearch = $state('');

	function sessionSearchText(s) {
		return (
			s.keywords ||
			[s.name, s.description, s.family, ...(s.showcases ?? [])]
				.filter(Boolean)
				.join(' ')
				.toLowerCase()
		);
	}

	const filteredSessions = $derived.by(() => {
		const q = exampleSearch.trim().toLowerCase();
		if (!q) return exampleSessions;
		const terms = q.split(/\s+/);
		return exampleSessions.filter((s) => {
			const hay = sessionSearchText(s);
			return terms.every((t) => hay.includes(t));
		});
	});

	const exampleGroups = $derived.by(() => {
		const groups = new Map();
		for (const s of filteredSessions) {
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
			examplesRequested = false; // allow retry on next tab visit
		}
	}

	function resolveExampleUrl(url) {
		return /^https?:\/\//.test(url) ? url : `${base}/${url.replace(/^\//, '')}`;
	}

	$effect(() => {
		if (showModal && sourceMode === 'example') ensureExampleIndex();
	});

	// Reset transient state when the modal closes so reopening starts clean.
	$effect(() => {
		if (!showModal) {
			sourceMode = initialSourceMode;
			sessionUrl = '';
			loading = false;
			progressDetail = '';
			fileName = '';
			activeExampleUrl = null;
			loadError = '';
			exampleSearch = '';
			if (fileInput) fileInput.value = '';
		}
	});

	async function loadAndImport(jsonData, label) {
		if (dev) performance.mark('importSession-start');
		loading = true;
		loadError = '';
		fileName = label;
		progressDetail = 'Starting…';
		appState.loadingState.isLoading = true;
		appState.loadingState.loadingMsg = `Loading session${label ? ` from ${label}` : ''}…`;
		await tick();

		try {
			await importJson(jsonData, (detail) => {
				progressDetail = detail;
				appState.loadingState.loadingMsg = detail;
			});
			showModal = false;
		} catch (err) {
			loadError = `Failed to import session: ${err.message}`;
			addNotification(loadError);
		} finally {
			appState.loadingState.isLoading = false;
			loading = false;
			progressDetail = '';
			activeExampleUrl = null;
			if (dev) {
				performance.mark('importSession-end');
				performance.measure('importSession', 'importSession-start', 'importSession-end');
				const measure = performance.getEntriesByName('importSession').slice(-1)[0];
				if (measure) console.log(`Session import took ${measure.duration.toFixed(2)} ms`);
			}
		}
	}

	function chooseFile() {
		fileInput.click();
	}

	function handleFileChange(event) {
		const file = event.target.files[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = (e) => {
			let parsed;
			try {
				parsed = JSON.parse(e.target.result);
			} catch (err) {
				loadError = `Invalid JSON file: ${err.message}`;
				addNotification(loadError);
				return;
			}
			loadAndImport(parsed, file.name);
		};
		reader.onerror = () => {
			loadError = 'Failed to read file';
			addNotification(loadError);
		};
		reader.readAsText(file);
	}

	async function fetchSessionFromURL() {
		const url = sessionUrl.trim();
		if (!url) return;
		loading = true;
		loadError = '';
		try {
			const response = await fetch(url);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = await response.json();
			await loadAndImport(data, url.split('/').pop() || 'url');
		} catch (err) {
			loadError = `Failed to fetch: ${err.message}`;
			addNotification(`Failed to load session from URL.\n\n${err.message}`);
			loading = false;
		}
	}

	async function loadExample(session) {
		const url = resolveExampleUrl(session.url);
		activeExampleUrl = session.url;
		loading = true;
		loadError = '';
		try {
			const response = await fetch(url);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = await response.json();
			await loadAndImport(data, session.name || url.split('/').pop());
		} catch (err) {
			loadError = `Failed to load example: ${err.message}`;
			addNotification(`Failed to load example session.\n\n${err.message}`);
			loading = false;
			activeExampleUrl = null;
		}
	}
</script>

<Modal bind:showModal width="34rem">
	{#snippet header()}
		<div class="heading">
			<h2>Load session</h2>
			<div class="source-tabs" role="tablist">
				<button
					type="button"
					class="tab-btn"
					class:active={sourceMode === 'file'}
					onclick={() => (sourceMode = 'file')}
					disabled={loading}
					role="tab"
					aria-selected={sourceMode === 'file'}
				>
					From file
				</button>
				<button
					type="button"
					class="tab-btn"
					class:active={sourceMode === 'url'}
					onclick={() => (sourceMode = 'url')}
					disabled={loading}
					role="tab"
					aria-selected={sourceMode === 'url'}
				>
					From URL
				</button>
				<button
					type="button"
					class="tab-btn"
					class:active={sourceMode === 'example'}
					onclick={() => (sourceMode = 'example')}
					disabled={loading}
					role="tab"
					aria-selected={sourceMode === 'example'}
				>
					Examples
				</button>
			</div>
		</div>

		<input
			bind:this={fileInput}
			type="file"
			accept=".json,application/json"
			onchange={handleFileChange}
			style="display: none;"
		/>
	{/snippet}

	{#snippet children()}
		<div class="import-container">
			{#if sourceMode === 'file'}
				<div class="tab-panel">
					<button class="primary-button" onclick={chooseFile} disabled={loading}>
						Choose .json file
					</button>
					<p class="tab-hint">
						Pick a previously saved <code>.json</code> session file. It loads as soon as you select it.
					</p>
				</div>
			{:else if sourceMode === 'url'}
				<div class="tab-panel">
					<div class="url-row">
						<input
							class="url-input"
							type="url"
							bind:value={sessionUrl}
							placeholder="https://example.com/session.json"
							disabled={loading}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									fetchSessionFromURL();
								}
							}}
						/>
						<button
							class="primary-button"
							onclick={fetchSessionFromURL}
							disabled={loading || !sessionUrl.trim()}
						>
							{loading ? 'Fetching…' : 'Fetch'}
						</button>
					</div>
					<p class="tab-hint">Paste a URL to a session JSON; it loads on Fetch.</p>
				</div>
			{:else}
				<div class="tab-panel example-list">
					{#if examplesError}
						<p class="tab-hint error">Could not load examples: {examplesError}</p>
					{:else if !examplesRequested || (exampleSessions.length === 0 && !loadError)}
						<div class="loading-row">
							<LoadingSpinner message="Loading examples…" />
						</div>
					{:else if exampleSessions.length === 0}
						<p class="tab-hint">No example sessions available.</p>
					{:else}
						<input
							class="search-input"
							type="search"
							bind:value={exampleSearch}
							placeholder="Search examples by node or function (e.g. fourier, bin, cosinor)…"
							disabled={loading}
							aria-label="Search example sessions"
						/>
						{#if filteredSessions.length === 0}
							<p class="tab-hint">No examples match “{exampleSearch}”.</p>
						{/if}
						{#each exampleGroups as [family, sessions] (family)}
							<div class="example-group-label">{family}</div>
							{#each sessions as session (session.id ?? session.url)}
								{@const active = activeExampleUrl === session.url}
								<button
									class="example-item"
									class:active
									title={session.description ?? ''}
									onclick={() => loadExample(session)}
									disabled={loading}
								>
									<span class="example-name">{session.name}</span>
									{#if session.description}
										<span class="example-description">{session.description}</span>
									{/if}
								</button>
							{/each}
						{/each}
					{/if}
				</div>
			{/if}

			{#if loading}
				<div class="status-row">
					<LoadingSpinner
						message={fileName ? `Loading ${fileName}…` : 'Loading session…'}
						detail={progressDetail}
					/>
				</div>
			{/if}

			{#if loadError}
				<p class="tab-hint error">{loadError}</p>
			{/if}
		</div>
	{/snippet}
</Modal>

<style>
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

	.heading h2 {
		margin: 0 0 0.6em 0;
	}

	.source-tabs {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--color-lightness-85);
	}

	.tab-btn {
		background: transparent;
		border: 0;
		border-bottom: 2px solid transparent;
		padding: 6px 10px;
		cursor: pointer;
		color: var(--color-lightness-35);
		font-size: 14px;
	}

	.tab-btn:hover:not(:disabled) {
		color: var(--color-lightness-10);
	}

	.tab-btn.active {
		color: var(--color-lightness-10);
		border-bottom-color: var(--color-hover);
	}

	.tab-btn:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.import-container {
		margin-top: 1rem;
		min-height: 12rem;
	}

	.tab-panel {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.tab-hint {
		color: var(--color-lightness-35);
		font-size: 13px;
		margin: 0;
	}

	.tab-hint.error {
		color: var(--color-error, #b00020);
	}

	.primary-button {
		background-color: var(--color-lightness-95);
		padding: 8px 12px;
		border-radius: 4px;
		font-size: 14px;
		text-align: center;
		align-self: flex-start;
	}

	.primary-button:hover:not(:disabled) {
		background-color: var(--color-hover);
	}

	.primary-button:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.url-row {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}

	.url-input {
		flex: 1;
		font-size: 13px;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--color-lightness-85);
		border-radius: 2px;
		background: var(--color-lightness-97);
	}

	.example-list {
		max-height: 50vh;
		overflow-y: auto;
		padding-right: 4px;
	}

	.search-input {
		position: sticky;
		top: 0;
		z-index: 1;
		width: 100%;
		box-sizing: border-box;
		font-size: 13px;
		padding: 0.4rem 0.5rem;
		margin-bottom: 0.2rem;
		border: 1px solid var(--color-lightness-85);
		border-radius: 4px;
		background: var(--color-lightness-97);
	}

	.search-input:focus {
		outline: none;
		border-color: var(--color-hover);
	}

	.example-group-label {
		margin-top: 0.6rem;
		padding: 2px 2px 4px;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-lightness-35);
		border-bottom: 1px solid var(--color-lightness-85);
	}

	.example-group-label:first-child {
		margin-top: 0;
	}

	.example-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px 10px;
		margin-top: 6px;
		text-align: left;
		border: 1px solid var(--color-lightness-85);
		border-radius: 4px;
		background: white;
		font: inherit;
		width: 100%;
	}

	.example-item:hover:not(:disabled) {
		background-color: var(--color-lightness-95);
		border-color: var(--color-hover);
	}

	.example-item.active {
		border-color: var(--color-hover);
		background-color: var(--color-lightness-95);
	}

	.example-item:disabled {
		cursor: progress;
		opacity: 0.6;
	}

	.example-name {
		font-weight: 600;
		font-size: 14px;
	}

	.example-description {
		font-size: 12px;
		color: var(--color-lightness-35);
	}

	.loading-row,
	.status-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 4px;
	}

	.status-row {
		margin-top: 0.8rem;
	}
</style>
