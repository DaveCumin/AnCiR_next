<script module>
	import dayjs from '$lib/utils/time/dayjsSetup.js';
	import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';
	import { core } from '$lib/core/core.svelte';

	const displayName = 'Sequence Column';
	const defaults = new Map([
		['seqType', { val: 'number' }], // 'number' or 'time'
		['start', { val: 0 }],
		['step', { val: 1 }],
		['count', { val: 10 }],
		['end', { val: 9 }],
		// time-specific defaults (stored in ms)
		['startTime', { val: dayjs.utc().valueOf() }],
		['stepHours', { val: 1 }],
		['endTime', { val: dayjs.utc().add(1, 'day').valueOf() }],
		['out', { result: { val: -1 } }],
		['valid', { val: false }]
	]);

	/**
	 * The longest sequence, in values. A guard against a mistyped count (or an End far from
	 * Start): every value is built and held in memory before anything else happens, so 1e9
	 * would stall or crash the tab. The same limit as Interpolate's resample grid, and the
	 * Python and R ports refuse past it in the same words. (Until 2026-10 the JS cut the
	 * sequence to 100,000 values AFTER building all of them, so it protected nothing and
	 * silently shortened longer sequences; the ports had no limit.)
	 */
	export const MAX_SEQUENCE_LENGTH = 2_000_000;

	/** The number of values a sequence asks for (at least 1). */
	function sequenceCount(argsIN) {
		return Math.max(1, Math.floor(Number(argsIN.count)));
	}

	/**
	 * The warning shown when the count passes MAX_SEQUENCE_LENGTH, or null when it fits.
	 * @returns {string | null}
	 */
	export function sequenceLimitWarning(count) {
		if (!(count > MAX_SEQUENCE_LENGTH)) return null;
		return (
			`Nothing was made: ${count.toLocaleString('en-US')} values is more than the limit of ` +
			`${MAX_SEQUENCE_LENGTH.toLocaleString('en-US')}. Lower the count, or use a larger step ` +
			`for the same start and end.`
		);
	}

	/** The node's warnings for these settings (shown on the node and in its panel). */
	export function sequenceWarnings(argsIN) {
		const w = sequenceLimitWarning(sequenceCount(argsIN));
		return w ? [w] : [];
	}

	export function sequencecolumn(argsIN) {
		let result = [];
		const isTime = argsIN.seqType === 'time';
		const count = sequenceCount(argsIN);

		if (count > MAX_SEQUENCE_LENGTH) {
			// Refused before building anything; empty the output so it does not keep an
			// earlier sequence that no longer matches the settings.
			writeOutputColumn(argsIN.out?.result, [], { type: isTime ? 'time' : 'number' });
			return [[], false];
		}

		if (!isTime) {
			const start = Number(argsIN.start);
			const step = Number(argsIN.step);
			if (step === 0) return [[], false];

			for (let i = 0; i < count; i++) {
				result.push(Number((start + i * step).toFixed(10)));
			}
		} else {
			// Time sequence
			const startMs = Number(argsIN.startTime);
			const stepMs = Number(argsIN.stepHours) * 3600000;
			if (stepMs === 0) return [[], false];

			for (let i = 0; i < count; i++) {
				result.push(new Date(startMs + i * stepMs).toISOString());
			}
		}

		// An unallocated out column (preview) is a no-op inside the helper.
		writeOutputColumn(argsIN.out.result, result, {
			type: isTime ? 'time' : 'number',
			// Only touch timeFormat for a time sequence; a numeric one leaves
			// whatever the column already carried, as before.
			timeFormat: isTime ? 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]' : undefined,
			processHash: crypto.randomUUID()
		});

		return [result, result.length > 0];
	}

	export const definition = {
		displayName,
		defaults,
		func: sequencecolumn,
		columnIdFields: {},
		nodeSpec: {
			id: 'tableprocess.sequencecolumn',
			inputs: [],
			outputs: [{ name: 'result', kind: 'column', cardinality: 'one' }]
		}
	};
</script>

