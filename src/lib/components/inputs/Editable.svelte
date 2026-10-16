<script>
	let {
		value = $bindable(),
		enterEnds = true,
		placeholder = '',
		forceNumber = false,
		number = { min: 0, step: 0.1 },
		onInput = () => {},
		// Fired once when an edit is committed (Enter / blur), with (finalValue,
		// originalValue). Lets callers record the change as a single undoable step
		// instead of on every keystroke. A caller that passes it OWNS the write: the field
		// goes back to the original first and then shows whatever the caller stored (an
		// operation's normalised name, or the original when the edit changed nothing), so
		// pass `value` without `bind:` alongside it.
		onCommit = null,
		editable = true
	} = $props();

	let originalValue = $state(value);
	let isEditing = $state(false);
	let inputElement = $state(null);

	function startEdit() {
		if (!editable) return;
		originalValue = value;
		isEditing = true;

		// Focus the input after it's rendered
		setTimeout(() => {
			if (inputElement) {
				inputElement.focus();
				inputElement.select();
			}
		}, 0);
	}

	function endEdit() {
		if (!isEditing) return;

		// Validate and coerce to number if needed
		if (forceNumber) {
			const parsed = parseFloat(value);
			if (isNaN(parsed)) {
				value = originalValue; // Revert if invalid
			} else {
				value = parsed; // Store as actual number
			}
		}

		isEditing = false;
		if (value === originalValue || !onCommit) return;
		const final = value;
		value = originalValue;
		onCommit(final, originalValue);
	}

	function handleKeydown(e) {
		if (enterEnds && e.key === 'Enter') {
			e.preventDefault();
			endEdit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			value = originalValue;
			isEditing = false;
		}
	}
</script>

{#if isEditing}
	<input
		bind:this={inputElement}
		bind:value
		type={forceNumber ? 'number' : 'text'}
		min={number?.min}
		max={number?.max}
		step={number?.step}
		class="inline-edit-input"
		size={value.length + 1}
		{placeholder}
		onkeydown={handleKeydown}
		onblur={endEdit}
		oninput={() => onInput(value)}
	/>
{:else if editable}
	<span
		role="button"
		tabindex="0"
		class="inline-edit-span editable"
		ondblclick={startEdit}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				startEdit();
			}
		}}
	>
		{value != null && value !== '' ? value : placeholder}
	</span>
{:else}
	<!-- Read-only: plain text, not a focusable control (same box, so columns line up). -->
	<span class="inline-edit-span">{value != null && value !== '' ? value : placeholder}</span>
{/if}

<style>
	.inline-edit-span,
	.inline-edit-input {
		display: inline-block;
		min-width: 2ch;
		max-width: 100%;
		min-height: 1.2em;
		font-family: inherit;
		font-size: inherit;
		line-height: inherit;
		margin: 0;
		padding: 2px 4px;
		border: 1px solid transparent;
		background: transparent;
		outline: none;
		box-sizing: border-box;
		vertical-align: baseline;
	}

	.inline-edit-span.editable {
		text-decoration: underline;
		text-decoration-color: var(--color-lightness-75);
		cursor: pointer;
	}

	.inline-edit-input {
		border-color: var(--color-lightness-50);
		border-radius: 2px;
		width: fit-content;
		min-width: 3ch;
		cursor: text;
	}

	.inline-edit-input:focus {
		outline: 2px solid var(--color-lightness-50);
		outline-offset: 1px;
	}

	/* Placeholder styling for span */
	.inline-edit-span:empty::before {
		content: attr(data-placeholder);
		color: var(--color-text-muted);
		font-style: italic;
	}
</style>
