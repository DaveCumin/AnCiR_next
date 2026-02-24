<script>
	import { core, getStoredValue, removeStoredValue, renameStoredValue } from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';

	let editingKey = $state(null);
	let editName = $state('');

	function startEdit(key) {
		editingKey = key;
		editName = key;
	}

	function commitEdit(oldKey) {
		if (editName && editName !== oldKey) {
			renameStoredValue(oldKey, editName);
		}
		editingKey = null;
	}

	function handleKeydown(e, oldKey) {
		if (e.key === 'Enter') commitEdit(oldKey);
		if (e.key === 'Escape') editingKey = null;
	}

	let entries = $derived(Object.entries(core.storedValues));
</script>

<div class="heading">
	<p>Stored Values</p>
</div>

<div class="stored-list">
	{#if entries.length === 0}
		<p class="empty-hint">
			No stored values yet. Use the 💾 buttons in Cosinor, Trend Fit, or Actogram outputs to save
			computed values.
		</p>
	{:else}
		{#each entries as [key, entry] (key)}
			<div class="sv-row">
				{#if editingKey === key}
					<input
						class="sv-name-input"
						bind:value={editName}
						onkeydown={(e) => handleKeydown(e, key)}
					/>
					<span class="sv-value">{typeof getStoredValue(key) === 'number' ? getStoredValue(key).toPrecision(6) : getStoredValue(key)}</span>
					<button class="sv-action sv-action-visible" onclick={() => commitEdit(key)} title="Save">✓</button>
				{:else}
					<span class="sv-name" title={entry.source || key}>{key}</span>
					<span class="sv-value">{typeof getStoredValue(key) === 'number' ? getStoredValue(key).toPrecision(6) : getStoredValue(key)}</span>
					<button class="sv-action" onclick={() => startEdit(key)} title="Rename">✏️</button>
					<button class="sv-action" onclick={() => removeStoredValue(key)} title="Delete">
						<Icon name="minus" width={14} height={14} className="menu-icon" />
					</button>
				{/if}
			</div>
		{/each}
	{/if}
</div>

<style>
	.heading {
		position: sticky;
		top: 0;
		width: 100%;
		height: 2rem;
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		align-items: center;
		border-bottom: 1px solid var(--color-lightness-85);
		background-color: white;
		z-index: 999;
	}

	.heading p {
		margin-left: 0.75rem;
		font-weight: bold;
	}

	.stored-list {
		width: 100%;
		margin-top: 0.25rem;
		padding: 0 0.5rem;
	}

	.empty-hint {
		font-size: 12px;
		color: var(--color-lightness-55, #888);
		padding: 0.5rem;
		line-height: 1.4;
	}

	.sv-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.25rem 0.25rem;
		border-bottom: 1px solid var(--color-lightness-95, #f2f2f2);
		font-size: 13px;
	}

	.sv-row:hover {
		background: var(--color-lightness-97, #f8f8f8);
	}

	.sv-name {
		flex: 1;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sv-value {
		font-family: monospace;
		font-size: 12px;
		color: var(--color-lightness-45, #555);
		min-width: 60px;
		text-align: right;
	}

	.sv-action {
		background: none;
		border: none;
		cursor: pointer;
		padding: 2px;
		font-size: 12px;
		line-height: 1;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s ease;
	}

	.sv-row:hover .sv-action,
	.sv-action-visible {
		opacity: 1;
		pointer-events: auto;
	}

	.sv-name-input {
		font-size: 12px;
		padding: 0.15rem 0.3rem;
		border: 1px solid var(--color-lightness-85, #ccc);
		border-radius: 3px;
		flex: 1;
	}
</style>
