<script>
	import { SvelteSet } from 'svelte/reactivity';
	import { core } from '$lib/core/core.svelte.js';
	import { Column, getColumnById } from '$lib/core/Column.svelte';

	let {
		onChange = () => {},
		getPlotSiblings = -1,
		excludeColIds = [],
		value = $bindable(),
		multiple = false,
		placeholder = 'Select a column...'
	} = $props();

	// Build a tree of nodes from core state. Each node carries a stable `key`
	// (used for expansion tracking and {#each}) so renames don't reset state.
	//   leaf:  { key, label, value }
	//   group: { key, label, options[], proc? }   // proc set when group is a renameable TableProcess
	let options = $derived.by(() => {
		const tree = [];
		const seenIds = new Set();

		if (getPlotSiblings !== -1) {
			const plotGroups = [];
			for (let p = 0; p < core.plots.length; p++) {
				const plot = core.plots[p];
				const plotChildren = [];
				const plotData = plot.plot.data ?? [];
				for (let d = 0; d < plotData.length; d++) {
					Object.keys(plotData[d].toJSON()).forEach((key) => {
						const cell = plotData[d][key];
						if (cell instanceof Column) {
							const colId = cell.id;
							if (!seenIds.has(colId) && !excludeColIds.includes(colId)) {
								seenIds.add(colId);
								plotChildren.push({ key: `c:${colId}`, label: cell.name, value: colId });
							}
						}
					});
				}
				if (plotChildren.length > 0) {
					plotGroups.push({ key: `plot:${p}`, label: plot.name, options: plotChildren });
				}
			}
			if (plotGroups.length > 0) {
				tree.push({ key: 'plotsiblings', label: 'Plot siblings', options: plotGroups });
			}
		}

		for (const table of core.tables) {
			const groupChildren = [];
			const processOutputIds = new Set();

			for (const proc of table.processes) {
				const outEntries = Object.entries(proc.args.out ?? {})
					.filter(([, colId]) => colId !== -1 && !excludeColIds.includes(colId))
					.filter(([, colId]) => !seenIds.has(colId));

				if (outEntries.length > 1) {
					const procChildren = [];
					for (const [, colId] of outEntries) {
						const col = getColumnById(colId);
						if (!col) continue;
						seenIds.add(colId);
						processOutputIds.add(colId);
						procChildren.push({ key: `c:${colId}`, label: col.name, value: colId });
					}
					if (procChildren.length > 0) {
						groupChildren.push({
							key: `tp:${proc.id}`,
							label: proc.displayName || proc.name,
							options: procChildren,
							proc
						});
					}
				}
			}

			for (const col of table.columns) {
				if (!col) continue;
				if (excludeColIds.includes(col.id)) continue;
				if (processOutputIds.has(col.id)) continue;
				if (seenIds.has(col.id)) continue;
				seenIds.add(col.id);
				groupChildren.push({ key: `c:${col.id}`, label: col.name, value: col.id });
			}

			if (groupChildren.length > 0) {
				tree.push({ key: `t:${table.id}`, label: table.name, options: groupChildren });
			}
		}

		return tree;
	});

	function flattenLeaves(nodes) {
		return nodes.flatMap((node) => (node.options ? flattenLeaves(node.options) : [node]));
	}

	function filterNode(node, term) {
		if (!node.options) {
			return node.label.toLowerCase().includes(term) ? node : null;
		}
		const groupMatches = node.label.toLowerCase().includes(term);
		const filteredChildren = node.options.map((c) => filterNode(c, term)).filter(Boolean);
		if (groupMatches || filteredChildren.length > 0) {
			return { ...node, options: groupMatches ? node.options : filteredChildren };
		}
		return null;
	}

	function collectGroupKeys(nodes) {
		const acc = new SvelteSet();
		(function walk(ns) {
			for (const node of ns) {
				if (node.options) {
					acc.add(node.key);
					walk(node.options);
				}
			}
		})(nodes);
		return acc;
	}

	let isOpen = $state(false);
	let searchTerm = $state('');
	let editingKey = $state(null);
	let containerEl;
	let triggerEl;
	// Position the dropdown with fixed coordinates so it can escape any
	// ancestor that clips with overflow.
	let dropdownPos = $state({ top: 0, left: 0, width: 0, openUp: false });

	function updateDropdownPos() {
		if (!triggerEl) return;
		const r = triggerEl.getBoundingClientRect();
		const dropdownMaxH = 360;
		const spaceBelow = window.innerHeight - r.bottom;
		const openUp = spaceBelow < Math.min(dropdownMaxH, 200) && r.top > spaceBelow;
		dropdownPos = {
			top: openUp ? r.top : r.bottom,
			left: r.left,
			width: r.width,
			openUp
		};
	}

	$effect(() => {
		if (!isOpen) return;
		updateDropdownPos();
		const onScrollOrResize = () => updateDropdownPos();
		window.addEventListener('scroll', onScrollOrResize, true);
		window.addEventListener('resize', onScrollOrResize);
		return () => {
			window.removeEventListener('scroll', onScrollOrResize, true);
			window.removeEventListener('resize', onScrollOrResize);
		};
	});

	// Expansion is a plain $state Set rather than a $derived, so user toggles
	// survive when `options` recomputes (e.g. after a process creates new
	// columns). New groups appear pre-expanded; user collapses persist.
	const expandedGroups = new SvelteSet();
	const _seenGroupKeys = new SvelteSet();
	$effect(() => {
		for (const key of collectGroupKeys(options)) {
			if (!_seenGroupKeys.has(key)) {
				_seenGroupKeys.add(key);
				expandedGroups.add(key);
			}
		}
	});

	const filteredGroups = $derived.by(() => {
		const term = searchTerm.trim().toLowerCase();
		if (!term) return options;
		return options.map((n) => filterNode(n, term)).filter(Boolean);
	});

	const allLeaves = $derived(flattenLeaves(options));

	const selectedLabel = $derived.by(() => {
		const empty = value === undefined || value === null || value === -1;
		const arr = Array.isArray(value) ? value : empty ? [] : [value];
		if (arr.length === 0) return placeholder;
		if (arr.length === 1) {
			return allLeaves.find((o) => o.value === arr[0])?.label ?? placeholder;
		}
		return `${arr.length} selected`;
	});

	function toggleDropdown(e) {
		// Prevent the click from reaching a wrapping <summary> (which toggles
		// its <details> on click) or other ancestor handlers.
		e?.stopPropagation();
		e?.preventDefault();
		isOpen = !isOpen;
		if (isOpen) searchTerm = '';
	}

	function toggleGroup(key) {
		if (expandedGroups.has(key)) expandedGroups.delete(key);
		else expandedGroups.add(key);
	}

	function handleGroupKeydown(e, key) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			toggleGroup(key);
		}
	}

	function asArray(v) {
		if (Array.isArray(v)) return v;
		if (v === undefined || v === null || v === -1) return [];
		return [v];
	}

	function selectLeaf(optValue, e) {
		e.stopPropagation();
		if (e.altKey) {
			// Alt+click toggles in/out of the selection (multi-select).
			const current = asArray(value);
			const next = current.includes(optValue)
				? current.filter((v) => v !== optValue)
				: [...current, optValue];
			value = multiple ? next : next.length === 1 ? next[0] : next;
			onChange(value);
		} else {
			// Regular click: replace selection. Shape matches the consumer's
			// expectation (array when multiple, scalar otherwise).
			value = multiple ? [optValue] : optValue;
			onChange(value);
			isOpen = false;
		}
	}

	function selectAllInGroup(node, e) {
		e.stopPropagation();
		const leafIds = flattenLeaves(node.options ?? []).map((o) => o.value);
		if (!leafIds.length) return;

		if (e.altKey) {
			const current = asArray(value);
			const allSelected = leafIds.every((v) => current.includes(v));
			const next = allSelected
				? current.filter((v) => !leafIds.includes(v))
				: [...new Set([...current, ...leafIds])];
			value = multiple ? next : next.length === 1 ? next[0] : next;
			onChange(value);
		} else {
			value = multiple ? leafIds : leafIds[0];
			onChange(value);
			isOpen = false;
		}
	}

	function isSelected(optValue) {
		return Array.isArray(value) ? value.includes(optValue) : value === optValue;
	}

	function startRename(e, node) {
		e.stopPropagation();
		editingKey = node.key;
	}

	function commitRename(e, node) {
		const next = e.currentTarget.value.trim();
		if (next && node.proc) node.proc.displayName = next;
		editingKey = null;
	}

	function cancelRename() {
		editingKey = null;
	}

	function handleRenameKeydown(e, node) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitRename(e, node);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelRename();
		}
	}

	function focusOnMount(el) {
		el.focus();
		el.select();
	}

	/** @type {HTMLDivElement | null} */
	let dropdownEl = $state(null);
	function handleDocClick(e) {
		if (!isOpen) return;
		const inTrigger = containerEl && containerEl.contains(e.target);
		const inDropdown = dropdownEl && dropdownEl.contains(e.target);
		if (!inTrigger && !inDropdown) isOpen = false;
	}
