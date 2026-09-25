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

	// Deliberately $state + a post-render $effect rather than a writable $derived: the
	// buffer must only re-sync AFTER the DOM has updated. `handleInput` writes the buffer
	// and then calls `onInput`, which usually writes back to `value`; a writable $derived
	// would re-evaluate synchronously during that round trip and can clobber the buffer
	// mid-keystroke in this focus/caret-sensitive inline editor.
	// eslint-disable-next-line svelte/prefer-writable-derived -- see comment above: the post-render timing of the effect is load bearing
	let buffer = $state(value);
	$effect(() => {
		buffer = value;
	});

	let original = $state(value);
	let isEditing = $state(false);
	let inputEl;

	// The idle span ellipsizes a name too long for its slot. When it does, the
	// hover tooltip leads with the full name so it is never lost. Measured on
	// pointerenter (before the browser shows the title) rather than observed.
	let truncated = $state(false);
	const shownText = $derived(value && value !== '' ? value : placeholder);
	const spanTitle = $derived(
		truncated && shownText ? (title ? `${shownText}\n${title}` : shownText) : title
	);
	function measureTruncation(e) {
		const el = e.currentTarget;
		// scrollWidth is rounded to whole px, so text a fraction of a pixel too wide
		// is drawn with an ellipsis yet reports no overflow. Compare the text's own
		// width with the content box too.
		const cs = getComputedStyle(el);
		const inset =
			parseFloat(cs.paddingLeft) +
			parseFloat(cs.paddingRight) +
			parseFloat(cs.borderLeftWidth) +
			parseFloat(cs.borderRightWidth);
		const range = document.createRange();
		range.selectNodeContents(el);
		const textW = range.getBoundingClientRect().width;
		truncated =
			el.scrollWidth > el.clientWidth || textW > el.getBoundingClientRect().width - inset + 0.05;
	}

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
		title={spanTitle}
		aria-label={ariaLabel}
		onpointerenter={measureTruncation}
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
		{shownText}
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

	/* Names are single-line labels (node titles, output rows): an over-long one
	   ends in an ellipsis instead of being cut mid-glyph by the parent's
	   overflow:hidden. The parent's own text-overflow cannot do this, because an
	   inline-block is atomic and never ellipsized. vertical-align: top because an
	   overflow:hidden inline-block's baseline drops to its bottom edge, which
	   would lift the text off the line. */
	.editable-span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		vertical-align: top;
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