<script>
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import DateTimeHrs from '$lib/components/inputs/DateTimeHrs.svelte';
	import { onMount } from 'svelte';

	let { p = $bindable() } = $props();

	let result = $state();
	let previewStart = $state(1);

	function doSequence() {
		previewStart = 1;
		[result, p.args.valid] = sequencecolumn(p.args);
		p.warnings = sequenceWarnings(p.args);
	}

	// --- Linked parameter helpers for numeric sequences ---
	function changedStart() {
		// Keep count & step, recalculate end
		p.args.end = Number((p.args.start + p.args.step * (p.args.count - 1)).toFixed(10));
		doSequence();
	}

	function changedStep() {
		// Keep count & start, recalculate end
		p.args.end = Number((p.args.start + p.args.step * (p.args.count - 1)).toFixed(10));
		doSequence();
	}

	function changedCount() {
		// Keep start & step, recalculate end
		p.args.count = Math.max(1, Math.floor(Number(p.args.count)));
		p.args.end = Number((p.args.start + p.args.step * (p.args.count - 1)).toFixed(10));
		doSequence();
	}

	function changedEnd() {
		// Keep start & step, recalculate count
		const step = Number(p.args.step);
		if (step === 0) return;
		p.args.count = Math.max(1, Math.floor((p.args.end - p.args.start) / step) + 1);
		doSequence();
	}

	// --- Linked parameter helpers for time sequences ---
	function changedStartTime() {
		// Keep count & step, recalculate endTime
		p.args.endTime = p.args.startTime + p.args.stepHours * 3600000 * (p.args.count - 1);
		doSequence();
	}

	function changedStepTime() {
		// Keep count & start, recalculate endTime
		p.args.endTime = p.args.startTime + p.args.stepHours * 3600000 * (p.args.count - 1);
		doSequence();
	}

	function changedCountTime() {
		// Keep startTime & step, recalculate endTime
		p.args.count = Math.max(1, Math.floor(Number(p.args.count)));
		p.args.endTime = p.args.startTime + p.args.stepHours * 3600000 * (p.args.count - 1);
		doSequence();
	}

	function changedEndTime() {
		// Keep startTime & step, recalculate count
		const stepMs = Number(p.args.stepHours) * 3600000;
		if (stepMs === 0) return;
		p.args.count = Math.max(1, Math.floor((p.args.endTime - p.args.startTime) / stepMs) + 1);
		doSequence();
	}

	onMount(() => {
		const outKey = p.args.out.result;
		if (outKey >= 0 && core.rawData.has(outKey) && core.rawData.get(outKey).length > 0) {
			result = core.rawData.get(outKey);
			p.args.valid = true;
			p.warnings = sequenceWarnings(p.args);
		} else {
			doSequence();
		}
	});
</script>

<div class="section-row">
	<div class="tableProcess-label">
		<span>Sequence settings</span>
	</div>

	<ControlInput label="Type">
		<select bind:value={p.args.seqType} onchange={doSequence}>
			<option value="number">Number</option>
			<option value="time">Time</option>
		</select>
	</ControlInput>
</div>

<div class="section-row">
	<div class="tableProcess-label">
		<span>Parameters</span>
	</div>

	{#if p.args.seqType === 'number'}
		<div class="control-input-vertical">
			<ControlInput label="Start">
				<NumberWithUnits bind:value={p.args.start} onInput={changedStart} step={0.1} />
			</ControlInput>
			<ControlInput label="Step">
				<NumberWithUnits bind:value={p.args.step} onInput={changedStep} step={0.1} />
			</ControlInput>
			<ControlInput label="Count (N)">
				<NumberWithUnits bind:value={p.args.count} onInput={changedCount} min={1} step={1} />
			</ControlInput>
			<ControlInput label="End">
				<NumberWithUnits bind:value={p.args.end} onInput={changedEnd} step={0.1} />
			</ControlInput>
		</div>
	{:else}
		<div class="control-input-vertical">
			<div class="control-input">
				<p>Start time</p>
				<DateTimeHrs bind:value={p.args.startTime} onChange={changedStartTime} />
			</div>
			<ControlInput label="Step">
				<div style="display:flex;">
					<NumberWithUnits
						bind:value={p.args.stepHours}
						min={0.001}
						step={0.01}
						units={{
							default: 'h',
							days: 24,
							h: 1,
							min: 1 / 60,
							s: 1 / (60 * 60)
						}}
						onInput={changedStepTime}
						selectedUnitStart="h"
					/>
				</div>
			</ControlInput>
			<ControlInput label="Count (N)">
				<NumberWithUnits bind:value={p.args.count} onInput={changedCountTime} min={1} step={1} />
			</ControlInput>
			<div class="control-input">
				<p>End time</p>
				<DateTimeHrs bind:value={p.args.endTime} onChange={changedEndTime} />
			</div>
		</div>
	{/if}
</div>

{#each sequenceWarnings(p.args) as w (w)}
	<p class="warn">{w}</p>
{/each}

{#if p.args.valid && p.args.out.result === -1}
	{@const totalRows = result.length}
	<p>Preview ({totalRows} values):</p>
	<Table headers={['Result']} data={[result.slice(previewStart - 1, previewStart + 5)]} />
	<p>
		Row <NumberWithUnits
			min={1}
			max={Math.max(1, totalRows - 5)}
			step={1}
			bind:value={previewStart}
		/> to {Math.min(previewStart + 5, totalRows)} of {totalRows}
	</p>
{:else if p.args.out.result >= 0}
	<details open>
		<summary class="section-details-summary">Output ({result?.length ?? 0} values)</summary>
		<ColumnComponent col={getColumnById(p.args.out.result)} />
	</details>
{:else}
	<p>Need to have valid inputs to create columns.</p>
{/if}

<style>
	.warn {
		font-size: var(--font-xs);
		color: var(--color-warning-text);
		background: var(--color-warning-bg);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		margin: var(--space-1) 0;
	}
</style>
