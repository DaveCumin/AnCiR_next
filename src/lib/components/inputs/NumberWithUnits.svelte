<script module>
	/**
	 * What a `nullable` box's `onInput` value means for a field: a number, or null for
	 * "not set" (an axis limit back to automatic). For the callers that store it.
	 *
	 * @param {unknown} v
	 * @returns {number|null}
	 */
	export function numberOrNull(v) {
		if (v == null || v === '') return null;
		const n = typeof v === 'number' ? v : parseFloat(String(v));
		return Number.isFinite(n) ? n : null;
	}
</script>

<script>
	import { onMount, tick } from 'svelte';
	import { displayNumber, readableNumber } from './numberDisplay.js';
	let {
		value = $bindable(),
		step = 1,
		min = -Infinity,
		max = Infinity,
		units = { default: 'value', value: 1 },
		onInput = () => {},
		// Whether "not set" is a value this field can hold (an axis limit, whose null means
		// automatic). Leaving the box empty then stores null; otherwise it puts the value back.
		nullable = false,
		// Shown in an empty box (a value that is not set). Defaults to "auto" for a nullable
		// field, whose null means automatic.
		placeholder = undefined,
		selectedUnitStart = 'default',
		className = '',
		style = ''
	} = $props();

	let inputElement = $state(null);

	// eg units:
	// 		{
	// 		default: 'hr',
	// 		days: 24,
	// 		hr: 1,
	// 		min: 1 / 60,
	// 		sec: 1 / (60 * 60)
	// 		}

	// Clamp initial value to min/max.
	//
	// Only a real number is clamped. A null/undefined value means "not set" for the
	// fields that support inheriting (a legend or sig-bar size that follows the
	// figure), and clamp(null, min, max) returns `min` — so clamping unconditionally
	// wrote `min` back through $bindable and silently converted "follow the figure"
	// into a hard override just because the control had been rendered. Merely opening
	// the control panel changed the figure.
	onMount(() => {
		if (typeof value === 'number' && Number.isFinite(value)) value = clamp(value, min, max);
		if (selectedUnitStart != 'default') {
			selectedUnit = selectedUnitStart;
		}
	});

	// State for selected unit
	let selectedUnit = $state(units['default']);

	// Derived unit factor
	let unitFactor = $derived(units[selectedUnit]);

	// Whether the box is being edited. Editing shows the full stored value; reading shows it
	// tidied (numberDisplay.js). Display only: neither form is ever written back.
	let focused = $state(false);

	// Derived display value (reactive to value, unitFactor and focus). Never plainly rounded to
	// the step: a step of 1e-7 used to round a stored 1e-7 to "0".
	let displayValue = $derived.by(() => {
		// Not set (null: automatic, or inherited) is an empty box, never 0: `null / 1` is 0,
		// which read as a real limit of 0 (an FFT x limit after "reset to auto").
		if (value == null || value === '') return null;
		const val =
			typeof unitFactor === 'object' ? unitFactor.inverse(Number(value)) : value / unitFactor;
		return focused ? displayNumber(val) : readableNumber(val, step);
	});

	// Clamp function
	function clamp(val, minVal, maxVal) {
		return Math.max(minVal, Math.min(maxVal, val));
	}

	// Store a number typed in the box's own units.
	function updateValue(newDisplayValue) {
		let newValue =
			typeof unitFactor === 'object' && Object.keys(units).length > 1
				? unitFactor.forward(Number(newDisplayValue))
				: newDisplayValue * unitFactor;
		newValue = clamp(newValue, min, max);
		value = newValue;
		onInput(value);
	}

	// What the box holds, as a number, or null when it holds nothing valid. A number input
	// reports an empty box and a partial entry ("-", "-.", "1e") alike, as "".
	function typedNumber() {
		const text = inputElement?.value ?? '';
		if (text.trim() === '') return null;
		const n = Number(text);
		return Number.isFinite(n) ? n : null;
	}

	// Typing. A valid number is stored at once (the plot previews it). An empty or partial
	// entry is "no change yet": nothing is stored, and the box is left as it is, so a
	// negative or a decimal can be typed into a cleared box.
	function handleInput() {
		const n = typedNumber();
		if (n === null) return;
		updateValue(n);
	}

	// Leaving the box (blur, Enter) with nothing valid in it: a nullable field stores null
	// (automatic); any other field goes back to the value it had.
	function commitEmpty() {
		if (!inputElement || typedNumber() !== null) return;
		// Not written to `value` here: the caller's null means "automatic", and the box then
		// shows whatever the caller passes back for it (the automatic limit).
		if (nullable) onInput(null);
		syncBox(true);
		tick().then(() => syncBox(true));
	}

	// Put the stored value into the box. While the box is being edited it is only rewritten
	// when it holds a different valid number (an undo, a spinner, another control), never
	// over a partial entry or over "1.0" when 1 is stored.
	function syncBox(force = false) {
		if (!inputElement) return;
		const shown = displayValue;
		const text = shown == null || Number.isNaN(shown) ? '' : String(shown);
		if (!force && focused) {
			const n = typedNumber();
			if (n === null || n === Number(shown)) return;
		}
		if (inputElement.value !== text) inputElement.value = text;
	}

	$effect(() => {
		displayValue;
		focused;
		syncBox();
	});

	function handleKeydown(e) {
		if (e.key === 'Enter') commitEmpty();
		else if (e.key === 'Escape') {
			// The plot panel's recorder puts a previewed value back; the box follows once that
			// has landed (a partial entry stored nothing, so nothing else would rewrite it).
			tick().then(() => syncBox(true));
		}
	}

	// A box left empty sends `change` BEFORE `blur`, and `change` is when the plot panel
	// records the edit (plots/plotEditScope.js): the null has to be stored by then, or the
	// step records nothing and the null lands outside the history.
	function handleChange() {
		commitEmpty();
	}

	function handleBlur() {
		commitEmpty();
		focused = false;
	}
</script>

<span class="number-input-wrapper">
	<input
		bind:this={inputElement}
		type="number"
		{step}
		min={typeof unitFactor === 'object' ? min : min / unitFactor}
		max={typeof unitFactor === 'object' ? max : max / unitFactor}
		oninput={handleInput}
		onkeydown={handleKeydown}
		onchange={handleChange}
		onfocus={() => (focused = true)}
		onblur={handleBlur}
		onwheel={(e) => {
			if (document.activeElement == inputElement) e.stopPropagation();
		}}
		placeholder={placeholder ?? (nullable ? 'auto' : '')}
		class={'number-input ' + className}
		{style}
	/>
</span>

{#if Object.keys(units).length > 2}
	<select class="unitSelect" bind:value={selectedUnit}>
		{#each Object.keys(units) as unit (unit)}
			{#if unit !== 'default'}
				<option value={unit}>{unit}</option>
			{/if}
		{/each}
	</select>
{/if}

<style>
	.number-input-wrapper {
		display: inline-flex;
		align-items: stretch;
		position: relative;
		min-width: 60%;
	}

	.number-input {
		cursor: text;
		user-select: none;
	}

	.number-input:hover {
		border-color: var(--color-text-muted);
	}

	.number-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.number-input:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 1px;
	}

	.unitSelect {
		user-select: none;
	}
</style>
