<script>
	import { onMount, onDestroy } from 'svelte';
	import { storeValue, removeStoredValue, renameStoredValue, uniqueStoredValueName } from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';

	let { label, getter, defaultName = '', source = '' } = $props();
	let storedName = $state('');

	onMount(() => {
		storedName = uniqueStoredValueName(defaultName || label || 'stored_value');
		storeValue(storedName, getter, source);
	});

	onDestroy(() => {
		if (storedName) {
			removeStoredValue(storedName);
		}
	});

	function editName() {
		const newName = prompt('Rename stored value:', storedName);
		if (newName && newName !== storedName) {
			storedName = renameStoredValue(storedName, newName);
		}
	}
</script>

<button class="store-btn" onclick={editName} title={storedName}>
	<Icon name="disk" width={14} height={14} className="store-icon" />
</button>

<style>
	.store-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		margin-left: 4px;
		border: 1px solid var(--color-lightness-85, #ccc);
		border-radius: 3px;
		background: var(--color-lightness-97, #f8f8f8);
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
</style>
