<script>
	// @ts-nocheck
	// "Name this result" button for one cell of a metric output column (the
	// per-series breakdown rows in TableProcessNode's Metrics section).
	//
	// Registers a REF-based stored value ({tpId, outKey, yId|index}) via
	// storeValueRef — resolved live from the engine-written output column, so it
	// survives node collapse and session reload (unlike StoreValueButton's
	// component-lifetime getter entries).
	import {
		core,
		storeValueRef,
		removeStoredValue,
		renameStoredValue,
		uniqueStoredValueName
	} from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';

	let { tp, outKey, defaultName = '', yId = null, index = null, source = '' } = $props();

	// The registry entry pointing at THIS cell, if any.
	const storedName = $derived.by(() => {
		for (const [name, entry] of Object.entries(core.storedValues ?? {})) {
			const r = entry?.ref;
			if (!r || r.tpId !== tp?.id || r.outKey !== outKey) continue;
			if ((r.yId ?? null) === (yId ?? null) && (r.index ?? null) === (index ?? null)) return name;
		}
		return null;
	});

	let showPopover = $state(false);
	let editValue = $state('');
	let inputEl = $state(null);
	let popoverEl = $state(null);
	let buttonEl = $state(null);
	let popoverPos = $state({ left: 0, top: 0 });

	function sanitizeName(s) {
		return String(s ?? '')
			.trim()
			.replace(/\s+/g, '_')
			.replace(/[^a-zA-Z0-9_]/g, '');
	}

	function register() {
		const base = sanitizeName(defaultName) || `${outKey}_value`;
		const name = uniqueStoredValueName(base);
		storeValueRef(name, { tpId: tp.id, outKey, yId, index }, source);
		return name;
	}

	function openPopover() {
		editValue = storedName ?? register();
		showPopover = true;
		setTimeout(() => {
			if (buttonEl) {
				const btnRect = buttonEl.getBoundingClientRect();
				let left = btnRect.left;
				let top = btnRect.bottom + 4;
				if (popoverEl) {
					const popRect = popoverEl.getBoundingClientRect();
					if (left + popRect.width > window.innerWidth) left = btnRect.right - popRect.width;
					if (top + popRect.height > window.innerHeight) top = btnRect.top - popRect.height - 4;
				}
				popoverPos = { left, top };
			}
			if (inputEl) {
				inputEl.focus();
				inputEl.select();
			}
		}, 0);
	}

	function commitRename() {
		const next = sanitizeName(editValue);
		if (next && storedName && next !== storedName) {
			renameStoredValue(storedName, next);
		}
		showPopover = false;
	}

	function unstore() {
		if (storedName) removeStoredValue(storedName);
		showPopover = false;
	}

	function handleKeydown(e) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitRename();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			showPopover = false;
		}
	}
</script>

{#if showPopover}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="popover-backdrop" onclick={() => commitRename()} onkeydown={() => {}}></div>
	<div
		class="tag-popover"
		bind:this={popoverEl}
		style="left: {popoverPos.left}px; top: {popoverPos.top}px;"
	>
		<input
			bind:this={inputEl}
			bind:value={editValue}
			class="tag-input"
			onkeydown={handleKeydown}
			placeholder="Variable name"
		/>
		<button class="tag-ok" onclick={commitRename} title="Save name">✓</button>
		<button class="tag-remove" onclick={unstore} title="Remove stored value">✕</button>
	</div>
{/if}

<span class="tag-wrapper">
	{#if storedName}
		<button
			class="tag-chip"
			bind:this={buttonEl}
			onclick={openPopover}
			{@attach tooltip(`Stored as "${storedName}" — usable in formulas`)}
		>
			{storedName}
		</button>
	{:else}
		<button
			class="icon tag-btn"
			bind:this={buttonEl}
			onclick={openPopover}
			{@attach tooltip(
				`Store for use in formulas as "${sanitizeName(defaultName) || `${outKey}_value`}" (click to rename)`
			)}
		>
			<Icon name="tag" width={11} height={11} />
		</button>
	{/if}
</span>

<style>
	.tag-wrapper {
		display: inline-flex;
		align-items: center;
		/* As a flex item in the breakdown row: shrinkable down to a clickable
		   stub, never wide enough to push the value out of the card. */
		flex: 0 1 auto;
		min-width: 26px;
	}
	.tag-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
		color: var(--color-text-muted);
		opacity: 0.7;
	}
	.tag-btn:hover {
		opacity: 1;
		color: var(--color-accent);
	}
	.tag-chip {
		max-width: min(110px, 100%);
		min-width: 0;
		padding: 0 5px;
		border: 1px solid var(--color-accent-soft, #bfdbfe);
		border-radius: var(--radius-lg);
		background: transparent;
		font-size: var(--font-2xs);
		font-family: var(--font-mono, ui-monospace, SF Mono, monospace);
		line-height: 1.5;
		color: var(--color-accent);
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tag-chip:hover {
		background: var(--color-accent-soft, #dbeafe);
	}
	.popover-backdrop {
		position: fixed;
		inset: 0;
		z-index: 9998;
	}
	.tag-popover {
		position: fixed;
		display: flex;
		gap: 4px;
		padding: 4px;
		background: var(--surface-card);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-1);
		z-index: 9999;
		white-space: nowrap;
	}
	.tag-input {
		font-size: var(--font-sm);
		padding: 2px 6px;
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-xs);
		width: 140px;
		outline: none;
	}
	.tag-input:focus {
		border-color: var(--color-lightness-50);
	}
	.tag-input:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 1px;
	}
	.tag-ok,
	.tag-remove {
		font-size: var(--font-sm);
		padding: 2px 8px;
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-xs);
		background: var(--color-lightness-97);
		cursor: pointer;
		font-weight: 600;
	}
	.tag-ok {
		color: #27ae60;
	}
	.tag-remove {
		color: var(--color-danger, #c0392b);
	}
	.tag-ok:hover,
	.tag-remove:hover {
		background: var(--color-lightness-85);
	}
</style>
