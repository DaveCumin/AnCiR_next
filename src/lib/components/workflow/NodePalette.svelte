<script>
	// @ts-nocheck
	// Flowtest-style floating add-node palette in the top-right of the canvas.
	// Renders a search box + family-grouped icon tiles. Each tile delegates to
	// the existing creation modals so the underlying spawn flow is unchanged.
	import Icon from '$lib/icons/Icon.svelte';
	import MakeNewPlot from '$lib/components/views/modals/MakeNewPlot.svelte';
	import MakeNewColumn from '$lib/components/views/modals/MakeNewColumn.svelte';
	import SimulateData from '$lib/components/views/modals/SimulateData.svelte';
	import BlankColumnModal from '$lib/components/views/modals/BlankColumnModal.svelte';
	import SequenceColumnModal from '$lib/components/views/modals/SequenceColumnModal.svelte';
	import { core, appConsts, createNote, createGroup } from '$lib/core/core.svelte.js';
	import { addNotification } from '$lib/core/notifications.svelte.js';
	import { tooltip } from '$lib/utils/tooltip.js';
	import { tick } from 'svelte';

	// Icons known to exist on disk in src/lib/icons/. Used as the safety net
	// for the fallback chain so we never render a broken <svg> for a missing
	// SVG file.
	const KNOWN_ICONS = new Set([
		'add-file', 'add', 'align-bottom', 'align-centre', 'align-left', 'align-middle',
		'align-right', 'align-top', 'caret-down', 'caret-right', 'caret-up', 'center',
		'circle-chevron-left', 'clock', 'close', 'collect-columns', 'column-add',
		'column-avg', 'column-max', 'column-min', 'column-sd', 'dataview', 'deleteBox',
		'disk', 'distribute-horizontal', 'distribute-vertical', 'edit-value', 'edit',
		'eye-slash', 'eye', 'gear', 'layer', 'layerDown', 'layerUp', 'list', 'math',
		'maximise', 'menu-horizontal-dots', 'menu-vertical-dots', 'minimise', 'minus',
		'node-add', 'node-bin-data', 'node-cosinor', 'node-double-logistic',
		'node-filter', 'node-formula-column', 'node-long-to-wide', 'node-multiply',
		'node-normalize', 'node-periodogram', 'node-rectangular-wave',
		'node-remove-outliers', 'node-remove-trend', 'node-smooth-data',
		'node-substitute', 'pin', 'plus', 'process', 'query', 'redo',
		'remove-trend-exponential', 'remove-trend-linear', 'remove-trend-logarithmic',
		'remove-trend-polynomial', 'reset', 'resizeHandle', 'search', 'sessionload',
		'sessionsave', 'showallpaths', 'showconnectedpaths', 'smooth-loess',
		'smooth-movingavg', 'smooth-savitzkygolay', 'smooth-whittakereilers', 'spinner',
		'swap', 'table'
	]);

	function resolveIcon(name) {
		if (name && KNOWN_ICONS.has(name)) return name;
		if (KNOWN_ICONS.has('process')) return 'process';
		return 'gear';
	}

	// ---- Spawn-routing kinds --------------------------------------------
	// Source table processes get their own dedicated modal; everything else
	// goes through MakeNewColumn (table process) or the splice-on-drop hint
	// (column process).
	const SOURCE_MODAL_BY_TYPE = {
		SimulatedData: 'simulate',
		SequenceColumn: 'sequence',
		BlankColumn: 'blank'
	};

	let {
		// Called by NodePalette right before any user-initiated spawn so the
		// next-to-appear node lands at the centre of the current viewport.
		queueSpawnPosition = null,
		// Spawns a column process on the currently-focused data column (or the
		// first data column if none is focused). Returns
		// { ok: boolean, columnId?: number, reason?: string }.
		onSpawnColumnProcess = null
	} = $props();

	let showMenu = $state(false);
	let query = $state('');
	let showAddPlotModal = $state(false);
	let plotInitialType = $state('');
	let showSimulateModal = $state(false);
	let showBlankModal = $state(false);
	let showSequenceModal = $state(false);
	let showAddTPModal = $state(false);
	let addTPInitialType = $state('');

	// ---- Build the flat list of palette items ---------------------------
	const allItems = $derived.by(() => {
		const items = [];
		for (const [key, entry] of appConsts.processMap.entries()) {
			items.push({
				type: key,
				kind: 'process',
				displayName: entry.displayName || key,
				family: entry.family || 'Other',
				nodeIcon: resolveIcon(entry.nodeIcon),
				description: entry.description || ''
			});
		}
		for (const [key, entry] of appConsts.tableProcessMap.entries()) {
			items.push({
				type: key,
				kind: 'tableProcess',
				displayName: entry.displayName || key,
				family: entry.family || 'Other',
				nodeIcon: resolveIcon(entry.nodeIcon),
				description: entry.description || ''
			});
		}
		for (const [key, entry] of appConsts.plotMap.entries()) {
			items.push({
				type: key,
				kind: 'plot',
				displayName: entry.displayName || key,
				family: entry.family || 'Plots',
				nodeIcon: resolveIcon(entry.nodeIcon),
				description: entry.description || ''
			});
		}
		// Annotation node — pure-canvas Note, no data behaviour.
		items.push({
			type: 'note',
			kind: 'note',
			displayName: 'Note',
			family: 'Other',
			nodeIcon: resolveIcon('edit-value'),
			description: 'Standalone canvas note. Free-form text annotation.'
		});
		// Visual-container node — group/box that data nodes can be dragged into.
		items.push({
			type: 'group',
			kind: 'group',
			displayName: 'Group',
			family: 'Other',
			nodeIcon: resolveIcon('layer'),
			description:
				'A visual container. Drag data nodes into it to group them; drag out to release.'
		});
		return items.sort(
			(a, b) =>
				a.family.localeCompare(b.family) || a.displayName.localeCompare(b.displayName)
		);
	});

	const filteredItems = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return allItems;
		return allItems.filter((it) => {
			const h = `${it.family} ${it.displayName} ${it.type} ${it.description}`.toLowerCase();
			return h.includes(q);
		});
	});

	const FAMILY_ORDER = [
		'Sources',
		'Arithmetic',
		'Filtering',
		'Smoothing',
		'Binning',
		'Fitting',
		'Analysis',
		'Transform',
		'Plots',
		'Other'
	];
	function familyRank(name) {
		const idx = FAMILY_ORDER.indexOf(name);
		return idx === -1 ? FAMILY_ORDER.length : idx;
	}

	const families = $derived.by(() => {
		const groups = new Map();
		for (const it of filteredItems) {
			if (!groups.has(it.family)) groups.set(it.family, []);
			groups.get(it.family).push(it);
		}
		return Array.from(groups.entries())
			.map(([family, nodes]) => ({
				family,
				nodes: nodes.sort((a, b) => a.displayName.localeCompare(b.displayName))
			}))
			.sort((a, b) => familyRank(a.family) - familyRank(b.family) || a.family.localeCompare(b.family));
	});

	const hasNoResults = $derived(filteredItems.length === 0);

	// Focus the search input whenever the popover opens.
	$effect(() => {
		if (showMenu) {
			tick().then(() => {
				const el = document.querySelector('.np-anchor .palette-search');
				el?.focus?.();
				el?.select?.();
			});
		} else {
			query = '';
		}
	});

	function closeMenu() {
		showMenu = false;
	}

	// ---- Spawn handlers --------------------------------------------------
	function handlePick(item) {
		if (item.kind === 'note') {
			// Notes carry x/y on the entity itself; ask WorkflowEditor where the
			// viewport is and seed createNote with that point. The
			// stablePositions effect will still pick the same spot via the
			// spawn queue, so the node visually lands at the viewport centre.
			queueSpawnPosition?.();
			createNote();
			closeMenu();
			return;
		}

		if (item.kind === 'group') {
			queueSpawnPosition?.();
			createGroup();
			closeMenu();
			return;
		}

		if (item.kind === 'plot') {
			queueSpawnPosition?.();
			plotInitialType = item.type;
			showAddPlotModal = true;
			closeMenu();
			return;
		}

		if (item.kind === 'tableProcess') {
			const sourceModal = SOURCE_MODAL_BY_TYPE[item.type];
			if (sourceModal === 'simulate') {
				queueSpawnPosition?.();
				showSimulateModal = true;
				closeMenu();
				return;
			}
			if (sourceModal === 'sequence') {
				queueSpawnPosition?.();
				showSequenceModal = true;
				closeMenu();
				return;
			}
			if (sourceModal === 'blank') {
				queueSpawnPosition?.();
				showBlankModal = true;
				closeMenu();
				return;
			}
			// Non-source table process: free-spawn through MakeNewColumn. The
			// resulting TP lands in core.tableProcesses with no parent table;
			// the user wires its xIN/yIN inputs from any data node.
			queueSpawnPosition?.();
			addTPInitialType = item.type;
			showAddTPModal = true;
			closeMenu();
			return;
		}

		// item.kind === 'process' — column-level. WorkflowEditor handles the
		// "which column?" decision (currently: focused data node, else first
		// non-TP-output data column). Spawn at the viewport centre via the
		// queued position; the user can then drag-onto-edge to splice into a
		// different chain if they want.
		if (typeof onSpawnColumnProcess === 'function') {
			queueSpawnPosition?.();
			const result = onSpawnColumnProcess(item.type);
			if (!result?.ok) {
				if (result?.reason === 'no-columns') {
					addNotification(
						`No data columns yet — import or create one before adding "${item.displayName}".`,
						'info'
					);
				} else {
					addNotification(
						`Could not add "${item.displayName}".`,
						'info'
					);
				}
			}
		} else {
			addNotification(
				`"${item.displayName}" needs a target column. (Spawn handler not wired.)`,
				'info'
			);
		}
		closeMenu();
	}

	function closeOnClickAway(node) {
		function handler(e) {
			if (!node.contains(e.target)) showMenu = false;
		}
		document.addEventListener('pointerdown', handler, true);
		return {
			destroy() {
				document.removeEventListener('pointerdown', handler, true);
			}
		};
	}
