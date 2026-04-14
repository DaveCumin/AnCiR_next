<script>
	import { onMount, onDestroy } from 'svelte';
	import {
		storeValue,
		removeStoredValue,
		renameStoredValue,
		uniqueStoredValueName
	} from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';

	let { label, getter, defaultName = '', source = '' } = $props();
	let storedName = $state('');
	let showPopover = $state(false);
	let editValue = $state('');
	let inputEl = $state(null);
	let popoverEl = $state(null);
	let buttonEl = $state(null);
	let popoverPos = $state({ left: 0, top: 0 });
	let tooltip = $state({ visible: false, x: 0, y: 0 });

	onMount(() => {
		storedName = uniqueStoredValueName(defaultName || label || 'stored_value');
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
		tooltip.visible = false;
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

	function showTooltip(e) {
		let x = e.clientX + 10;
		let y = e.clientY + 10;
		if (x + 100 > window.innerWidth) x = window.innerWidth - 110;
		if (y + 30 > window.innerHeight) y = e.clientY - 30;
		tooltip = { visible: true, x, y };
	}

	function hideTooltip() {
		tooltip = { visible: false, x: 0, y: 0 };
	}
</script>

{#if tooltip.visible}
	<div class="tooltip" style="left: {tooltip.x}px; top: {tooltip.y}px;">
		{storedName}
	</div>
{/if}

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
	<button
		class="icon"
		bind:this={buttonEl}
		onclick={openPopover}
		onmouseenter={showTooltip}
		onmouseleave={hideTooltip}
	>
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
		font-size: 12px;
		vertical-align: middle;
		line-height: 1;
	}
	.store-btn:hover {
		background: var(--color-lightness-85, #e0e0e0);
	}
	:global(.store-icon) {
		fill: var(--color-lightness-45, #555);
	}
	:global(.store-btn:hover .store-icon) {
		fill: var(--color-hover, #333);
	}
	.tooltip {
		position: fixed;
		z-index: 10000;
		background: rgba(0, 0, 0, 0.75);
		color: white;
		font-size: 11px;
		padding: 3px 7px;
		border-radius: 3px;
		pointer-events: none;
		white-space: nowrap;
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
		background: white;
		border: 1px solid var(--color-lightness-85, #ccc);
		border-radius: 4px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		z-index: 9999;
		white-space: nowrap;
	}
	.rename-input {
		font-size: 12px;
		padding: 2px 6px;
		border: 1px solid var(--color-lightness-85, #ccc);
		border-radius: 3px;
		width: 140px;
		outline: none;
	}
	.rename-input:focus {
		border-color: var(--color-lightness-50, #888);
	}
	.rename-ok {
		font-size: 12px;
		padding: 2px 8px;
		border: 1px solid var(--color-lightness-85, #ccc);
		border-radius: 3px;
		background: var(--color-lightness-97, #f8f8f8);
		cursor: pointer;
		color: #27ae60;
		font-weight: bold;
	}
	.rename-ok:hover {
		background: var(--color-lightness-85, #e0e0e0);
	}
</style>
