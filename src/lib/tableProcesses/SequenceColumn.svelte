<script module>
	import { DateTime } from 'luxon';
	import { core } from '$lib/core/core.svelte';

	export const sequencecolumn_displayName = 'Sequence Column';
	export const sequencecolumn_defaults = new Map([
		['seqType', { val: 'number' }], // 'number' or 'time'
		['start', { val: 0 }],
		['step', { val: 1 }],
		['mode', { val: 'count' }], // 'count' or 'end'
		['count', { val: 10 }],
		['end', { val: 9 }],
		// time-specific defaults (stored in ms)
		['startTime', { val: DateTime.fromISO(new Date().toISOString(), { zone: 'utc' }).toMillis() }],
		['stepHours', { val: 1 }],
		['endTime', { val: DateTime.fromISO(new Date().toISOString(), { zone: 'utc' }).plus({ days: 1 }).toMillis() }],
		['out', { result: { val: -1 } }],
		['valid', { val: false }]
	]);

	export function sequencecolumn(argsIN) {
		let result = [];

		if (argsIN.seqType === 'number') {
			const start = Number(argsIN.start);
			const step = Number(argsIN.step);
			if (step === 0) return [[], false];

			if (argsIN.mode === 'count') {
				const count = Math.max(0, Math.floor(Number(argsIN.count)));
				for (let i = 0; i < count; i++) {
					result.push(Number((start + i * step).toFixed(10)));
				}
			} else {
				// 'end' mode
				const end = Number(argsIN.end);
				if (step > 0) {
					for (let v = start; v <= end + step * 1e-9; v += step) {
						result.push(Number(v.toFixed(10)));
					}
				} else {
					for (let v = start; v >= end + step * 1e-9; v += step) {
						result.push(Number(v.toFixed(10)));
					}
				}
			}
			// Safety cap
			if (result.length > 100000) result = result.slice(0, 100000);
		} else {
			// Time sequence
			const startMs = Number(argsIN.startTime);
			const stepMs = Number(argsIN.stepHours) * 3600000;
			if (stepMs === 0) return [[], false];

			if (argsIN.mode === 'count') {
				const count = Math.max(0, Math.floor(Number(argsIN.count)));
				for (let i = 0; i < count; i++) {
					result.push(new Date(startMs + i * stepMs).toISOString());
				}
			} else {
				const endMs = Number(argsIN.endTime);
				if (stepMs > 0) {
					for (let t = startMs; t <= endMs + stepMs * 1e-9; t += stepMs) {
						result.push(new Date(t).toISOString());
					}
				} else {
					for (let t = startMs; t >= endMs + stepMs * 1e-9; t += stepMs) {
						result.push(new Date(t).toISOString());
					}
				}
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

	function doSequence() {
		[result, p.args.valid] = sequencecolumn(p.args);
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

	<div class="control-input">
		<p>Define end by</p>
		<select bind:value={p.args.mode} onchange={doSequence}>
			<option value="count">Count (N)</option>
			<option value="end">End value</option>
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
				<NumberWithUnits bind:value={p.args.start} onInput={doSequence} step={0.1} />
			</div>
			<div class="control-input">
				<p>Step</p>
				<NumberWithUnits bind:value={p.args.step} onInput={doSequence} step={0.1} />
			</div>
			{#if p.args.mode === 'count'}
				<div class="control-input">
					<p>Count (N)</p>
					<NumberWithUnits bind:value={p.args.count} onInput={doSequence} min={0} step={1} />
				</div>
			{:else}
				<div class="control-input">
					<p>End</p>
					<NumberWithUnits bind:value={p.args.end} onInput={doSequence} step={0.1} />
				</div>
			{/if}
		</div>
	{:else}
		<div class="control-input-vertical">
			<div class="control-input">
				<p>Start time</p>
				<DateTimeHrs bind:value={p.args.startTime} onChange={doSequence} />
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
						onInput={doSequence}
						selectedUnitStart="hrs"
					/>
				</div>
			</div>
			{#if p.args.mode === 'count'}
				<div class="control-input">
					<p>Count (N)</p>
					<NumberWithUnits bind:value={p.args.count} onInput={doSequence} min={0} step={1} />
				</div>
			{:else}
				<div class="control-input">
					<p>End time</p>
					<DateTimeHrs bind:value={p.args.endTime} onChange={doSequence} />
				</div>
			{/if}
		</div>
	{/if}
</div>

{#if p.args.valid && p.args.out.result === -1}
	<p>Preview ({result.length} values):</p>
	<div style="height:250px; overflow:auto;"><Table headers={['Result']} data={[result]} /></div>
{:else if p.args.out.result > 0}
	<div class="section-row">
		<div class="tableProcess-label">
			<span>Output ({result?.length ?? 0} values)</span>
		</div>
	</div>
	<ColumnComponent col={getColumnById(p.args.out.result)} />
{:else}
	<p>Need to have valid inputs to create columns.</p>
{/if}