</script>

<div class="np-anchor" use:closeOnClickAway>
	<button
		type="button"
		class="np-btn np-trigger"
		class:open={showMenu}
		onclick={() => (showMenu = !showMenu)}
		aria-label="Add node"
		{@attach tooltip('Add to canvas')}
	>
		<Icon name="plus" width={22} height={22} />
	</button>

	{#if showMenu}
		<div class="np-menu palette-menu" role="menu">
			<div class="palette-search-wrap">
				<input
					class="palette-search"
					type="search"
					bind:value={query}
					placeholder="Search nodes, families, descriptions…"
					aria-label="Search nodes"
				/>
			</div>

			{#if hasNoResults}
				<div class="palette-empty">No nodes match "{query}".</div>
			{:else}
				{#each families as fam (fam.family)}
					<section class="palette-family-block">
						<div class="palette-family-header">{fam.family}</div>
						<div class="palette-grid">
							{#each fam.nodes as node (`${node.kind}:${node.type}`)}
								<button
									type="button"
									class="palette-tile np-item"
									aria-label={node.description || node.displayName}
									onclick={() => handlePick(node)}
									{@attach tooltip(node.description || node.displayName)}
								>
									<span class="palette-tile-icon">
										<Icon name={node.nodeIcon} width={24} height={24} />
									</span>
									<span class="palette-tile-name">{node.displayName}</span>
								</button>
							{/each}
						</div>
					</section>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<MakeNewPlot bind:showModal={showAddPlotModal} bind:initialType={plotInitialType} />
<SimulateData bind:showModal={showSimulateModal} />
<BlankColumnModal bind:showModal={showBlankModal} />
<SequenceColumnModal bind:showModal={showSequenceModal} />
{#if showAddTPModal}
	<MakeNewColumn bind:show={showAddTPModal} bind:initialType={addTPInitialType} />
{/if}

<style>
	.np-anchor {
		position: absolute;
		top: 12px;
		right: 12px;
		z-index: 30;
		pointer-events: auto;
	}

	.np-btn {
		pointer-events: auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 26px;
		padding: 0;
		color: var(--color-lightness-45, #6b7280);
		background: transparent;
		border: 0;
		cursor: pointer;
		transition:
			color 0.18s ease,
			transform 0.32s ease;
	}

	.np-btn:hover {
		color: var(--color-accent, #4d9fe3);
	}

	.np-btn:active {
		transform: scale(0.95);
	}

	.np-trigger.open {
		transform: rotate(45deg);
		color: var(--color-accent, #4d9fe3);
	}

	.np-menu {
		position: absolute;
		top: 46px;
		right: 0;
		min-width: 340px;
		max-width: 420px;
		max-height: min(70vh, 36rem);
		overflow-y: auto;
		background: #fff;
		border: 1px solid var(--color-lightness-80, #ccc);
		border-radius: 8px;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.palette-search-wrap {
		position: sticky;
		top: 0;
		z-index: 1;
		padding-bottom: 0.6rem;
		background: #fff;
		border-bottom: 1px solid var(--color-lightness-90, #eee);
		margin-bottom: 0.5rem;
	}

	.palette-search {
		width: 100%;
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--color-lightness-80, #ccc);
		border-radius: 5px;
		font-size: 0.85rem;
		color: var(--color-lightness-25, #333);
		background: #fff;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}

	.palette-search:focus {
		outline: none;
		border-color: var(--color-accent, #4d9fe3);
		box-shadow: 0 0 0 2px rgba(77, 159, 227, 0.18);
	}

	.palette-empty {
		padding: 0.8rem 0.3rem;
		font-size: 0.82rem;
		color: var(--color-lightness-50, #888);
	}

	.palette-family-block {
		padding-top: 0.1rem;
	}

	.palette-family-header {
		padding: 0.3rem 0.2rem;
		margin-bottom: 0.35rem;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-weight: 700;
		color: var(--color-lightness-50, #888);
		border-top: 1px solid var(--color-lightness-90, #eee);
	}

	.palette-family-block:first-of-type .palette-family-header {
		border-top: none;
	}

	.palette-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.4rem;
		padding-bottom: 0.5rem;
	}

	.palette-tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		gap: 0.3rem;
		padding: 0.5rem 0.35rem;
		min-height: 64px;
		border: 1px solid transparent;
		border-radius: 6px;
		background: #fff;
		color: var(--color-lightness-25, #333);
		text-align: center;
		cursor: pointer;
		transition:
			background 0.15s ease,
			border-color 0.15s ease,
			transform 0.15s ease;
	}

	.palette-tile:hover {
		background: var(--color-lightness-95, #f4f4f4);
		border-color: var(--color-lightness-85, #ddd);
		transform: translateY(-1px);
	}

	.palette-tile:focus-visible {
		outline: 2px solid var(--color-accent, #4d9fe3);
		outline-offset: 1px;
	}

	.palette-tile-icon {
		width: 32px;
		height: 32px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-lightness-35, #555);
	}

	.palette-tile:hover .palette-tile-icon {
		color: var(--color-accent, #4d9fe3);
	}

	.palette-tile-name {
		font-size: 0.7rem;
		line-height: 1.2;
		font-weight: 500;
		max-height: 2.4em;
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
	}

</style>
