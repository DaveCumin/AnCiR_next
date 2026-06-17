<script>
	// @ts-nocheck
	// Floating palette anchored to the Worksheet "+" button. Lists every plot
	// type from appConsts.plotMap plus a Note tile. Picking a plot opens
	// MakeNewPlot pre-seeded with that type; picking Note spawns a standalone
	// note into core.notes (visible in both the worksheet and the workflow
	// canvas).
	import Icon from '$lib/icons/Icon.svelte';
	import MakeNewPlot from '$lib/components/views/modals/MakeNewPlot.svelte';
	import { appConsts, appState, createNote } from '$lib/core/core.svelte.js';
	import { tooltip } from '$lib/utils/tooltip.js';
	import { tick } from 'svelte';

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
		return 'gear';
	}

	let { open = $bindable(false), top = 0, left = 0 } = $props();

	let query = $state('');
	let showPlotModal = $state(false);
	let plotInitialType = $state('');

	const allItems = $derived.by(() => {
		const items = [];
		for (const [key, entry] of appConsts.plotMap?.entries() ?? []) {
			items.push({
				type: key,
				kind: 'plot',
				displayName: entry.displayName || key,
				nodeIcon: resolveIcon(entry.nodeIcon),
				description: entry.description || ''
			});
		}
		items.sort((a, b) => a.displayName.localeCompare(b.displayName));
		items.push({
			type: 'note',
			kind: 'note',
			displayName: 'Note',
			nodeIcon: resolveIcon('edit-value'),
			description: 'Free-form text annotation on the worksheet.'
		});
		return items;
	});

	const filteredItems = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return allItems;
		return allItems.filter((it) => {
			const h = `${it.displayName} ${it.type} ${it.description}`.toLowerCase();
			return h.includes(q);
		});
	});

	$effect(() => {
		if (open) {
			tick().then(() => {
				const el = document.querySelector('.ws-palette .palette-search');
				el?.focus?.();
				el?.select?.();
			});
		} else {
			query = '';
		}
	});

	function closeMenu() {
		open = false;
	}

	function handlePick(item) {
		if (item.kind === 'note') {
			const canvasEl = document.getElementsByClassName('canvas')[0];
			const scale = appState.canvasScale || 1;
			const x = canvasEl ? Math.round(canvasEl.scrollLeft / scale) + 60 : 120;
			const y = canvasEl ? Math.round(canvasEl.scrollTop / scale) + 60 : 120;
			createNote({ x, y });
			closeMenu();
			return;
		}
		plotInitialType = item.type;
		showPlotModal = true;
		closeMenu();
	}

	function closeOnClickAway(node) {
		function handler(e) {
			if (!node.contains(e.target)) open = false;
		}
		document.addEventListener('pointerdown', handler, true);
		return {
			destroy() {
				document.removeEventListener('pointerdown', handler, true);
			}
		};
	}
</script>

{#if open}
	<div class="ws-palette" style="top: {top}px; left: {left}px;" role="menu" use:closeOnClickAway>
		<div class="palette-search-wrap">
			<input
				class="palette-search"
				type="search"
				bind:value={query}
				placeholder="Search plots…"
				aria-label="Search plots"
			/>
		</div>

		{#if filteredItems.length === 0}
			<div class="palette-empty">No matches for "{query}".</div>
		{:else}
			<div class="palette-grid">
				{#each filteredItems as node (`${node.kind}:${node.type}`)}
					<button
						type="button"
						class="palette-tile"
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
		{/if}
	</div>
{/if}

<MakeNewPlot bind:showModal={showPlotModal} bind:initialType={plotInitialType} />

<style>
	.ws-palette {
		position: fixed;
		z-index: 1000;
		min-width: 320px;
		max-width: 400px;
		max-height: min(70vh, 32rem);
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

	.palette-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.4rem;
		padding-bottom: 0.25rem;
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
