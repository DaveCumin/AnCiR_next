<script>
	import { onMount, onDestroy } from 'svelte';
	import {
		core,
		storeValue,
		removeStoredValue,
		renameStoredValue,
		uniqueStoredValueName
	} from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';

	let { label, getter, defaultName = '', source = '' } = $props();
	let storedName = $state('');
	let showPopover = $state(false);
	let editValue = $state('');
	let inputEl = $state(null);
	let popoverEl = $state(null);
	let buttonEl = $state(null);
	let popoverPos = $state({ left: 0, top: 0 });

	onMount(() => {
		const base = defaultName || label || 'stored_value';
		// Take over a restored static snapshot of this button's default name (a
		// session import keeps getter entries as staticValue-only) instead of
		// suffixing _2 — formulas referencing the original name pick the live
		// getter back up. Suffixed leftovers (`base_2`, …) are claimed too, so
		// duplicate default names stay stable across save/load cycles. Never take
		// over ref entries (metric-port refs stay live on their own) or names
		// another live button already holds.
		const isStaticLeftover = (e) => !!e && typeof e.getter !== 'function' && !e.ref;
		let name = null;
		if (isStaticLeftover(core.storedValues[base])) {
			name = base;
		} else if (base in core.storedValues) {
			for (let n = 2; `${base}_${n}` in core.storedValues; n++) {
				if (isStaticLeftover(core.storedValues[`${base}_${n}`])) {
					name = `${base}_${n}`;
					break;
				}
			}
		}
		storedName = name ?? uniqueStoredValueName(base);
		storeValue(storedName, getter, source);
	});

	// Keep the stored getter up-to-date when the getter prop changes
	$effect(() => {
		if (storedName) {
			storeValue(storedName, getter, source);
		}
	});

	onDestroy(() => {
		if (storedName) {
			removeStoredValue(storedName);
		}
	});

	function openPopover() {
		editValue = storedName;
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
		if (editValue && editValue !== storedName) {
			storedName = renameStoredValue(storedName, editValue);
		}
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
		class="rename-popover"
		bind:this={popoverEl}
		style="left: {popoverPos.left}px; top: {popoverPos.top}px;"
	>
		<input
			bind:this={inputEl}
			bind:value={editValue}
			class="rename-input"
			onkeydown={handleKeydown}
			placeholder="Variable name"
		/>
		<button class="rename-ok" onclick={commitRename}>✓</button>
	</div>
{/if}

<span class="store-wrapper">
	<button class="icon" bind:this={buttonEl} onclick={openPopover} {@attach tooltip(storedName)}>
		<Icon name="edit" width={14} height={14} />
	</button>
</span>

<style>
	.store-wrapper {
		position: relative;
		display: inline-flex;
		align-items: center;
	}
	.store-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		margin-left: 4px;
		cursor: pointer;
		font-size: var(--font-sm);
		vertical-align: middle;
		line-height: 1;
	}
	.store-btn:hover {
		background: var(--color-lightness-85);
	}
	:global(.store-icon) {
		fill: var(--color-lightness-45);
	}
	:global(.store-btn:hover .store-icon) {
		fill: var(--color-hover);
	}
	.popover-backdrop {
		position: fixed;
		inset: 0;
		z-index: 9998;
	}
	.rename-popover {
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
	.rename-input {
		font-size: var(--font-sm);
		padding: 2px 6px;
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-xs);
		width: 140px;
		outline: none;
	}
	.rename-input:focus {
		border-color: var(--color-lightness-50);
	}
	.rename-input:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 1px;
	}
	.rename-ok {
		font-size: var(--font-sm);
		padding: 2px 8px;
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-xs);
		background: var(--color-lightness-97);
		cursor: pointer;
		color: #27ae60;
		font-weight: 600;
	}
	.rename-ok:hover {
		background: var(--color-lightness-85);
	}
</style>
