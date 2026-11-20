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
	//   3. Unsaved work (above the actions), Recent files, Tour and Examples each sit under a
	//      quiet section label; the first two only when there is something in them.
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
	import { AppAssetUnavailableError, describeAssetError, HOSTED_URL } from '$lib/start/offline.js';
	import { focusTrap } from '$lib/utils/focusTrap.js';
	import { importJson } from '$lib/components/iconActions/Setting.svelte';
	import { confirmDiscard, confirmReplaceSession } from '$lib/core/sessionLoad.svelte.js';
	import { addNotification } from '$lib/core/notifications.svelte.js';
	import { formatSavedAt } from '$lib/core/crashRecovery.js';
	import {
		autosave,
		describeSummary,
		discardAutosave,
		restoreAutosave
	} from '$lib/core/autosave.svelte.js';
	import {
		recents,
		loadRecents,
		openRecent,
		removeRecent,
		clearRecents,
		relativeTime
	} from '$lib/start/recentSessions.svelte.js';
	import { onMount } from 'svelte';

	// `summoned` = reopened from Help → "Welcome screen" OVER existing work (the TODO
	// note's summoned-over-work case). Same overlay — it already has the full modal
	// semantics (scrim, role=dialog + aria-modal, Escape) — but purely informational:
	// it gets an explicit close button, and the blank-canvas card becomes "back to
	// your session" since there is a session to go back to. Dismissing never clears
	// anything either way.
	let { onDismiss = null, summoned = false } = $props();

	let dragActive = $state(false);
	let showLoadSession = $state(false);
	let showAi = $state(false);
	let exampleGroups = $state([]);
	let manifestError = $state('');
	// True when the library cannot be reached at all (offline download, no connection),
	// as opposed to a server error: then the search and "full library" links are moot.
	let examplesUnavailable = $state(false);
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

	/**
	 * What a search reads. `keywords` matters most: the manifest writes it with the node names a
	 * session uses, so "cosinor" finds every workflow that runs one even when its title does not
	 * say so. The generator writes a string; an array is accepted so a hand-written entry still works.
	 */
	const searchText = (s) => {
		const kw = Array.isArray(s.keywords) ? s.keywords.join(' ') : (s.keywords ?? '');
		return `${s.name} ${s.summary} ${s.group} ${kw}`.toLowerCase();
	};

	/** null when not searching, so an empty result is distinguishable from "no query". */
	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return null;
		return allExamples.filter((s) => searchText(s).includes(q));
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
			.catch((e) => {
				manifestError = describeAssetError(e);
				examplesUnavailable = e instanceof AppAssetUnavailableError;
			});
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

	// --- recent files (recentSessions.svelte.js) -----------------------------------------------
	// Session files saved or opened here through a file handle (Chromium browsers), so each
	// reopens in one click. Absent when there are none: a first-time visitor gets no section
	// explaining a list they have not got.
	onMount(() => {
		loadRecents();
	});

	/** Rows whose file could not be found when clicked: they offer Find it / Remove instead. */
	let missingIds = $state([]);

	const recentWhen = (entry) =>
		`${entry.action === 'saved' ? 'Saved' : 'Opened'} ${relativeTime(entry.ts)}`;
	/** "Saved 2 hours ago · 12 columns · 3 plots": one string, so the separators keep their spaces. */
	const recentDetail = (entry) => [recentWhen(entry), entry.meta].filter(Boolean).join(' · ');

	async function reopenRecent(entry) {
		busyId = `recent:${entry.id}`;
		try {
			// Asks for permission to read the file again when the browser needs to (this click is the
			// user gesture that request needs).
			const res = await openRecent(entry.id);
			if (res.status === 'ok') {
				if (await openSessionFile(res.file, res.handle)) onDismiss?.();
			} else if (res.status === 'missing' || res.status === 'no-handle') {
				missingIds = [...missingIds, entry.id];
			} else if (res.status === 'denied') {
				addNotification(
					`AnCiR was not given permission to open "${entry.fileName}". Click it again to be ` +
						'asked again, or use Load session.',
					'warning',
					10000
				);
			} else {
				notifyFailure('Could not open that session file.', res.error);
			}
		} catch (e) {
			notifyFailure('Could not open that session file.', e);
		} finally {
			busyId = null;
		}
	}

	/** A missing file's row: pick the file where it is now; the stale row goes once one is picked. */
	async function findRecent(entry) {
		const res = await pickSessionFile();
		if (res.status === 'cancelled') return;
		if (res.status === 'unsupported') {
			loadMode = 'file';
			showLoadSession = true;
			return;
		}
		busyId = `recent:${entry.id}`;
		try {
			await forgetRecent(entry);
			if (await openSessionFile(res.file, res.handle)) onDismiss?.();
		} catch (e) {
			notifyFailure('Could not open that session file.', e);
		} finally {
			busyId = null;
		}
	}

	async function forgetRecent(entry) {
		missingIds = missingIds.filter((id) => id !== entry.id);
		await removeRecent(entry.id);
	}

	async function clearRecentFiles() {
		const ok = await confirmDiscard(
			'Clear the list of recent files? The files themselves are not touched.',
			'Clear list'
		);
		if (!ok) return;
		missingIds = [];
		await clearRecents();
		addNotification('Cleared the list of recent files.', 'info');
	}

	// --- unsaved work (autosave.svelte.js) -----------------------------------------------------
	// Copies of sessions that were never saved to a file, left by tabs that are no longer open.
	// They lead the screen, above the four actions: picking up lost work is the most urgent
	// thing anyone arriving here could want, and the section is absent when there is none.

	const savedAtLabel = (ms) => formatSavedAt(new Date(ms).toISOString());

	async function restoreCopy(copy) {
		busyId = `restore:${copy.slot}`;
		try {
			const restored = await restoreAutosave(copy.slot, {
				load: (session) => importJson(session),
				confirmReplace: confirmReplaceSession
			});
			if (!restored) return;
			addNotification(
				`Restored "${copy.name}" from its autosaved copy. Save it to a file to keep it.`,
				'info',
				8000
			);
			onDismiss?.();
		} catch (e) {
			notifyFailure('Could not restore that autosaved session.', e);
		} finally {
			busyId = null;
		}
	}

	async function discardCopy(copy) {
		const ok = await confirmDiscard(
			`Discard the autosaved copy of "${copy.name}"? It was never saved to a file, so it ` +
				'cannot be recovered afterwards.',
			'Discard'
		);
		if (ok) await discardAutosave(copy.slot);
	}

	/**
	 * Focus in, the Tab trap and focus restore are focusTrap's (attached below); Escape stays here
	 * because it has more to decide than "close".
	 *
	 * Escape dismisses to the blank canvas behind, but only when nothing of ours is stacked on top:
	 * a child dialog handles its own Escape, and closing it must not also close the start screen.
	 */
	function handleKeydown(e) {
		if (e.key !== 'Escape') return;
		if (showLoadSession || showAi) return;
		// Any native modal on top owns Escape too: the "Replace session?" question that opening an
		// example asks when the screen was summoned over work is one, and cancelling it must not
		// also close this screen.
		if (document.querySelector('dialog[open]')) return;
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
	tabindex="-1"
	{@attach focusTrap({ focusContainer: true })}
	use:canvasFileDrop={{ onActive: (v) => (dragActive = v), onDrop: handleDrop }}
>
	<div class="start-inner">
		<header class="start-head">
			<h1 id="start-heading">Start a session</h1>
			<p>Bring in a recording, pick up where you left off, or open a worked example.</p>
			{#if summoned}
				<button
					type="button"
					class="start-close"
					aria-label="Close and return to your session"
					data-testid="start-close"
					onclick={() => onDismiss?.()}
				>
					<Icon name="close" width={16} height={16} />
				</button>
			{/if}
		</header>

		<!-- 0. Unsaved work: only when a closed tab left an autosaved copy ------------ -->
		{#if autosave.offers.length > 0}
			<section class="start-section" aria-labelledby="recover-heading" data-testid="start-recover">
				<h2 class="section-label" id="recover-heading">Unsaved work</h2>
				<ul class="recover-list">
					{#each autosave.offers as copy (copy.slot)}
						<li class="recover-row" class:busy={busyId === `restore:${copy.slot}`}>
							<span class="recover-icon"><Icon name="clock" width={20} height={20} /></span>
							<span class="recover-text">
								<span class="recover-name">{copy.name}</span>
								<span class="recover-sub">
									Autosaved {savedAtLabel(copy.savedAt)}
									<span aria-hidden="true">·</span>
									{describeSummary(copy.summary)}
								</span>
							</span>
							<span class="recover-actions">
								<button
									type="button"
									class="recover-btn primary"
									disabled={busyId != null}
									aria-label={`Restore ${copy.name}, autosaved ${savedAtLabel(copy.savedAt)}`}
									onclick={() => restoreCopy(copy)}>Restore</button
								>
								<button
									type="button"
									class="recover-btn"
									disabled={busyId != null}
									aria-label={`Discard the autosaved copy of ${copy.name}`}
									onclick={() => discardCopy(copy)}>Discard</button
								>
							</span>
						</li>
					{/each}
				</ul>
				<p class="recover-hint">
					{autosave.offers.length === 1
						? 'Kept in this browser because it was never saved to a file. Restore opens it here; then save it to keep it.'
						: 'Kept in this browser because they were never saved to a file. Restore opens one here; then save it to keep it.'}
				</p>
			</section>
		{/if}

		<!-- 1. Actions: four cards of equal weight ------------------------------ -->
		<div class="primary-row">
			<button
				type="button"
				class="primary-card"
				class:armed={dragActive}
				onclick={() => openImportData()}
			>
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
				<span class="primary-sub"
					>Reopen a saved session with its data, pipeline and figures intact</span
				>
			</button>

			<button type="button" class="primary-card" onclick={() => (showAi = true)}>
				<span class="primary-icon"><Icon name="aibot" width={26} height={26} /></span>
				<span class="primary-title">Build a session with AI</span>
				<span class="primary-sub"
					>Describe what you want to find out and let AI assemble the analysis</span
				>
			</button>

			<button type="button" class="primary-card" onclick={() => onDismiss?.()}>
				<!-- "workflow" was never a registered icon name, so this card rendered a blank box.
				     "process" is the app's own icon for the workflow canvas, which is where this lands. -->
				<span class="primary-icon"><Icon name="process" width={26} height={26} /></span>
				<span class="primary-title"
					>{summoned ? 'Back to your session' : 'Start with a blank canvas'}</span
				>
				<span class="primary-sub"
					>{summoned
						? 'Close this screen (your work is untouched)'
						: 'Build it yourself, node by node'}</span
				>
			</button>
		</div>

		<!-- 2. Recent files: only when there are some ------------------------------ -->
		{#if recents.items.length > 0}
			<section class="start-section" aria-labelledby="recent-heading" data-testid="start-recent">
				<div class="section-head">
					<h2 class="section-label" id="recent-heading">Recent files</h2>
					<button
						type="button"
						class="browse-link"
						data-testid="start-recent-clear"
						onclick={clearRecentFiles}>Clear recent files</button
					>
				</div>
				<ul class="recent-list">
					{#each recents.items as entry (entry.id)}
						{@const missing = missingIds.includes(entry.id)}
						<li
							class="recent-row"
							class:busy={busyId === `recent:${entry.id}`}
							class:missing
							data-testid="start-recent-row"
						>
							<button
								type="button"
								class="recent-open"
								title={entry.fileName}
								disabled={busyId != null}
								aria-label={missing
									? `${entry.name} could not be found`
									: `Open ${entry.fileName}, ${recentWhen(entry).toLowerCase()}`}
								onclick={() => reopenRecent(entry)}
							>
								<!-- eslint-disable-next-line svelte/no-at-html-tags -- the thumb is an SVG string built in $lib/start/thumbnails.js from a seeded PRNG over the file's name; no file content reaches it -->
								<span class="thumb thumb-sm">{@html entry.thumb}</span>
								<span class="recent-text">
									<span class="recent-name">{entry.name}</span>
									{#if missing}
										<span class="recent-sub recent-warn">
											Not found: it may have been moved, renamed or deleted.
										</span>
									{:else}
										<span class="recent-sub">{recentDetail(entry)}</span>
									{/if}
								</span>
							</button>
							{#if missing}
								<span class="recent-fix">
									<button
										type="button"
										class="recover-btn"
										disabled={busyId != null}
										onclick={() => findRecent(entry)}>Find it…</button
									>
									<button
										type="button"
										class="recover-btn"
										disabled={busyId != null}
										onclick={() => forgetRecent(entry)}>Remove</button
									>
								</span>
							{:else}
								<button
									type="button"
									class="recent-remove"
									disabled={busyId != null}
									aria-label={`Remove ${entry.fileName} from recent files`}
									title="Remove from recent files"
									onclick={() => forgetRecent(entry)}
								>
									<Icon name="close" width={14} height={14} />
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<!-- 3. Tour: above the gallery, so the call to action stays above the fold. -->
		<section class="start-section">
			<h2 class="section-label">New here?</h2>
			<div class="tour-band">
				<div class="tour-copy">
					<strong>Take the tour</strong>
					<span>A short guided pass: import a record, build a session, read the output.</span>
				</div>
				<button
					type="button"
					class="tour-cta"
					onclick={() => {
						openTourPicker();
						onDismiss?.();
					}}
				>
					Take the tour
				</button>
			</div>
		</section>

		<!-- 4. Example sessions -------------------------------------------------- -->
		<section class="start-section">
			<div class="section-head">
				<h2 class="section-label">Example sessions</h2>
				{#if !manifestError}
					<div class="search-box">
						<Icon name="search" width={14} height={14} />
						<input
							type="search"
							bind:value={query}
							placeholder="Search examples"
							aria-label="Search example sessions"
						/>
					</div>
				{/if}
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
				<p class="empty-note" data-testid="examples-unavailable">
					{manifestError}
					{#if examplesUnavailable}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- HOSTED_URL is an absolute external URL (the hosted app), not a SvelteKit route, so there is nothing for resolve() to resolve -->
						<a class="browse-link" href={HOSTED_URL} target="_blank" rel="noopener"
							>Open the hosted version</a
						>
					{/if}
				</p>
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
												<!-- eslint-disable-next-line svelte/no-at-html-tags -- thumbnailForWorkflow returns an SVG string built entirely in $lib/start/thumbnails.js from a seeded PRNG; no user or network data reaches it -->
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
									class="more-link hit-target"
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
			{#if !examplesUnavailable}
				<p class="library-note">
					These are the worked workflows.
					<button
						type="button"
						class="browse-link"
						onclick={() => {
							loadMode = 'example';
							showLoadSession = true;
						}}
					>
						Browse the full library →
					</button>
					for single-node demos, plot examples and raw datasets.
				</p>
			{/if}
		</section>
	</div>
</div>

<LoadSessionModal bind:showModal={showLoadSession} initialSourceMode={loadMode} />
<AiPrompt bind:showModal={showAi} />

<style>
	/* Scrim over the whole viewport. Fixed, and above BOTH pieces of app chrome (the navbar and
	   the tool rail each sit at z-index 1000), so this reads as a modal over the app rather than
	   as a panel inside it. Covering the rail also means no left inset is needed to clear it. */
	/* Focus lands on the overlay itself when it opens (focusTrap's focusContainer), so a keyboard
	   user starts inside it without the first card opening on a focus ring. Tab then moves to the
	   cards, which carry their own rings. */
	.start:focus {
		outline: none;
	}
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

	.start-head {
		position: relative;
	}
	/* Only rendered when summoned over work: an escape hatch that reads as "close",
	   matching the rest of the app's icon buttons. */
	.start-close {
		position: absolute;
		top: 0;
		right: 0;
		margin: 0;
		padding: var(--space-3);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.start-close:hover {
		background: var(--color-lightness-95);
		color: var(--color-lightness-20);
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

	/* --- unsaved work ------------------------------------------------------- */
	/* Rows in the example rows' vocabulary (icon, name, one-line detail), but in a bordered
	   list with their own actions: these are the user's own sessions, and the one section that
	   asks for a decision. */
	.recover-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}
	.recover-row {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5);
		background: var(--surface-card);
	}
	.recover-row + .recover-row {
		border-top: 1px solid var(--color-lightness-90);
	}
	.recover-row.busy {
		opacity: 0.6;
	}
	.recover-icon {
		flex: 0 0 auto;
		display: inline-flex;
		color: var(--color-accent-text);
	}
	.recover-text {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.recover-name,
	.recover-sub {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.recover-name {
		font-size: var(--font-md);
		font-weight: 600;
		color: var(--color-lightness-20);
	}
	.recover-sub {
		font-size: var(--font-xs);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.recover-actions {
		flex: 0 0 auto;
		display: flex;
		gap: var(--space-3);
	}
	.recover-btn {
		padding: var(--space-2) var(--space-5);
		font: inherit;
		font-size: var(--font-sm);
		font-weight: 600;
		color: var(--color-lightness-25);
		background: var(--surface-card);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-md);
		cursor: pointer;
	}
	.recover-btn:hover:not(:disabled),
	.recover-btn:focus-visible {
		border-color: var(--color-lightness-35);
	}
	/* Filled primary with a white label: --color-accent-fill is 5.28:1 (see .tour-cta). */
	.recover-btn.primary {
		color: white;
		background: var(--color-accent-fill);
		border-color: var(--color-accent-fill);
	}
	.recover-btn.primary:hover:not(:disabled),
	.recover-btn.primary:focus-visible {
		background: color-mix(in srgb, var(--color-accent-fill) 88%, black);
		border-color: color-mix(in srgb, var(--color-accent-fill) 88%, black);
	}
	.recover-btn:disabled {
		cursor: default;
		opacity: 0.6;
	}
	.recover-hint {
		margin: 0;
		font-size: var(--font-xs);
		color: var(--color-text-muted);
	}

	/* --- recent files ------------------------------------------------------- */
	/* The example rows' vocabulary (small thumbnail, name, one-line detail), two to a line where
	   there is room (a full-width panel), one on a narrow screen; each with its own remove button. */
	.recent-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
		gap: var(--space-1) var(--space-6);
		/* A row showing "Not found" grows; its neighbour keeps its own height. */
		align-items: start;
	}
	.recent-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		min-width: 0;
		border-radius: var(--radius-md);
	}
	.recent-row:hover {
		background: var(--color-lightness-96);
	}
	.recent-row:hover .recent-name,
	.recent-open:focus-visible .recent-name {
		color: var(--color-accent-text);
	}
	.recent-row.busy {
		opacity: 0.6;
	}
	.recent-open {
		flex: 1 1 0;
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-width: 0;
		padding: var(--space-3);
		background: none;
		border: none;
		border-radius: var(--radius-md);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.recent-open:disabled {
		cursor: default;
	}
	.recent-open:focus-visible {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}
	.recent-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.recent-name,
	.recent-sub {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.recent-name {
		font-size: var(--font-md);
		color: var(--color-lightness-20);
	}
	.recent-sub {
		font-size: var(--font-xs);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
	/* The one line on this screen that reports a problem: it wraps rather than hiding the end. */
	.recent-warn {
		white-space: normal;
		color: var(--color-warning-text);
	}
	.recent-remove {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		margin-right: var(--space-2);
		padding: 0;
		background: none;
		border: none;
		border-radius: var(--radius-md);
		color: var(--color-lightness-45);
		cursor: pointer;
	}
	.recent-remove:hover:not(:disabled),
	.recent-remove:focus-visible {
		background: var(--color-lightness-90);
		color: var(--color-lightness-20);
	}
	.recent-remove:disabled {
		cursor: default;
	}
	/* Find it / Remove sit under the message, lined up with the text rather than the thumbnail. */
	.recent-fix {
		flex: 1 0 100%;
		display: flex;
		gap: var(--space-3);
		padding: 0 var(--space-3) var(--space-3) calc(var(--space-3) + 40px + var(--space-4));
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
	/* One step lighter than .primary-sub (--color-text-muted) on purpose: the card
	   runs title → sub → hint as three levels of emphasis, and lightness-45 clears
	   4.5:1 (4.74:1) without collapsing the ramp into two. */
	.primary-hint {
		font-size: var(--font-xs);
		color: var(--color-lightness-45);
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
		color: var(--color-text-muted);
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
		color: var(--color-accent-text);
		text-decoration: underline;
		cursor: pointer;
	}
	.empty-note .browse-link {
		font-size: inherit;
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
		color: var(--color-text-muted);
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
		color: var(--color-accent-text);
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
		color: var(--color-accent-text);
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
	/* Hover/focus turns this into a filled primary with a white 14px/600 label — under
	   18.66px, so the 4.5:1 rule applies, not the large-text 3:1. --color-accent-fill
	   is 5.28:1; --color-accent was 2.84:1. */
	.tour-cta:hover,
	.tour-cta:focus-visible {
		background: var(--color-accent-fill);
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
		/* The actions drop below the name rather than squeezing it to nothing. */
		.recover-row {
			flex-wrap: wrap;
		}
		.recover-text {
			flex-basis: calc(100% - 20px - var(--space-4));
		}
		.recover-actions {
			margin-left: calc(20px + var(--space-4));
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
