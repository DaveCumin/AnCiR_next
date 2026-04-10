<script module>
	import { DateTime } from 'luxon';

	import { core } from '$lib/core/core.svelte';

	export const simulateddata_displayName = 'Simulate Data';
	export const simulateddata_defaults = new Map([
		['startTime', { val: DateTime.fromISO(new Date().toISOString(), { zone: 'utc' }).toMillis() }],
		[
			'sections',
			{
				val: [
					{
						duration_hours: 4 * 24,
						rhythmPeriod_hours: 24,
						rhythmPhase_hours: 0,
						rhythmAmplitude: 100
					}
				]
			}
		],
		['samplingPeriod_hours', { val: 0.25 }],

		['out', { time: { val: -1 }, values: { val: -1 } }],
		['valid', { val: false }]
	]);

	export function simulateddata(argsIN) {
		const startTime = argsIN.startTime;
		const sections = argsIN.sections;
		const samplingPeriod_hours = argsIN.samplingPeriod_hours;
		const timeOUT = argsIN.out.time;
		const valuesOUT = argsIN.out.values;

		let simulatedTime = [];
		let simulatedValues = [];
		let currentTime = 0;

		for (const section of sections) {
			const duration = section.duration_hours;
			const period = section.rhythmPeriod_hours;
			const phase = section.rhythmPhase_hours || 0;
			const amplitude = section.rhythmAmplitude;

			for (let i = 0; i < duration; i += samplingPeriod_hours) {
				simulatedTime.push(
					new Date(new Date(startTime).getTime() + (currentTime + i) * 3600000).toISOString()
				);

				// Apply phase shift to the rhythm calculation
				const phaseShiftedTime = i + phase;
				const currentAmplitude = Math.floor(phaseShiftedTime % period) < period / 2 ? amplitude : 1;
				const value = Math.random() * currentAmplitude;
				simulatedValues.push(value);
			}
			currentTime += duration;
		}

		if (timeOUT == -1 || valuesOUT == -1) {
			//this is just for preview, when no column is made
		} else {
			//this is for making and updating; set everything for the given columns

			core.rawData.set(timeOUT, simulatedTime);
			getColumnById(timeOUT).data = timeOUT;
			getColumnById(timeOUT).type = 'time';
			getColumnById(timeOUT).timeFormat = "YYYY-MM-DD'T'HH:mm:ss.S'Z'";

			core.rawData.set(valuesOUT, simulatedValues);
			getColumnById(valuesOUT).data = valuesOUT;
			getColumnById(valuesOUT).type = 'number';

			//update for reactivity
			const processHash = crypto.randomUUID();
			getColumnById(timeOUT).tableProcessGUId = processHash;
			getColumnById(valuesOUT).tableProcessGUId = processHash;
		}

		return [simulatedTime, simulatedValues, simulatedValues.length > 0];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';

	import { getColumnById } from '$lib/core/Column.svelte';
	import { formatTimeFromISO } from '$lib/utils/time/TimeUtils.js';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	import { onMount } from 'svelte';
	import DateTimeHrs from '$lib/components/inputs/DateTimeHrs.svelte';

	let { p = $bindable() } = $props();

	let simulatedTime = $state();
	let simulatedValues = $state();
	let previewStart = $state(1);

	function doSimulated() {
		previewStart = 1;
		[simulatedTime, simulatedValues, p.args.valid] = simulateddata(p.args);
	}

	function addSection() {
		p.args.sections = [
			...p.args.sections,
			{
				duration_hours: 7 * 24,
				rhythmPeriod_hours: 24,
				rhythmPhase_hours: 0,
				rhythmAmplitude: 100
			}
		];
		doSimulated();
	}

	function removeSection(index) {
		p.args.sections = p.args.sections.filter((_, i) => i !== index);
		doSimulated();
	}

	onMount(() => {
		//If data already exists (e.g. imported from JSON), use it instead of regenerating
		const timeKey = p.args.out.time;
		const valKey = p.args.out.values;
		if (timeKey >= 0 && valKey >= 0 && core.rawData.has(timeKey) && core.rawData.get(timeKey).length > 0) {
			simulatedTime = core.rawData.get(timeKey);
			simulatedValues = core.rawData.get(valKey);
			p.args.valid = simulatedValues.length > 0;
		} else {
			doSimulated();
		}
	});
</script>

<div class="section-row">
	<div class="tableProcess-label">
		<span>Simulation settings</span>
	</div>

	<div class="control-input">
		<p>Start time</p>
		<DateTimeHrs bind:value={p.args.startTime} onChange={doSimulated} />
	</div>

	<div class="control-input">
		<p>Sampling period</p>
		<div style="display:flex;">
			<NumberWithUnits
				bind:value={p.args.samplingPeriod_hours}
				min="0.01"
				step="0.01"
				max={50}
				units={{
					default: 'hrs',
					days: 24,
					hrs: 1,
					mins: 1 / 60,
					secs: 1 / (60 * 60)
				}}
				onInput={doSimulated}
				selectedUnitStart="mins"
			/>
		</div>
	</div>
</div>

{#each p.args.sections as section, index}
	<div
		class="section-row"
		style="border-left: 3px solid #ccc; padding-left: 10px; margin-bottom: 10px;"
	>
		<div style="display: flex; justify-content: space-between; align-items: center;">
			<strong>Section {index + 1}</strong>
			{#if p.args.sections.length > 1}
				<button onclick={() => removeSection(index)} style="color: red;">Remove</button>
			{/if}
		</div>

		<div class="control-input">
			<p>Duration</p>
			<div style="display:flex;">
				<NumberWithUnits
					bind:value={section.duration_hours}
					min="0.1"
					step="0.1"
					max={1000 * 24}
					units={{
						default: 'hrs',
						days: 24,
						hrs: 1,
						mins: 1 / 60,
						secs: 1 / (60 * 60)
					}}
					onInput={doSimulated}
					selectedUnitStart="days"
				/>
			</div>
		</div>

		<div class="control-input">
			<p>Rhythm period</p>
			<div style="display:flex;">
				<NumberWithUnits
					bind:value={section.rhythmPeriod_hours}
					min="0.1"
					step="0.1"
					max={50}
					units={{
						default: 'hrs',
						days: 24,
						hrs: 1,
						mins: 1 / 60,
						secs: 1 / (60 * 60)
					}}
					onInput={doSimulated}
				/>
			</div>
		</div>

		<div class="control-input">
			<p>Rhythm phase shift</p>
			<div style="display:flex;">
				<NumberWithUnits
					bind:value={section.rhythmPhase_hours}
					min="-50"
					step="0.1"
					max={50}
					units={{
						default: 'hrs',
						days: 24,
						hrs: 1,
						mins: 1 / 60,
						secs: 1 / (60 * 60)
					}}
					onInput={doSimulated}
				/>
			</div>
		</div>

		<div class="control-input">
			<p>Rhythm amplitude</p>
			<div style="display:flex;">
				<NumberWithUnits
					bind:value={section.rhythmAmplitude}
					min="10"
					max="1000"
					step="1"
					onInput={doSimulated}
				/>
			</div>
		</div>
	</div>
{/each}

<div class="section-row">
	<div class="tableProcess-label">
		<span>Data sections</span>
		<button onclick={addSection} style="margin-left: 10px;">+ Add Section</button>
	</div>
</div>

{#key simulatedValues}
	{#if p.args.valid && p.args.out.time != -1 && p.args.out.values != -1}
		<div class="section-row">
			<div class="tableProcess-label">
				<span>Output</span>
			</div>
		</div>
		{@const timeOut = getColumnById(p.args.out.time)}
		<ColumnComponent col={timeOut} />
		{@const yout = getColumnById(p.args.out.values)}
		<ColumnComponent col={yout} />
	{:else if p.args.valid}
		{@const totalRows = simulatedTime.length}
		<p>Preview:</p>
		<p>
			N = {totalRows} samples across {p.args.sections.length} section{p.args.sections.length > 1
				? 's'
				: ''}
		</p>
		<Table
			headers={['Time', 'Data']}
			data={[
				simulatedTime.slice(previewStart - 1, previewStart + 5).map((v) => ({
					isTime: true,
					raw: formatTimeFromISO(v),
					computed: ((new Date(v).getTime() - p.args.startTime) / 3600000).toFixed(2)
				})),
				simulatedValues.slice(previewStart - 1, previewStart + 5).map((y) => y.toFixed(2))
			]}
		/>
		<p>Row <NumberWithUnits min={1} max={Math.max(1, totalRows - 5)} step={1} bind:value={previewStart} /> to {Math.min(previewStart + 5, totalRows)} of {totalRows}</p>
	{:else}
		<p>Need to have valid inputs to create columns.</p>
	{/if}
{/key}
