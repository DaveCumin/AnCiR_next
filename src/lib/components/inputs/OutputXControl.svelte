<script>
	// @ts-nocheck
	/**
	 * The shared "Specify output x values" control of the fitting nodes (Cosinor, Rectangular
	 * wave, Double logistic, Fit waveform model, Trend fit): where the fitted curve is
	 * evaluated. See src/lib/utils/outputXSequence.js for the rules.
	 *
	 * The checkbox is on when `args.outputX` is not -1; ticking it writes the x input's id there
	 * (as the nodes always did), unticking writes -1. Each gesture writes ONE arg, so it is one
	 * step in the undo history (core/paramDiffWatcher records every p.args write). The checked
	 * state is derived from the args, never kept locally, so an undo shows on the box.
	 *
	 * - Column: the values of a chosen column (ColumnSelector on `args.outputX`).
	 * - Sequence: every `args.outputXStep` x units (hours for a time x) from the smallest to the
	 *   largest x. Only the step is asked for; an empty box is the automatic step (about 500
	 *   values), which the box shows.
	 *
	 * Props:
	 *  - args (bindable): the node's p.args, whose fields this control writes
	 *  - xCol: the node's x input column (decides hours vs x units, and the automatic step)
	 *  - excludeColIds: columns the Column picker leaves out (the node's own outputs)
	 *  - onchange: called after an edit that changes the result
	 *  - plainCheckbox: draw the checkbox the way the host's other checkboxes are drawn (a plain
	 *      label in a control-input, as Cosinor, Fit waveform model and Fit trend do; the
	 *      default is the control-input-checkbox row Rectangular wave and Double logistic use)
	 */
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import NumberWithUnits, { numberOrNull } from '$lib/components/inputs/NumberWithUnits.svelte';
	import {
		outputXSpecified,
		outputXMode,
		outputXSequence,
		OUTPUT_X_MODE_COLUMN,
		OUTPUT_X_MODE_SEQUENCE,
		OUTPUT_X_HOUR_UNITS
	} from '$lib/utils/outputXSequence.js';

	let {
		args = $bindable(),
		xCol = null,
		excludeColIds = [],
		onchange = () => {},
		plainCheckbox = false
	} = $props();

	const specified = $derived(outputXSpecified(args));
	const mode = $derived(outputXMode(args));
	const isTime = $derived(xCol?.type === 'time');
	// Non-breaking, so a wrapped hint never leaves the unit alone on the next line.
	const unit = $derived(isTime ? '\u00a0h' : '\u00a0x\u00a0units');

	// The sequence the current settings make (for the box's automatic value and the hint).
	const seq = $derived.by(() => {
		if (!specified || mode !== OUTPUT_X_MODE_SEQUENCE || !xCol) return null;
		const xs = isTime ? xCol.hoursSinceStart : xCol.getData?.();
		return outputXSequence(xs, args.outputXStep, isTime ? ' h' : '');
	});
	// The spinner moves the step by its own leading decimal (0.1 -> 0.1, 0.05 -> 0.01).
	const spinStep = $derived(
		seq?.step > 0 ? Number((10 ** Math.floor(Math.log10(seq.step))).toPrecision(1)) : 1
	);
	const isAuto = $derived(!(Number(args.outputXStep) > 0));
	// The x input itself is a valid output grid (ticking the box selects it), so the picker
	// never hides it; the node's own outputs stay excluded. Hosts pass their y-picker list,
	// which leaves x out, and the picker then showed "Select a column..." for the x it held.
	const columnExclude = $derived(excludeColIds.filter((id) => id !== args.xIN));

	function toggle(checked) {
		args.outputX = checked ? args.xIN : -1;
		onchange();
	}
	function setMode(value) {
		args.outputXMode = value;
		onchange();
	}
	function setStep(v) {
		args.outputXStep = numberOrNull(v);
		onchange();
	}
	const fmt = (v) => Number(Number(v).toPrecision(6)).toLocaleString('en-US');
</script>

<div class="control-input-horizontal">
	{#if plainCheckbox}
		<div class="control-input">
			<label>
				<input
					type="checkbox"
					checked={specified}
					onchange={(e) => toggle(e.currentTarget.checked)}
				/>
				Specify output x values
			</label>
		</div>
	{:else}
		<label class="control-input-checkbox">
			<input
				type="checkbox"
				checked={specified}
				onchange={(e) => toggle(e.currentTarget.checked)}
			/>
			<span class="ci-label">Specify output x values</span>
		</label>
	{/if}
</div>

{#if specified}
	<div class="control-input-horizontal">
		<ControlInput label="Output x values">
			<select value={mode} onchange={(e) => setMode(e.currentTarget.value)}>
				<option value={OUTPUT_X_MODE_COLUMN}>Column</option>
				<option value={OUTPUT_X_MODE_SEQUENCE}>Sequence</option>
			</select>
		</ControlInput>
	</div>
	{#if mode === OUTPUT_X_MODE_COLUMN}
		<div class="control-input-vertical">
			<div class="control-input">
				<p>Output x column</p>
				<ColumnSelector bind:value={args.outputX} excludeColIds={columnExclude} />
			</div>
		</div>
	{:else}
		<div class="output-x-seq">
			<div class="control-input-horizontal">
				<ControlInput label={isTime ? 'Step' : 'Step (x units)'}>
					{#if isTime}
						<!-- One row: the number and its unit menu (as Sequence Column's step). -->
						<div class="output-x-step">
							<NumberWithUnits
								nullable
								min={0}
								step={spinStep}
								value={args.outputXStep ?? seq?.step ?? null}
								units={OUTPUT_X_HOUR_UNITS}
								onInput={setStep}
							/>
						</div>
					{:else}
						<NumberWithUnits
							nullable
							min={0}
							step={spinStep}
							value={args.outputXStep ?? seq?.step ?? null}
							onInput={setStep}
						/>
					{/if}
				</ControlInput>
			</div>
			<p class="output-x-hint">
				{#if seq?.values}
					{seq.values.length.toLocaleString('en-US')} values from the smallest x, every
					{fmt(seq.step)}{unit}{isAuto
						? ' (the automatic step)'
						: '. Empty the box for the automatic step'}.
				{:else if seq?.warning}
					{seq.warning}
				{:else}
					The x input needs at least two different values.
				{/if}
			</p>
		</div>
	{/if}
{/if}

<style>
	.output-x-seq {
		min-width: 0;
	}
	.output-x-step {
		display: flex;
		min-width: 0;
	}
	.output-x-hint {
		font-size: var(--font-xs);
		color: var(--color-text-muted);
		margin: var(--space-1) 0 0;
	}
</style>
