<script>
	let {
		value = $bindable(),
		enterEnds = true,
		placeholder = '',
		forceNumber = false,
		onInput = () => {}
	} = $props();
	let originalValue = $state(value);

	function startEdit(e) {
		originalValue = value;
		e.target.setAttribute('contenteditable', 'true');
		e.target.focus();
	}

	function endEdit(e) {
		e.target.setAttribute('contenteditable', 'false');

		// Validate and coerce to number if needed
		if (forceNumber) {
			const parsed = parseFloat(value);
			if (isNaN(parsed)) {
				value = originalValue; // Revert if invalid
			} else {
				value = parsed; // Store as actual number
			}
		}
		onInput(value);
	}
</script>

<span
	role="textbox"
	tabindex="0"
	contenteditable="false"
	bind:innerText={value}
	ondblclick={startEdit}
	onfocusout={endEdit}
	oninput={(e) => {
		// Real-time validation while typing
		if (forceNumber) {
			const text = e.target.innerText;
			// Remove any non-numeric characters except decimal point and minus
			const cleaned = text.replace(/[^\d.-]/g, '');
			if (cleaned !== text) {
				e.target.innerText = cleaned;
			}
		}
		onInput(value);
	}}
	onkeydown={(e) => {
		if (enterEnds && e.key === 'Enter') {
			e.preventDefault();
			endEdit(e);
			e.target.blur();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			value = originalValue;
			endEdit(e);
			e.target.blur();
		} else if (forceNumber) {
			// Allow: digits, decimal point, minus, backspace, delete, arrows, tab
			const allowed =
				/^[0-9.]$/.test(e.key) ||
				e.key === '-' ||
				e.key === 'Backspace' ||
				e.key === 'Delete' ||
				e.key === 'ArrowLeft' ||
				e.key === 'ArrowRight' ||
				e.key === 'Tab' ||
				e.ctrlKey ||
				e.metaKey;

			// Prevent multiple decimal points
			if (e.key === '.' && e.target.innerText.includes('.')) {
				e.preventDefault();
			}
			// Prevent minus if not at start
			else if (
				e.key === '-' &&
				(e.target.innerText.includes('-') || window.getSelection().anchorOffset !== 0)
			) {
				e.preventDefault();
			} else if (!allowed) {
				e.preventDefault();
			}
		}
	}}
	class="inline-edit"
	data-placeholder={placeholder}
/>

<style>
	.inline-edit {
		display: inline-block;
		min-width: 2ch;
		min-height: 1.2em;
		outline: none;
	}
	.inline-edit[contenteditable='false'] {
		border-bottom: 1px solid var(--color-lightness-75);
		cursor: pointer;
	}

	.inline-edit[contenteditable='true'] {
		cursor: text;
	}

	.inline-edit.empty:not([contenteditable='true'])::before {
		content: attr(data-placeholder);
	}
</style>
