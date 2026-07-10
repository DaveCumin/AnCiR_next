<script>
	// @ts-nocheck
	// Flowtest-style floating add-node palette in the top-right of the canvas.
	// Renders a search box + family-grouped icon tiles. Picking a tile spawns the
	// node directly on the canvas (table processes land default-expanded) — no
	// modal; the user configures it inline. Notes/groups spawn directly too, and
	// "Import file" opens the file picker.
	import Icon from '$lib/icons/Icon.svelte';
	import { core, appConsts, createNote, createGroup } from '$lib/core/core.svelte.js';
	import { addNotification } from '$lib/core/notifications.svelte.js';
	import { openImportData } from '$lib/core/dataSourceActions.js';
	import { tooltip } from '$lib/utils/tooltip.js';
	import { tick } from 'svelte';

	// Icons known to exist on disk in src/lib/icons/. Used as the safety net
	// for the fallback chain so we never render a broken <svg> for a missing
	// SVG file.
	const KNOWN_ICONS = new Set([
		'add-file',
		'add',
		'align-bottom',
		'align-centre',
		'align-left',
		'align-middle',
		'align-right',
		'align-top',
		'caret-down',
		'caret-right',
		'caret-up',
		'center',
		'circle-chevron-left',
		'clock',
		'close',
		'collect-columns',
		'column-set',
		'average-profile',
		'circular-stats',
		'free-running-period',
		'cfi',
		'node-frequency-filter',
		'column-add',
		'column-avg',
		'column-max',
		'column-min',
		'column-sd',
		'dataview',
		'deleteBox',
		'disk',
		'distribute-horizontal',
		'distribute-vertical',
		'edit-value',
		'edit',
		'eye-slash',
		'eye',
		'gear',
		'layer',
		'layerDown',
		'layerUp',
		'list',
		'math',
		'maximise',
		'menu-horizontal-dots',
		'menu-vertical-dots',
		'minimise',
		'minus',
		'node-add',
		'node-bin-data',
		'node-interpolate',
		'node-cosinor',
		'node-double-logistic',
		'node-filter',
		'node-formula-column',
		'node-long-to-wide',
		'node-multiply',
		'node-normalize',
		'node-periodogram',
		'node-rectangular-wave',
		'node-remove-outliers',
		'node-remove-trend',
		'node-smooth-data',
		'node-substitute',
		'pin',
		'plus',
		'process',
		'query',
		'redo',
		'remove-trend-exponential',
		'remove-trend-linear',
		'remove-trend-logarithmic',
		'remove-trend-polynomial',
		'reset',
		'resizeHandle',
		'search',
		'sessionload',
		'sessionsave',
		'showallpaths',
		'showconnectedpaths',
		'smooth-loess',
		'smooth-movingavg',
		'smooth-savitzkygolay',
		'smooth-whittakereilers',
		'spinner',
		'swap',
		'table',
		// flowtest node/plot glyphs (stroke + currentColor, recolour-ready)
		'blank-column',
		'correlogram',
		'fft',
		'fit-function',
		'group-comp',
		'linear-fit',
		'moving-analysis',
		'random',
		'scatterplot',
		'sequence-col',
		'simulated-data',
		'split',
		'wide-to-long',
		'actogram',
		'boxplot',
		'histogram'
	]);

	function resolveIcon(name) {
		if (name && KNOWN_ICONS.has(name)) return name;
		if (KNOWN_ICONS.has('process')) return 'process';
		return 'gear';
	}

	let {
		// Called by NodePalette right before any user-initiated spawn so the
		// next-to-appear node lands at the centre of the current viewport.
		queueSpawnPosition = null,
		// Spawns a column process on the currently-focused data column (or the
		// first data column if none is focused). Returns
		// { ok: boolean, columnId?: number, reason?: string }.
		onSpawnColumnProcess = null,
		// Spawns a (free) table process directly on the canvas, default-expanded —
		// no modal. Returns { ok }.
		onSpawnTableProcess = null,
		// Spawns a plot directly on the canvas — no modal. Returns { ok }.
		onSpawnPlot = null
	} = $props();

	let showMenu = $state(false);
	let query = $state('');

	// ---- Build the flat list of palette items ---------------------------
	const allItems = $derived.by(() => {
		const items = [];
		// Import-from-file source. Not a registered table process (the import flow
		// is a modal), so it's injected here so users can always reach it from the
		// Sources family alongside Simulate / Sequence / Blank.
		items.push({
			type: 'import-file',
			kind: 'import',
			displayName: 'Import file',
			family: 'Sources',
			nodeIcon: resolveIcon('add-file'),
			description: 'Import data from a CSV, Excel or AWD file on your computer.'
		});
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
			if (entry.hideFromPalette) continue;
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
			description: 'A visual container. Drag data nodes into it to group them; drag out to release.'
		});
		return items.sort(
			(a, b) => a.family.localeCompare(b.family) || a.displayName.localeCompare(b.displayName)
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
			.sort(
				(a, b) => familyRank(a.family) - familyRank(b.family) || a.family.localeCompare(b.family)
			);
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
		if (item.kind === 'import') {
			openImportData();
			closeMenu();
			return;
		}

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
			// Workflow add: spawn the plot directly (no modal); the user wires its
			// x/y inputs on the canvas.
			onSpawnPlot?.(item.type);
			closeMenu();
			return;
		}

		if (item.kind === 'tableProcess') {
			// Workflow add: spawn the table process directly with defaults,
			// default-expanded, so the user configures it inline (no modal).
			onSpawnTableProcess?.(item.type);
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
					addNotification(`Could not add "${item.displayName}".`, 'info');
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
		data-testid="palette-trigger"
		onclick={() => (showMenu = !showMenu)}
		aria-label="Add node"
		{@attach tooltip('Add to canvas')}
	>
		<Icon name="add" width={24} height={24} />
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
									data-testid={`palette-item-${node.type}`}
									aria-label={node.description || node.displayName}
									onclick={() => handlePick(node)}
									{@attach tooltip(node.description || node.displayName, { anchor: 'element' })}
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

<style>
	/* Anchored top-right, 5px inside the canvas-viewport's right edge (which the
	   editor already insets by the control-panel width). This mirrors the bottom
	   zoom-controls' `right: calc(controlPanel + 5px)` so the add button sits in
	   the exact same screen spot as the worksheet's add button. */
	.np-anchor {
		position: absolute;
		top: 10px;
		right: 5px;
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
		color: var(--color-text-muted);
		background: transparent;
		border: 0;
		cursor: pointer;
		transition:
			color 0.18s ease,
			transform 0.32s ease;
	}

	.np-btn:hover {
		color: var(--color-accent);
	}

	.np-btn:active {
		transform: scale(0.95);
	}

	.np-trigger.open {
		color: var(--color-accent);
	}

	.np-menu {
		position: absolute;
		top: 46px;
		right: 0;
		min-width: 340px;
		max-width: 420px;
		max-height: min(70vh, 36rem);
		overflow-y: auto;
		background: var(--surface-card);
		border: 1px solid var(--color-lightness-80);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-3);
		padding: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.palette-search-wrap {
		position: sticky;
		top: 0;
		z-index: 1;
		padding-bottom: var(--space-4);
		background: var(--surface-card);
		border-bottom: 1px solid var(--color-lightness-90);
		margin-bottom: var(--space-4);
	}

	.palette-search {
		width: 100%;
		padding: var(--space-4) var(--space-4);
		border: 1px solid var(--color-lightness-80);
		border-radius: 5px;
		font-size: 0.85rem;
		color: var(--color-lightness-25);
		background: var(--surface-card);
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}

	.palette-search:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 2px rgba(77, 159, 227, 0.18);
	}

	.palette-empty {
		padding: var(--space-5) var(--space-2);
		font-size: 0.82rem;
		color: var(--color-text-muted);
	}

	.palette-family-block {
		padding-top: var(--space-1);
	}

	.palette-family-header {
		padding: var(--space-2) var(--space-2);
		margin-bottom: var(--space-3);
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-weight: 700;
		color: var(--color-text-muted);
		border-top: 1px solid var(--color-lightness-90);
	}

	.palette-family-block:first-of-type .palette-family-header {
		border-top: none;
	}

	.palette-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-3);
		padding-bottom: var(--space-4);
	}

	.palette-tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-3);
		min-height: 64px;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: var(--surface-card);
		color: var(--color-lightness-25);
		text-align: center;
		cursor: pointer;
		transition:
			background 0.15s ease,
			border-color 0.15s ease,
			transform 0.15s ease;
	}

	.palette-tile:hover {
		background: var(--color-lightness-95);
		border-color: var(--color-lightness-85);
		transform: translateY(-1px);
	}

	.palette-tile:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 1px;
	}

	.palette-tile-icon {
		width: 32px;
		height: 32px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-lightness-35);
	}

	/* Line icons colour via stroke=currentColor (the `color` above). Solid
	   (Font Awesome) icons colour via `fill`, which the Icon component sets to a
	   lighter var — so they looked washed-out next to the line icons. Pin their
	   fill to the same grey so every tile matches. Line icons keep their own
	   fill="none", so this only affects the solid glyphs. */
	.palette-tile-icon :global(.icon) {
		fill: var(--color-lightness-35);
	}
	.palette-tile:hover .palette-tile-icon,
	.palette-tile:hover .palette-tile-icon :global(.icon) {
		color: var(--color-accent);
		fill: var(--color-accent);
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
