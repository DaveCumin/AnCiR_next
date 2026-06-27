<script>
	// @ts-nocheck
	// Inline-edit text field: shows a span when idle, swaps to an input on
	// double-click / Enter / F2.
	//
	// Standard editing model (see also $lib/core/nodeNaming.js):
	//   - onInput(value)  fires live on every keystroke — write the raw value so
	//                     dependent views update immediately.
	//   - onCommit(value) fires on blur / Enter — normalise here (trim, restore
	//                     defaults for empty input).
	//   - Escape          reverts live edits (re-fires onInput with the original)
	//                     and does not commit.
	// Ported from flowtest's Editable.svelte.
	import { tick } from 'svelte';

	let {
		value = '',
		placeholder = '',
		editable = true,
		ariaLabel = '',
		title = '',
		onCommit = null,
		onInput = null
	} = $props();

	let buffer = $state(value);
	$effect(() => {
		buffer = value;
	});

	let original = $state(value);
	let isEditing = $state(false);
	let inputEl;

	async function startEdit(e) {
		if (!editable) return;
		e?.stopPropagation();
		original = value;
		buffer = value;
		isEditing = true;
		await tick();
		inputEl?.focus();
		inputEl?.select();
	}

	function commit() {
		if (!isEditing) return;
		isEditing = false;
		onCommit?.(buffer);
	}

	function cancel() {
		if (!isEditing) return;
		buffer = original;
		onInput?.(original); // revert any live edits to the original
		isEditing = false;
	}

	function handleInput(e) {
		const next = e.currentTarget.value;
		buffer = next;
		onInput?.(next); // live update
	}

	function handleKeydown(e) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancel();
		}
	}
</script>

{#if isEditing}
	<input
		bind:this={inputEl}
		value={buffer}
		oninput={handleInput}
		type="text"
		class="editable-input"
		size={Math.max(2, (buffer ?? '').length + 1)}
		{placeholder}
		aria-label={ariaLabel}
		onkeydown={handleKeydown}
		onblur={commit}
		onpointerdown={(e) => e.stopPropagation()}
		onclick={(e) => e.stopPropagation()}
	/>
{:else}
	<span
		role="button"
		tabindex={editable ? 0 : -1}
		class="editable-span"
		class:editable
		{title}
		aria-label={ariaLabel}
		ondblclick={startEdit}
		onpointerdown={(e) => {
			if (e.detail >= 2) e.stopPropagation();
		}}
		onkeydown={(e) => {
			if (editable && (e.key === 'Enter' || e.key === 'F2')) {
				e.preventDefault();
				startEdit();
			}
		}}
	>
		{value && value !== '' ? value : placeholder}
	</span>
{/if}

<style>
	.editable-span,
	.editable-input {
		display: inline-block;
		min-width: 2ch;
		max-width: 100%;
		min-height: 1.2em;
		font-family: inherit;
		font-size: inherit;
		font-weight: inherit;
		line-height: inherit;
		color: inherit;
		margin: 0;
		padding: 0 2px;
		border: 1px solid transparent;
		background: transparent;
		outline: none;
		box-sizing: border-box;
		vertical-align: baseline;
	}

	.editable-span.editable {
		cursor: text;
		border-radius: 2px;
	}

	.editable-span.editable:hover {
		background: rgba(0, 0, 0, 0.06);
	}

	.editable-input {
		border-color: rgba(0, 0, 0, 0.4);
		border-radius: 2px;
		background: var(--surface-card);
		cursor: text;
	}

	.editable-input:focus {
		outline: var(--focus-ring);
		outline-offset: 1px;
	}
</style>
