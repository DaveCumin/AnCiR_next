<script>
	import { storeValue } from '$lib/core/core.svelte.js';

	let { label, value, defaultName = '', source = '' } = $props();
	let saved = $state(false);

	function save() {
		const name = prompt('Name for this value:', defaultName);
		if (name) {
			storeValue(name, value, source);
			saved = true;
			setTimeout(() => (saved = false), 1500);
		}
	}
</script>

<button class="store-btn" class:saved onclick={save} title="Save '{label}' as a stored value">
	{#if saved}
		✓
	{:else}
		💾
	{/if}
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
	.saved {
		color: #27ae60;
		border-color: #27ae60;
	}
</style>