</script>

<svelte:window onclick={handleDocClick} />

{#snippet renderNode(node, depth)}
	{#if node.options}
		<div class="group">
			<div
				class="group-header"
				role="button"
				tabindex="0"
				onclick={() => toggleGroup(node.key)}
				onkeydown={(e) => handleGroupKeydown(e, node.key)}
				style="padding-left: {6 + depth * 14}px"
			>
				<span class="chevron">{expandedGroups.has(node.key) ? '−' : '+'}</span>

				{#if node.proc && editingKey === node.key}
					<input
						class="rename-input"
						type="text"
						value={node.label}
						{@attach focusOnMount}
						onclick={(e) => e.stopPropagation()}
						onblur={(e) => commitRename(e, node)}
						onkeydown={(e) => handleRenameKeydown(e, node)}
					/>
				{:else if node.proc}
					<span
						class="group-label renameable"
						role="button"
						tabindex="-1"
						title="Double-click to rename"
						ondblclick={(e) => startRename(e, node)}
					>
						{node.label}
					</span>
				{:else}
					<span class="group-label">{node.label}</span>
				{/if}

				{#if multiple}
					<span
						class="all-button"
						role="button"
						tabindex="0"
						onclick={(e) => selectAllInGroup(node, e)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') selectAllInGroup(node, e);
						}}
					>
						All
					</span>
				{/if}
			</div>

			{#if expandedGroups.has(node.key)}
				<div class="group-options">
					{#each node.options as child (child.key)}
						{@render renderNode(child, depth + 1)}
					{/each}
				</div>
			{/if}
		</div>
	{:else}
		<button
			class="option"
			class:selected={isSelected(node.value)}
			onclick={(e) => selectLeaf(node.value, e)}
			type="button"
			style="padding-left: {20 + depth * 14}px"
		>
			{node.label}
		</button>
	{/if}
{/snippet}

<div class="select-container" bind:this={containerEl}>
	<button bind:this={triggerEl} class="trigger" onclick={toggleDropdown} type="button">
		<span class="trigger-label">{selectedLabel}</span>
		<span class="arrow">{isOpen ? '▲' : '▼'}</span>
	</button>
</div>

{#if isOpen}
	<div
		bind:this={dropdownEl}
		class="dropdown"
		class:open-up={dropdownPos.openUp}
		style="top: {dropdownPos.top}px; left: {dropdownPos.left}px; width: {dropdownPos.width}px;{dropdownPos.openUp
			? ' transform: translateY(-100%);'
			: ''}"
	>
		<div class="search-wrapper">
			<input
				type="text"
				bind:value={searchTerm}
				placeholder="Search... (Alt+click to multi-select)"
			/>
		</div>
		<div class="listbox">
			{#each filteredGroups as node (node.key)}
				{@render renderNode(node, 0)}
			{:else}
				<div class="no-results">No matches found</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.select-container {
		position: relative;
		width: 100%;
		min-width: 0;
		flex: 1 1 auto;
		box-sizing: border-box;
	}

	.trigger {
		width: 100%;
		padding: 0.2rem 0.4rem;
		text-align: left;
		background-color: var(--color-lightness-97);
		border: 1px solid var(--color-lightness-85);
		border-radius: 2px;
		cursor: pointer;
		display: flex;
		justify-content: space-between;
		align-items: center;
		min-height: var(--control-input-height);
		box-sizing: border-box;
		font-size: 14px;
		font-weight: lighter;
		color: inherit;
		transition: border-color 0.2s;
	}

	.trigger:hover {
		border-color: var(--color-lightness-35);
	}

	.trigger-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.arrow {
		margin-left: 0.4rem;
		color: var(--color-lightness-50);
		font-size: 0.75em;
		flex-shrink: 0;
	}

	.dropdown {
		position: fixed;
		background: white;
		border: 1px solid var(--color-lightness-85);
		border-top: none;
		z-index: 1000;
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.12);
		max-height: 360px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		min-width: 20ch;
	}

	.dropdown.open-up {
		border-top: 1px solid var(--color-lightness-85);
		border-bottom: none;
		box-shadow: 0 -4px 8px rgba(0, 0, 0, 0.12);
	}

	.search-wrapper {
		padding: 6px;
		border-bottom: 1px solid var(--color-lightness-90);
		flex-shrink: 0;
	}

	.search-wrapper input {
		width: 100%;
		padding: 4px 6px;
		font-size: 13px;
		box-sizing: border-box;
		border: 1px solid var(--color-lightness-85);
		border-radius: 2px;
	}

	.listbox {
		overflow-y: auto;
		flex: 1 1 auto;
		min-height: 0;
	}

	.group {
		border-bottom: 1px solid var(--color-lightness-95);
	}

	.group-header {
		width: 100%;
		box-sizing: border-box;
		overflow: hidden;
		padding: 6px 8px;
		background: var(--color-lightness-97);
		border: none;
		text-align: left;
		font-weight: 600;
		font-size: 13px;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--color-lightness-35);
	}

	.group-header:hover {
		background: var(--color-lightness-95);
	}

	.group-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.group-label.renameable {
		text-decoration: underline;
		text-decoration-color: var(--color-lightness-75);
		text-decoration-style: dotted;
		text-underline-offset: 2px;
	}

	.rename-input {
		flex: 1 1 auto;
		min-width: 4ch;
		padding: 2px 4px;
		font: inherit;
		color: inherit;
		border: 1px solid var(--color-lightness-50);
		border-radius: 2px;
		background: white;
		outline: none;
	}

	.chevron {
		width: 14px;
		display: inline-block;
		text-align: center;
		color: var(--color-lightness-50);
		flex-shrink: 0;
	}

	.all-button {
		margin-left: auto;
		color: var(--color-info-text, #1a73e8);
		font-size: 0.85em;
		padding: 1px 6px;
		border-radius: 3px;
		cursor: pointer;
		flex-shrink: 0;
	}

	.all-button:hover {
		background: var(--color-info-bg);
	}

	.group-options {
		display: flex;
		flex-direction: column;
	}

	.option {
		padding: 6px 8px;
		text-align: left;
		background: white;
		border: none;
		cursor: pointer;
		color: inherit;
		font-size: 13px;
	}

	.option:hover {
		background: var(--color-lightness-95);
	}

	.option.selected {
		background: var(--color-info-bg);
		color: var(--color-info-text);
	}

	.no-results {
		padding: 24px 16px;
		text-align: center;
		color: var(--color-lightness-60);
		font-size: 13px;
	}
</style>
