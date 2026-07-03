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
		placeholder = 'Select a column...',
		// Controlled, trigger-less popover mode (used by the canvas port picker):
		// `hideTrigger` drops the trigger button, `open` is externally bindable, and
		// `anchor` ({ x, y } in viewport coords) positions the dropdown.
		open = $bindable(false),
		hideTrigger = false,
		anchor = null
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

		// Helper: build a sub-group for a TP's outputs (when there are >=2 outputs).
		function tpToGroup(proc) {
			const outEntries = Object.entries(proc.args?.out ?? {})
				.filter(([, colId]) => colId !== -1 && !excludeColIds.includes(colId))
				.filter(([, colId]) => !seenIds.has(colId));
			if (outEntries.length <= 1) return null;
			const procChildren = [];
			for (const [, colId] of outEntries) {
				const col = getColumnById(colId);
				if (!col) continue;
				seenIds.add(colId);
				procChildren.push({ key: `c:${colId}`, label: col.name, value: colId });
			}
			if (procChildren.length === 0) return null;
			return {
				key: `tp:${proc.id}`,
				label: proc.displayName || proc.name,
				options: procChildren,
				proc
			};
		}

		// Canvas Groups (the replacement for tables).
		for (const group of core.groups) {
			const children = [];
			for (const colId of group.sourceColumnIds ?? []) {
				if (excludeColIds.includes(colId)) continue;
				if (seenIds.has(colId)) continue;
				const col = getColumnById(colId);
				if (!col) continue;
				seenIds.add(colId);
				children.push({ key: `c:${colId}`, label: col.name, value: colId });
			}
			if (children.length > 0) {
				tree.push({ key: `g:${group.id}`, label: group.name, options: children });
			}
		}

		// Free TPs (each becomes its own group if it has >=2 outputs; single-output
		// TPs contribute their lone output column directly to the orphan section below).
		const freeTPOutputColIds = new Set();
		for (const proc of core.tableProcesses) {
			const g = tpToGroup(proc);
			if (g) {
				tree.push(g);
				for (const child of g.options) freeTPOutputColIds.add(child.value);
			} else {
				for (const colId of Object.values(proc.args?.out ?? {})) {
					if (typeof colId === 'number' && colId >= 0) freeTPOutputColIds.add(colId);
				}
			}
		}

		// Orphan columns: in core.data, not absorbed by any group, not already seen.
		const orphanCols = [];
		for (const col of core.data ?? []) {
			if (excludeColIds.includes(col.id)) continue;
			if (seenIds.has(col.id)) continue;
			seenIds.add(col.id);
			orphanCols.push({ key: `c:${col.id}`, label: col.name, value: col.id });
		}
		if (orphanCols.length > 0) {
			tree.push({ key: 'orphan', label: 'Columns', options: orphanCols });
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

	let searchTerm = $state('');
	let editingKey = $state(null);
	let lastSelectedLeafValue = $state(null);
	let containerEl;
	let triggerEl;
	// Position the dropdown with fixed coordinates so it can escape any
	// ancestor that clips with overflow.
	let dropdownPos = $state({ top: 0, left: 0, width: 0, openUp: false });

	function updateDropdownPos() {
		// Anchor mode (port picker): position at the given viewport point with a
		// default width; clamp so the menu stays on-screen. Otherwise measure the
		// trigger button.
		let r;
		if (hideTrigger && anchor) {
			const w = 240;
			const left = Math.max(4, Math.min(anchor.x, window.innerWidth - w - 8));
			r = { top: anchor.y, bottom: anchor.y, left, width: w };
		} else if (triggerEl) {
			r = triggerEl.getBoundingClientRect();
		} else {
			return;
		}
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

	// Move the dropdown to <body> so its position:fixed coordinates aren't broken
	// by an ancestor CSS transform. The workflow canvas applies a translate/scale
	// transform for pan/zoom; a fixed element inside a transformed ancestor is
	// positioned relative to that ancestor, which mislocated the menu when a node
	// was edited inline on the canvas.
	function portalToBody(node) {
		document.body.appendChild(node);
		return {
			destroy() {
				if (node.parentNode) node.remove();
			}
		};
	}

	$effect(() => {
		if (!open) return;
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
		open = !open;
		if (open) searchTerm = '';
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
		if (e.shiftKey) e.preventDefault();

		if (multiple && e.shiftKey) {
			const leavesInView = flattenLeaves(filteredGroups).map((o) => o.value);
			const current = asArray(value);
			const anchor = leavesInView.includes(lastSelectedLeafValue)
				? lastSelectedLeafValue
				: leavesInView.includes(current[0])
					? current[0]
					: null;

			if (anchor != null && leavesInView.includes(optValue)) {
				const a = leavesInView.indexOf(anchor);
				const b = leavesInView.indexOf(optValue);
				const [start, end] = a <= b ? [a, b] : [b, a];
				const range = leavesInView.slice(start, end + 1);
				value = e.altKey ? [...new Set([...current, ...range])] : range;
				onChange(value);
				lastSelectedLeafValue = optValue;
				return;
			}
		}

		if (e.altKey) {
			// Alt+click toggles in/out of the selection (multi-select).
			const current = asArray(value);
			const next = current.includes(optValue)
				? current.filter((v) => v !== optValue)
				: [...current, optValue];
			value = multiple ? next : next.length === 1 ? next[0] : next;
			onChange(value);
			lastSelectedLeafValue = optValue;
		} else if (multiple) {
			// Multi-select: a plain click toggles this column in/out (checkbox
			// behaviour) and keeps the menu open so several can be ticked in one
			// pass. The Close button (or clicking away) dismisses it.
			const current = asArray(value);
			const next = current.includes(optValue)
				? current.filter((v) => v !== optValue)
				: [...current, optValue];
			value = next;
			onChange(value);
			lastSelectedLeafValue = optValue;
		} else {
			// Single-select: pick this one and close.
			value = optValue;
			onChange(value);
			lastSelectedLeafValue = optValue;
			open = false;
		}
	}

	function selectAllInGroup(node, e) {
		e.stopPropagation();
		e.preventDefault?.();
		const leafIds = flattenLeaves(node.options ?? []).map((o) => o.value);
		if (!leafIds.length) return;

		// Group checkbox toggle: if every leaf is already selected, clear them all;
		// otherwise add them all. Keeps the menu open.
		const current = asArray(value);
		const allSelected = leafIds.every((v) => current.includes(v));
		const next = allSelected
			? current.filter((v) => !leafIds.includes(v))
			: [...new Set([...current, ...leafIds])];
		value = multiple ? next : next.length === 1 ? next[0] : next;
		onChange(value);
	}

	function isSelected(optValue) {
		return Array.isArray(value) ? value.includes(optValue) : value === optValue;
	}

	// Tri-state for a group's checkbox: 'all' / 'some' / 'none' of its leaves
	// (recursively) are currently selected.
	function groupSelectionState(node) {
		const ids = flattenLeaves(node.options ?? []).map((o) => o.value);
		if (ids.length === 0) return 'none';
		const sel = asArray(value);
		const n = ids.reduce((acc, id) => acc + (sel.includes(id) ? 1 : 0), 0);
		return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
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
		if (!open) return;
		const inTrigger = containerEl && containerEl.contains(e.target);
		const inDropdown = dropdownEl && dropdownEl.contains(e.target);
		if (!inTrigger && !inDropdown) open = false;
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

				{#if multiple}
					{@const gstate = groupSelectionState(node)}
					<span
						class="cs-check"
						class:checked={gstate === 'all'}
						class:indeterminate={gstate === 'some'}
						role="checkbox"
						aria-checked={gstate === 'all' ? 'true' : gstate === 'some' ? 'mixed' : 'false'}
						tabindex="0"
						title="Select/clear all columns in this group"
						onclick={(e) => selectAllInGroup(node, e)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') selectAllInGroup(node, e);
						}}
					>{gstate === 'all' ? '✓' : gstate === 'some' ? '–' : ''}</span>
				{/if}

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
			class:has-check={multiple}
			role={multiple ? 'checkbox' : undefined}
			aria-checked={multiple ? (isSelected(node.value) ? 'true' : 'false') : undefined}
			onmousedown={(e) => {
				if (e.shiftKey) e.preventDefault();
			}}
			onclick={(e) => selectLeaf(node.value, e)}
			type="button"
			style="padding-left: {(multiple ? 6 : 20) + depth * 14}px"
		>
			{#if multiple}
				<span class="cs-check" class:checked={isSelected(node.value)}
					>{isSelected(node.value) ? '✓' : ''}</span
				>
			{/if}
			<span class="option-label">{node.label}</span>
		</button>
	{/if}
{/snippet}

{#if !hideTrigger}
	<div class="select-container" bind:this={containerEl}>
		<button bind:this={triggerEl} class="trigger" onclick={toggleDropdown} type="button">
			<span class="trigger-label">{selectedLabel}</span>
			<span class="arrow">{open ? '▲' : '▼'}</span>
		</button>
	</div>
{/if}

{#if open}
	<div
		bind:this={dropdownEl}
		use:portalToBody
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
		<div class="cs-actions">
			{#if multiple}
				<span class="cs-count">{asArray(value).length} selected</span>
			{/if}
			<button type="button" class="cs-btn" onclick={() => (open = false)}>Close</button>
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
		font-size: var(--font-lg);
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
		color: var(--color-text-muted, #666);
		font-size: 0.75em;
		flex-shrink: 0;
	}

	.dropdown {
		position: fixed;
		background: var(--surface-card);
		border: 1px solid var(--color-lightness-85);
		border-top: none;
		z-index: 1000;
		box-shadow: var(--shadow-2);
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
		font-size: var(--font-md);
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
		font-size: var(--font-md);
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
		background: var(--surface-card);
		outline: none;
	}

	.chevron {
		width: 14px;
		display: inline-block;
		text-align: center;
		color: var(--color-text-muted, #666);
		flex-shrink: 0;
	}

	.group-options {
		display: flex;
		flex-direction: column;
	}

	.option {
		padding: 6px 8px;
		text-align: left;
		background: var(--surface-card);
		border: none;
		cursor: pointer;
		color: inherit;
		font-size: var(--font-md);
		user-select: none;
		-webkit-user-select: none;
	}

	.option:hover {
		background: var(--color-lightness-95);
	}

	.option.selected {
		background: var(--color-info-bg);
		color: var(--color-info-text);
	}

	/* Checkbox row layout for multi-select options. */
	.option.has-check {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
	}

	.option-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Faux checkbox used for both column options and group headers. Kept as a
	   styled span (not an <input>) so it can live inside the option <button>
	   without nesting interactive elements, while looking like the .all-menu
	   checkboxes elsewhere. */
	.cs-check {
		flex: 0 0 auto;
		width: 15px;
		height: 15px;
		box-sizing: border-box;
		border: 1.5px solid var(--color-lightness-55, #999);
		border-radius: 3px;
		background: var(--surface-card);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 11px;
		line-height: 1;
		color: #fff;
		cursor: pointer;
	}

	.cs-check.checked,
	.cs-check.indeterminate {
		background: var(--color-info-text, #1a73e8);
		border-color: var(--color-info-text, #1a73e8);
	}

	.group-header .cs-check:hover {
		border-color: var(--color-info-text, #1a73e8);
	}

	/* Bottom action bar with the Close button (mirrors .all-menu-actions). */
	.cs-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		padding: 6px 8px;
		border-top: 1px solid var(--color-lightness-90);
		background: var(--color-lightness-97);
		flex-shrink: 0;
	}

	.cs-count {
		margin-right: auto;
		font-size: var(--font-sm, 0.8em);
		color: var(--color-text-muted, #666);
	}

	.cs-btn {
		padding: 3px 12px;
		font-size: var(--font-md);
		border: 1px solid var(--color-lightness-75);
		border-radius: 3px;
		background: var(--surface-card);
		cursor: pointer;
		color: inherit;
	}

	.cs-btn:hover {
		background: var(--color-lightness-95);
	}

	.no-results {
		padding: 24px 16px;
		text-align: center;
		color: var(--color-text-muted, #666);
		font-size: var(--font-md);
	}
</style>
