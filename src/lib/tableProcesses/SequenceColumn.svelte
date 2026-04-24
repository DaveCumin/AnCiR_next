<script module>
	import { DateTime } from 'luxon';
	import { core } from '$lib/core/core.svelte';

	const displayName = 'Sequence Column';
	const defaults = new Map([
		['seqType', { val: 'number' }], // 'number' or 'time'
		['start', { val: 0 }],
		['step', { val: 1 }],
		['count', { val: 10 }],
		['end', { val: 9 }],
		// time-specific defaults (stored in ms)
		['startTime', { val: DateTime.utc().toMillis() }],
		['stepHours', { val: 1 }],
		['endTime', { val: DateTime.utc().plus({ days: 1 }).toMillis() }],
		['out', { result: { val: -1 } }],
		['valid', { val: false }]
	]);

	export function sequencecolumn(argsIN) {
		let result = [];

		if (argsIN.seqType === 'number') {
			const start = Number(argsIN.start);
			const step = Number(argsIN.step);
			if (step === 0) return [[], false];

			const count = Math.max(1, Math.floor(Number(argsIN.count)));
			for (let i = 0; i < count; i++) {
				result.push(Number((start + i * step).toFixed(10)));
			}
			// Safety cap
			if (result.length > 100000) result = result.slice(0, 100000);
		} else {
			// Time sequence
			const startMs = Number(argsIN.startTime);
			const stepMs = Number(argsIN.stepHours) * 3600000;
			if (stepMs === 0) return [[], false];

			const count = Math.max(1, Math.floor(Number(argsIN.count)));
			for (let i = 0; i < count; i++) {
				result.push(new Date(startMs + i * stepMs).toISOString());
			}
			if (result.length > 100000) result = result.slice(0, 100000);
		}

		if (argsIN.out.result === -1 || !argsIN.out.result) {
			// preview only
		} else {
			core.rawData.set(argsIN.out.result, result);
			getColumnById(argsIN.out.result).data = argsIN.out.result;
			getColumnById(argsIN.out.result).type = argsIN.seqType === 'time' ? 'time' : 'number';
			if (argsIN.seqType === 'time') {
				getColumnById(argsIN.out.result).timeFormat = "YYYY-MM-DD'T'HH:mm:ss.S'Z'";
			}
			const processHash = crypto.randomUUID();
			getColumnById(argsIN.out.result).tableProcessGUId = processHash;
		}

		return [result, result.length > 0];
	}

	export const definition = { displayName, defaults, func: sequencecolumn, columnIdFields: {} };
</script>

<script>
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import DateTimeHrs from '$lib/components/inputs/DateTimeHrs.svelte';
	import { onMount } from 'svelte';

	let { p = $bindable() } = $props();

	let result = $state();
	let previewStart = $state(1);

	function doSequence() {
		previewStart = 1;
		[result, p.args.valid] = sequencecolumn(p.args);
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
		} else {
			doSequence();
		}
	});
</script>

<div class="section-row">
	<div class="tableProcess-label">
		<span>Sequence settings</span>
	</div>

	<div class="control-input">
		<p>Type</p>
		<select bind:value={p.args.seqType} onchange={doSequence}>
			<option value="number">Number</option>
			<option value="time">Time</option>
		</select>
	</div>
</div>

<div class="section-row">
	<div class="tableProcess-label">
		<span>Parameters</span>
	</div>

	{#if p.args.seqType === 'number'}
		<div class="control-input-vertical">
			<div class="control-input">
				<p>Start</p>
				<NumberWithUnits bind:value={p.args.start} onInput={changedStart} step={0.1} />
			</div>
			<div class="control-input">
				<p>Step</p>
				<NumberWithUnits bind:value={p.args.step} onInput={changedStep} step={0.1} />
			</div>
			<div class="control-input">
				<p>Count (N)</p>
				<NumberWithUnits bind:value={p.args.count} onInput={changedCount} min={1} step={1} />
			</div>
			<div class="control-input">
				<p>End</p>
				<NumberWithUnits bind:value={p.args.end} onInput={changedEnd} step={0.1} />
			</div>
		</div>
	{:else}
		<div class="control-input-vertical">
			<div class="control-input">
				<p>Start time</p>
				<DateTimeHrs bind:value={p.args.startTime} onChange={changedStartTime} />
			</div>
			<div class="control-input">
				<p>Step</p>
				<div style="display:flex;">
					<NumberWithUnits
						bind:value={p.args.stepHours}
						min={0.001}
						step={0.01}
						units={{
							default: 'hrs',
							days: 24,
							hrs: 1,
							mins: 1 / 60,
							secs: 1 / (60 * 60)
						}}
						onInput={changedStepTime}
						selectedUnitStart="hrs"
					/>
				</div>
			</div>
			<div class="control-input">
				<p>Count (N)</p>
				<NumberWithUnits bind:value={p.args.count} onInput={changedCountTime} min={1} step={1} />
			</div>
			<div class="control-input">
				<p>End time</p>
				<DateTimeHrs bind:value={p.args.endTime} onChange={changedEndTime} />
			</div>
		</div>
	{/if}
</div>

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
{:else if p.args.out.result > 0}
	<details open>
		<summary class="section-details-summary">Output ({result?.length ?? 0} values)</summary>
		<ColumnComponent col={getColumnById(p.args.out.result)} />
	</details>
{:else}
	<p>Need to have valid inputs to create columns.</p>
{/if}
