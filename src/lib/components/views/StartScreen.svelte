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
	//   3. Tour and Examples each sit under a quiet section label.
	//   4. The tour band is the only high-contrast element.
	//
	// The whole overlay is a drop target for import — dropping anywhere starts an import — using the
	// existing canvasFileDrop action, which already does the drag-depth counting AND ignores
	// internal app drags (dragging a data column must not light up the import card).
	import Icon from '$lib/icons/Icon.svelte';
	import LoadSessionModal from '$lib/components/workflow/LoadSessionModal.svelte';
	import AiPrompt from '$lib/components/views/modals/AiPrompt.svelte';
	import { canvasFileDrop } from '$lib/core/canvasFileDrop.js';
	import { openImportData, openImportDataFiles } from '$lib/core/dataSourceActions.js';
	import { openPicker as openTourPicker } from '$lib/core/tourRunner.svelte.js';
	import { thumbnailForWorkflow } from '$lib/start/thumbnails.js';
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
	let exampleGroups = $state([]);
	let manifestError = $state('');
	let busyId = $state(null);
	let query = $state('');
	// The load-session modal is reused for two jobs: opening a file, and browsing the full library.
	let loadMode = $state('file');
	/**
	 * One flag for all three columns, not one per column. The columns read as a single block, so
	 * expanding just one leaves the other two truncated at a ragged, arbitrary-looking boundary;
	 * and "4 shown of 10" is a property of the view, not of the group.
	 */
	let showAll = $state(false);

	// One column per group, so the heading is the column head rather than a caption on every row.
	const SHORT_GROUP = {
		'Rhythm & circadian': 'Rhythm and circadian',
		'General statistics': 'General statistics',
		'Reading the output': 'Reading the output'
	};
	const PER_COLUMN = 4;

	const allExamples = $derived(
		exampleGroups.flatMap(([group, sessions]) => sessions.map((s) => ({ ...s, group })))
	);

	/** null when not searching, so an empty result is distinguishable from "no query". */
	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return null;
		return allExamples.filter((s) =>
			`${s.name} ${s.summary} ${s.group}`.toLowerCase().includes(q)
		);
	});

	/**
	 * The columns the grid renders. Searching narrows each column IN PLACE rather than collapsing
	 * to one flat list: the group a hit belongs to is itself information ("chi-square is a
	 * statistics example"), and holding the columns still means the layout doesn't jump per
	 * keystroke. A column with no hits keeps its heading and says so, for the same reason.
	 *
	 * Only the unsearched view is capped at PER_COLUMN; a search is an explicit request to see
	 * everything that matches, so it ignores both the cap and the expand toggle.
	 */
	const columns = $derived.by(() => {
		const hits = filtered;
		const capped = !hits && !showAll;
		return exampleGroups.map(([group, sessions]) => {
			const items = hits ? hits.filter((s) => s.group === group) : sessions;
			const shown = capped ? items.slice(0, PER_COLUMN) : items;
			return {
				group,
				label: SHORT_GROUP[group] ?? group,
				items: shown.map((s) => ({ ...s, group })),
				hidden: items.length - shown.length
			};
		});
	});

	/**
	 * Whether the cap bites at all. Derived from the FULL groups rather than from what is on show,
	 * so it stays true once expanded — otherwise the toggle would vanish at the moment it became
	 * "Show fewer" and there would be no way back.
	 */
	const overflows = $derived(exampleGroups.some(([, sessions]) => sessions.length > PER_COLUMN));

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

	/**
	 * Escape dismisses to the blank canvas behind, but only when nothing of ours is stacked on top:
	 * a child dialog handles its own Escape, and closing it must not also close the start screen.
	 */
	function handleKeydown(e) {
		if (e.key !== 'Escape') return;
		if (showLoadSession || showAi) return;
		// A search in progress owns Escape: clearing the query must not also close the screen.
		if (query) {
			query = '';
			return;
		}
		onDismiss?.();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

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
				<span class="primary-title">Build a session with AI</span>
				<span class="primary-sub">Describe what you want to find out and let AI assemble the analysis</span>
			</button>

			<button type="button" class="primary-card" onclick={() => onDismiss?.()}>
				<!-- "workflow" was never a registered icon name, so this card rendered a blank box.
				     "process" is the app's own icon for the workflow canvas, which is where this lands. -->
				<span class="primary-icon"><Icon name="process" width={26} height={26} /></span>
				<span class="primary-title">Start with a blank canvas</span>
				<span class="primary-sub">Build it yourself, node by node</span>
			</button>
		</div>

		<!-- 2. Tour: above the gallery, so the call to action stays above the fold. -->
		<section class="start-section">
			<h2 class="section-label">New here?</h2>
			<div class="tour-band">
				<div class="tour-copy">
					<strong>Take the tour</strong>
					<span>A short guided pass: import a record, build a session, read the output.</span>
				</div>
				<button type="button" class="tour-cta" onclick={() => { openTourPicker(); onDismiss?.(); }}>
					Take the tour
				</button>
			</div>
		</section>

		<!-- 3. Example sessions -------------------------------------------------- -->
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
				{:else if overflows}
					<!-- Expands in place rather than opening the library modal: these examples are the
					     ones already on the page, so sending the reader to a dialog to see four more
					     of them is a detour. The modal stays for the WHOLE library, which is a
					     genuinely different (and much longer) list. -->
					<button type="button" class="browse-link" onclick={() => (showAll = !showAll)}>
						{showAll ? 'Show fewer' : `Show all ${allExamples.length}`}
					</button>
				{/if}
			</div>

			{#if manifestError}
				<p class="empty-note">Could not load the example library ({manifestError}).</p>
			{:else if filtered && filtered.length === 0}
				<p class="empty-note">
					Nothing matches “{query}”. Try a rhythm term (tau, split, tidal), a test name (ANOVA,
					chi-square), or browse the full library.
				</p>
			{:else}
				<!-- One column per group, each a list of compact rows. The heading is the column head,
				     so no row has to carry its own group caption. -->
				<div class="example-columns">
					{#each columns as col (col.group)}
						<div class="example-column">
							<h3 class="example-group">{col.label}</h3>
							{#if col.items.length === 0}
								<p class="column-empty">No matches</p>
							{:else}
								<ul class="example-list">
									{#each col.items as s (s.id)}
										<li class="example-row" class:busy={busyId === s.id}>
											<button
												type="button"
												class="example-open"
												onclick={() => launchExample(s)}
												disabled={busyId === s.id}
											>
												<span class="thumb thumb-sm">{@html thumbnailForWorkflow(s.id)}</span>
												<span class="example-text">
													<span class="example-name">{displayName(s.name)}</span>
													<span class="example-sub">{s.summary}</span>
												</span>
											</button>
										</li>
									{/each}
								</ul>
							{/if}
							<!-- Expands every column, not just this one: see `showAll`. Shown only in the
							     capped (unsearched) view; a search always lists every hit. -->
							<!-- "3 more" alone is meaningless read out of its column, so the button carries a
							     label that names what it reveals. -->
							{#if col.hidden > 0}
								<button
									type="button"
									class="more-link"
									onclick={() => (showAll = true)}
									aria-label={`Show ${col.hidden} more example${col.hidden === 1 ? '' : 's'} in ${col.label}`}
								>
									{col.hidden} more
								</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			<!-- A separate destination, not a bigger version of the columns above: the library also
			     holds the per-node demos, the plot demos and the raw datasets. -->
			<p class="library-note">
				These are the worked workflows.
				<button
					type="button"
					class="browse-link"
					onclick={() => { loadMode = 'example'; showLoadSession = true; }}
				>
					Browse the full library →
				</button>
				for single-node demos, plot examples and raw datasets.
			</p>
		</section>

	</div>
</div>

<LoadSessionModal bind:showModal={showLoadSession} initialSourceMode={loadMode} />
<AiPrompt bind:showModal={showAi} />

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

	/* --- examples ----------------------------------------------------------- */
	/* One column per group. Three fixed tracks rather than auto-fill: the columns ARE the three
	   groups, so a wider panel must widen them, never reflow them into a different count. */
	.example-columns {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-6);
		align-items: start;
	}
	.example-column {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
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
	/* The group name heads its column now, rather than riding on every card as a caption. */
	.example-group {
		margin: 0;
		font-size: var(--font-2xs);
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-lightness-55);
	}
	.example-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.example-row {
		display: flex;
		border-radius: var(--radius-md);
	}
	.example-row:hover {
		background: var(--color-lightness-96);
	}
	.example-row:hover .example-name,
	.example-open:focus-visible .example-name {
		color: var(--color-accent);
	}
	.example-row.busy {
		opacity: 0.6;
	}
	/* One action per row, covering the whole row: no nested buttons to trap the keyboard. */
	.example-open {
		flex: 1 1 auto;
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-width: 0;
		padding: var(--space-3);
		background: none;
		border: none;
		border-radius: var(--radius-md);
		text-align: left;
		cursor: pointer;
	}
	.example-open:focus-visible {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}
	.example-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
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
		width: 40px;
		flex: 0 0 40px;
		aspect-ratio: 3 / 2;
	}
	/* Both lines clip to one line: a column is narrow, and a wrapping title would make the rows
	   different heights, which is exactly what this layout exists to avoid. */
	.example-name,
	.example-sub {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.example-name {
		font-size: var(--font-md);
		color: var(--color-lightness-20);
	}
	.example-sub {
		font-size: var(--font-xs);
		color: var(--color-text-muted);
	}
	.column-empty {
		margin: 0;
		padding: var(--space-3);
		font-size: var(--font-xs);
		color: var(--color-text-muted);
		font-style: italic;
	}
	.more-link {
		align-self: flex-start;
		padding: 0 var(--space-3);
		background: none;
		border: none;
		font: inherit;
		font-size: var(--font-xs);
		color: var(--color-accent);
		text-decoration: underline;
		cursor: pointer;
	}
	.more-link:hover,
	.more-link:focus-visible {
		color: var(--color-lightness-20);
	}
	.library-note {
		margin: var(--space-2) 0 0;
		font-size: var(--font-xs);
		color: var(--color-text-muted);
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

	/* --- responsive --------------------------------------------------------- */
	/* Three narrow columns are worse than one readable one, so they stack rather than squeeze. */
	@media (max-width: 60rem) {
		.example-columns {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--space-5);
		}
	}

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
		/* The summary is the first thing to go when a row runs out of width. */
		.example-sub {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.primary-card {
			transition: none;
		}
	}
</style>
