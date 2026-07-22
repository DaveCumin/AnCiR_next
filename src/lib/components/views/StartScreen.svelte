<script>
	// @ts-nocheck
	// The start screen: a small number of clearly-tiered entry points, shown as an OVERLAY over the
	// workspace rather than as a view of its own. On an empty session the backdrop is a blank
	// canvas, so dismissing lands the user somewhere coherent instead of swapping the whole view.
	//
	// Hierarchy, and why:
	//   1. Two primary cards (import / load) carry the weight — they're what a returning user wants.
	//   2. A row of outlined chips (simulate / AI / blank canvas) reads as pressable but stays
	//      visibly tertiary, so it can't compete with the two primaries.
	//   3. Recent, Examples and Tour each sit under a quiet section label.
	//   4. The tour band is the only high-contrast element. It is PROMOTED into the Recent slot when
	//      there is no history: a first-time visitor gets the tour where a returning one gets their
	//      sessions, and nobody sees a section explaining a list they haven't got yet.
	//
	// The whole overlay is a drop target for import — dropping anywhere starts an import — using the
	// existing canvasFileDrop action, which already does the drag-depth counting AND ignores
	// internal app drags (dragging a data column must not light up the import card).
	import Icon from '$lib/icons/Icon.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import LoadSessionModal from '$lib/components/workflow/LoadSessionModal.svelte';
	import AiPrompt from '$lib/components/views/modals/AiPrompt.svelte';
	import { canvasFileDrop } from '$lib/core/canvasFileDrop.js';
	import { openImportData, openImportDataFiles } from '$lib/core/dataSourceActions.js';
	import { openPicker as openTourPicker } from '$lib/core/tourRunner.svelte.js';
	import { thumbnailForWorkflow } from '$lib/start/thumbnails.js';
	import {
		recents,
		loadRecents,
		removeRecent,
		clearRecents,
		openRecent,
		relativeTime,
		supportsFileHandles
	} from '$lib/start/recentSessions.svelte.js';
	import {
		openExample,
		displayName,
		openSessionFile,
		pickSessionFile,
		loadExampleManifest,
		notifyFailure
	} from '$lib/start/startActions.js';

	let { onDismiss = null } = $props();


	let dragActive = $state(false);
	let showLoadSession = $state(false);
	let showAi = $state(false);
	let confirmClear = $state(false);
	let exampleGroups = $state([]);
	let manifestError = $state('');
	let busyId = $state(null);
	let query = $state('');
	// The load-session modal is reused for two jobs: opening a file, and browsing the full library.
	let loadMode = $state('file');

	// Group names are row headings no longer; they ride on each card, so they need to be short
	// enough to sit above a 9.5rem card without wrapping.
	const SHORT_GROUP = {
		'Rhythm & circadian': 'Rhythm',
		'General statistics': 'Statistics',
		'Reading the output': 'Reading output'
	};
	const FEATURED_PER_GROUP = 2;

	const allExamples = $derived(
		exampleGroups.flatMap(([group, sessions]) => sessions.map((s) => ({ ...s, group })))
	);

	/**
	 * The default view: two from each group on ONE row. Interleaved rather than three adjacent
	 * pairs, so the row reads as a mix of what the app does. This also fills the grid exactly —
	 * six cards in six columns — which grouped rows cannot, because the groups are 9, 7 and 3.
	 */
	const featured = $derived.by(() => {
		const out = [];
		for (let i = 0; i < FEATURED_PER_GROUP; i++) {
			for (const [group, sessions] of exampleGroups) {
				if (sessions[i]) out.push({ ...sessions[i], group });
			}
		}
		return out;
	});

	/** null when not searching, so an empty result is distinguishable from "no query". */
	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return null;
		return allExamples.filter((s) =>
			`${s.name} ${s.summary} ${s.group}`.toLowerCase().includes(q)
		);
	});
	const shownExamples = $derived(filtered ?? featured);

	const canReopen = supportsFileHandles();

	$effect(() => {
		loadRecents();
	});

	$effect(() => {
		loadExampleManifest()
			.then((g) => (exampleGroups = g))
			.catch((e) => (manifestError = e.message));
	});

	function handleDrop(files) {
		dragActive = false;
		if (files?.length) openImportDataFiles(files);
	}

	async function launchExample(session) {
		busyId = session.id;
		try {
			await openExample(session);
			onDismiss?.();
		} catch (e) {
			notifyFailure('Could not open that example.', e);
		} finally {
			busyId = null;
		}
	}

	/** The "Load session" primary card: prefer the handle-granting picker, else the legacy modal. */
	async function loadSession() {
		const res = await pickSessionFile();
		if (res.status === 'cancelled') return;
		if (res.status === 'unsupported') {
			loadMode = 'file';
			showLoadSession = true;
			return;
		}
		busyId = 'load';
		try {
			await openSessionFile(res.file, res.handle);
			onDismiss?.();
		} catch (e) {
			notifyFailure('Could not open that session file.', e);
		} finally {
			busyId = null;
		}
	}

	async function reopenRecent(entry) {
		busyId = entry.id;
		try {
			// An example row is re-fetchable by url, so it reopens with no handle and no picker.
			if (entry.url) {
				await openExample({ id: entry.workflow || entry.id, name: entry.name, url: entry.url });
				onDismiss?.();
				return;
			}
			const res = await openRecent(entry.id);
			if (res.status === 'ok') {
				// A session file, not a data file: it must go through the session loader.
				await openSessionFile(res.file, res.handle);
				onDismiss?.();
			} else {
				// No handle, or permission has lapsed. Re-select, then re-record under the SAME id so
				// the row is rehydrated (with a fresh handle) rather than duplicated.
				const picked = await pickSessionFile();
				if (picked.status === 'ok') {
					await openSessionFile(picked.file, picked.handle);
					onDismiss?.();
				} else if (picked.status === 'unsupported') {
					loadMode = 'file';
					showLoadSession = true;
				}
			}
		} catch (e) {
			notifyFailure('Could not reopen that session.', e);
		} finally {
			busyId = null;
		}
	}

	async function doClear() {
		await clearRecents();
		confirmClear = false;
	}

	/**
	 * Escape dismisses to the blank canvas behind, but only when nothing of ours is stacked on top:
	 * a child dialog handles its own Escape, and closing it must not also close the start screen.
	 */
	function handleKeydown(e) {
		if (e.key !== 'Escape') return;
		if (showLoadSession || showAi || confirmClear) return;
		// A search in progress owns Escape: clearing the query must not also close the screen.
		if (query) {
			query = '';
			return;
		}
		onDismiss?.();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- The tour band appears in one of two places depending on whether there is any history, so it
     lives in a snippet rather than being written twice. -->
{#snippet tourSection()}
	<section class="start-section">
		<h2 class="section-label">New here?</h2>
		<div class="tour-band">
			<div class="tour-copy">
				<strong>Take the tour</strong>
				<span>A short guided pass: import a record, build a workload, read the output.</span>
			</div>
			<button type="button" class="tour-cta" onclick={() => { openTourPicker(); onDismiss?.(); }}>
				Take the tour
			</button>
		</div>
	</section>
{/snippet}

<div
	class="start"
	class:drag-active={dragActive}
	role="dialog"
	aria-modal="true"
	aria-labelledby="start-heading"
	use:canvasFileDrop={{ onActive: (v) => (dragActive = v), onDrop: handleDrop }}
>
	<div class="start-inner">
		<header class="start-head">
			<h1 id="start-heading">Start a session</h1>
			<p>Bring in a recording, pick up where you left off, or open a worked example.</p>
		</header>

		<!-- 1. Actions: four cards of equal weight ------------------------------ -->
		<div class="primary-row">
			<button type="button" class="primary-card" class:armed={dragActive} onclick={() => openImportData()}>
				<span class="primary-icon"><Icon name="add-file" width={26} height={26} /></span>
				<span class="primary-title">Import data</span>
				<span class="primary-sub">
					{dragActive ? 'Drop to import' : 'CSV, Actiwatch, ActTrust, or a folder of records'}
				</span>
				<span class="primary-hint">or drop a file anywhere on this page</span>
			</button>

			<button type="button" class="primary-card" onclick={loadSession}>
				<span class="primary-icon"><Icon name="sessionload" width={26} height={26} /></span>
				<span class="primary-title">Load session</span>
				<span class="primary-sub">Reopen a saved session with its data, pipeline and figures intact</span>
			</button>

			<button type="button" class="primary-card" onclick={() => (showAi = true)}>
				<span class="primary-icon"><Icon name="aibot" width={26} height={26} /></span>
				<span class="primary-title">Build a workload with AI</span>
				<span class="primary-sub">Describe what you want to find out and let AI assemble the analysis</span>
			</button>

			<button type="button" class="primary-card" onclick={() => onDismiss?.()}>
				<span class="primary-icon"><Icon name="workflow" width={26} height={26} /></span>
				<span class="primary-title">Start with a blank canvas</span>
				<span class="primary-sub">Build it yourself, node by node</span>
			</button>
		</div>

		<!-- 2. Recent ----------------------------------------------------------- -->
		{#if recents.items.length > 0}
		<section class="start-section">
			<h2 class="section-label">Recent</h2>
				<ul class="recent-list">
					{#each recents.items as entry (entry.id)}
						<li class="recent-row">
							<button type="button" class="recent-open" onclick={() => reopenRecent(entry)}>
								<span class="thumb thumb-sm">
									{#if entry.thumb}{@html entry.thumb}{:else}{@html thumbnailForWorkflow(entry.workflow)}{/if}
								</span>
								<span class="recent-text">
									<span class="recent-name">{entry.name}</span>
									<span class="recent-meta">
										{entry.meta}{entry.meta ? ' · ' : ''}{relativeTime(entry.ts)}
										<!-- Only file-backed rows can need re-selecting; example rows reopen by url. -->
										{#if !canReopen && !entry.url}<span class="reselect"> · re-select file</span>{/if}
									</span>
								</span>
							</button>
							<button
								type="button"
								class="recent-dismiss"
								aria-label={`Remove ${entry.name} from recents`}
								onclick={() => removeRecent(entry.id)}
							>
								<Icon name="close" width={13} height={13} />
							</button>
						</li>
					{/each}
				</ul>
				<p class="empty-note">
					Stored on this device only. The session data itself never leaves your machine.
				</p>
				<button type="button" class="clear-link" onclick={() => (confirmClear = true)}>Clear list</button>
		</section>
		{/if}

		<!-- 3. Tour: always above the gallery, so the call to action stays above the fold. -->
		{@render tourSection()}

		<!-- 4. Example sessions ------------------------------------------------- -->
		<section class="start-section">
			<div class="section-head">
				<h2 class="section-label">Example sessions</h2>
				<div class="search-box">
					<Icon name="search" width={14} height={14} />
					<input
						type="search"
						bind:value={query}
						placeholder="Search examples"
						aria-label="Search example sessions"
					/>
				</div>
				{#if filtered}
					<span class="search-count">{filtered.length} of {allExamples.length}</span>
				{/if}
				<button
					type="button"
					class="browse-link"
					onclick={() => { loadMode = 'example'; showLoadSession = true; }}
				>
					Browse all {allExamples.length} →
				</button>
			</div>

			{#if manifestError}
				<p class="empty-note">Could not load the example library ({manifestError}).</p>
			{:else if filtered && filtered.length === 0}
				<p class="empty-note">
					Nothing matches “{query}”. Try a rhythm term (tau, split, tidal), a test name (ANOVA,
					chi-square), or browse the full library.
				</p>
			{:else}
				<!-- ONE mixed row: two from each group, so the grid fills exactly. The group rides on
				     each card as a caption, since there are no group headings to carry it. -->
				<div class="example-grid">
					{#each shownExamples as s (s.id)}
						<div class="example-card" class:busy={busyId === s.id}>
							<span class="example-group">{SHORT_GROUP[s.group] ?? s.group}</span>
							<span class="thumb">{@html thumbnailForWorkflow(s.id)}</span>
							<span class="example-title">{displayName(s.name)}</span>
							<span class="example-sub">{s.summary}</span>
							<!-- One action per card: an overlay button covering the whole card. -->
							<button
								type="button"
								class="card-overlay"
								onclick={() => launchExample(s)}
								disabled={busyId === s.id}
							>
								<span class="sr-only">Open {s.name} with its example data</span>
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</section>

	</div>
</div>

<LoadSessionModal bind:showModal={showLoadSession} initialSourceMode={loadMode} />
<AiPrompt bind:showModal={showAi} />

<Modal bind:showModal={confirmClear} width="24rem">
	{#snippet header()}<h2>Clear recent sessions?</h2>{/snippet}
	<p class="confirm-copy">
		This removes the list and any cached file references stored in this browser. Your session files
		on disk are not touched.
	</p>
	<div class="confirm-actions">
		<button type="button" class="btn-quiet" onclick={() => (confirmClear = false)}>Cancel</button>
		<button type="button" class="btn-danger" onclick={doClear}>Clear list</button>
	</div>
</Modal>

<style>
	/* Scrim over the whole viewport. Fixed, and above BOTH pieces of app chrome (the navbar and
	   the tool rail each sit at z-index 1000), so this reads as a modal over the app rather than
	   as a panel inside it. Covering the rail also means no left inset is needed to clear it. */
	.start {
		position: fixed;
		inset: 0;
		z-index: 1100;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		overflow-y: auto;
		padding: var(--space-6) var(--space-5);
		background: rgba(0, 0, 0, 0.28);
	}
	/* The panel itself: a card floating over the canvas, not a replacement view. */
	.start-inner {
		width: 100%;
		max-width: 64rem;
		margin: auto;
		padding: var(--space-7) var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		background: var(--surface-card);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-3);
	}

	.start-head h1 {
		margin: 0 0 var(--space-2);
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--color-lightness-20);
	}
	.start-head p {
		margin: 0;
		font-size: var(--font-lg);
		color: var(--color-text-muted);
	}

	/* --- primary ---------------------------------------------------------- */
	.primary-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: var(--space-5);
	}
	.primary-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-5);
		background: var(--surface-card);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-1);
		text-align: left;
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}
	.primary-card:hover,
	.primary-card:focus-visible {
		border-color: var(--color-accent);
		box-shadow: var(--shadow-2);
	}
	/* Drop-armed state: the import card is the page's drop target. */
	.primary-card.armed {
		border-color: var(--color-accent);
		border-style: dashed;
		background: var(--color-hover, var(--color-lightness-96));
	}
	.primary-icon {
		color: var(--color-lightness-35);
	}
	.primary-card:hover .primary-icon,
	.primary-card.armed .primary-icon {
		color: var(--color-accent);
	}
	.primary-title {
		font-size: var(--font-lg);
		font-weight: 600;
		color: var(--color-lightness-20);
	}
	.primary-sub {
		font-size: var(--font-sm);
		color: var(--color-text-muted);
		line-height: 1.4;
	}
	.primary-hint {
		font-size: var(--font-xs);
		color: var(--color-lightness-60);
	}

	/* --- secondary (deliberately low weight) ------------------------------- */
	/* Chips, not text links: they read as pressable without competing with the two primary cards.
	   Still visibly tertiary — outline only, no fill, smaller type. */
	/* --- section scaffolding ----------------------------------------------- */
	.start-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	/* The quiet section label used by Recent / Examples / Tour. */
	.section-label {
		margin: 0;
		font-size: var(--font-xs);
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-lightness-60);
	}
	.empty-note {
		margin: 0;
		font-size: var(--font-md);
		color: var(--color-text-muted);
		max-width: 44rem;
	}

	/* --- recents ------------------------------------------------------------ */
	.recent-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.recent-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		border-radius: var(--radius-md);
	}
	.recent-row:hover {
		background: var(--color-lightness-96);
	}
	.recent-row:hover .recent-name,
	.recent-open:focus-visible .recent-name {
		color: var(--color-accent);
	}
	.recent-open {
		flex: 1 1 auto;
		display: flex;
		align-items: center;
		gap: var(--space-5);
		min-width: 0;
		padding: var(--space-3) var(--space-4);
		background: none;
		border: none;
		text-align: left;
		cursor: pointer;
	}
	.recent-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.recent-name {
		font-size: var(--font-lg);
		color: var(--color-lightness-20);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.recent-meta {
		font-size: var(--font-xs);
		color: var(--color-text-muted);
	}
	.reselect {
		color: var(--color-lightness-55);
		font-style: italic;
	}
	/* Dismiss appears on hover/focus but stays reachable by keyboard at all times. */
	.recent-dismiss {
		flex: 0 0 auto;
		opacity: 0;
		padding: var(--space-2);
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-lightness-55);
		cursor: pointer;
	}
	.recent-row:hover .recent-dismiss,
	.recent-dismiss:focus-visible {
		opacity: 1;
	}
	.recent-dismiss:hover {
		color: var(--color-icon-close-hover);
	}
	.clear-link {
		align-self: flex-start;
		padding: 0;
		background: none;
		border: none;
		font-size: var(--font-xs);
		color: var(--color-lightness-55);
		text-decoration: underline;
		cursor: pointer;
	}
	.clear-link:hover,
	.clear-link:focus-visible {
		color: var(--color-accent);
	}

	/* --- examples ----------------------------------------------------------- */
	/* 9.5rem tracks give six across at the panel's 64rem, which is exactly the six cards the
	   mixed row shows — so the grid fills with no ragged tail. */
	.example-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
		gap: var(--space-5);
	}
	.section-head {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		flex-wrap: wrap;
	}
	.section-head .section-label {
		margin-right: auto;
	}
	.search-box {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-4);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-md);
		background: var(--surface-card);
		color: var(--color-lightness-55);
		min-width: 13rem;
	}
	.search-box:focus-within {
		border-color: var(--color-accent);
	}
	.search-box input {
		border: none;
		outline: none;
		background: none;
		font: inherit;
		font-size: var(--font-md);
		color: var(--color-lightness-20);
		width: 100%;
	}
	.search-count {
		font-size: var(--font-sm);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.browse-link {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: var(--font-sm);
		color: var(--color-accent);
		text-decoration: underline;
		cursor: pointer;
	}
	.browse-link:hover,
	.browse-link:focus-visible {
		color: var(--color-lightness-20);
	}
	/* The group label rides on the card now that there are no group rows to head. */
	.example-group {
		font-size: var(--font-2xs);
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-lightness-55);
	}
	.example-card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-4);
		background: var(--surface-card);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-lg);
		transition: border-color 0.15s ease;
	}
	.example-card:hover,
	.example-card:focus-within {
		border-color: var(--color-accent);
	}
	.example-card.busy {
		opacity: 0.6;
	}
	.thumb {
		display: block;
		width: 100%;
		aspect-ratio: 3 / 2;
		color: var(--color-lightness-35);
		background: var(--color-lightness-96);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	.thumb :global(svg) {
		width: 100%;
		height: 100%;
		display: block;
	}
	.thumb-sm {
		width: 46px;
		flex: 0 0 46px;
		aspect-ratio: 3 / 2;
	}
	.example-title {
		font-size: var(--font-md);
		font-weight: 600;
		color: var(--color-lightness-20);
	}
	.example-sub {
		font-size: var(--font-xs);
		color: var(--color-text-muted);
		line-height: 1.35;
	}
	/* Overlay carries the primary action; the secondary link stacks above it. */
	.card-overlay {
		position: absolute;
		inset: 0;
		background: none;
		border: none;
		border-radius: var(--radius-lg);
		cursor: pointer;
		z-index: 1;
	}
	.card-overlay:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 2px;
	}

	/* --- tour band (the only high-contrast element on the page) -------------- */
	.tour-band {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-6);
		padding: var(--space-6) var(--space-7);
		border-radius: var(--radius-lg);
		background: var(--color-lightness-20);
		color: var(--color-lightness-96);
	}
	.tour-copy {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.tour-copy strong {
		font-size: 1.05rem;
	}
	.tour-copy span {
		font-size: var(--font-md);
		color: var(--color-lightness-80);
	}
	.tour-cta {
		flex: 0 0 auto;
		padding: var(--space-4) var(--space-6);
		background: var(--color-lightness-96);
		color: var(--color-lightness-20);
		border: none;
		border-radius: var(--radius-md);
		font-size: var(--font-lg);
		font-weight: 600;
		cursor: pointer;
	}
	.tour-cta:hover,
	.tour-cta:focus-visible {
		background: var(--color-accent);
		color: var(--surface-card);
	}

	/* --- confirm ------------------------------------------------------------ */
	.confirm-copy {
		margin: 0 0 var(--space-6);
		font-size: var(--font-md);
		color: var(--color-text-muted);
	}
	.confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-4);
	}
	.btn-quiet,
	.btn-danger {
		padding: var(--space-3) var(--space-6);
		border-radius: var(--radius-sm);
		font-size: var(--font-md);
		cursor: pointer;
	}
	.btn-quiet {
		background: none;
		border: 1px solid var(--color-lightness-80);
		color: var(--color-lightness-30);
	}
	.btn-danger {
		background: var(--color-icon-close-hover);
		border: 1px solid transparent;
		color: var(--color-lightness-15);
		font-weight: 600;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	/* --- responsive --------------------------------------------------------- */
	@media (max-width: 40rem) {
		.primary-row {
			grid-template-columns: 1fr;
		}
		.section-head {
			gap: var(--space-4);
		}
		.search-box {
			min-width: 0;
			flex: 1 1 100%;
			order: 3;
		}
		.tour-band {
			flex-direction: column;
			align-items: stretch;
		}
		/* Recents drop the metadata line before the name. */
		.recent-meta {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.primary-card,
		.example-card {
			transition: none;
		}
	}
</style>
