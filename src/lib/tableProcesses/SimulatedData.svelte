<script module>
	export const simulateddata_defaults = new Map([
		['startTime', { val: new Date().toISOString().slice(0, 16) }],
		['N_hours', { val: 4 * 24 }],
		['samplingPeriod_hours', { val: 0.25 }],
		['rhythmPeriod_hours', { val: 24 }],
		['rhythmAmplitude', { val: 100 }],

		['out', { time: { val: -1 }, values: { val: -1 } }], //needed to set upu the output columns
		['valid', { val: false }] //needed for the progress step logic
	]);

	export function simulateddata(argsIN) {
		console.log(argsIN);
		const startTime = argsIN.startTime;
		const N_hours = argsIN.N_hours;
		const samplingPeriod_hours = argsIN.samplingPeriod_hours;
		const rhythmPeriod_hours = argsIN.rhythmPeriod_hours;
		const rhythmAmplitude = argsIN.rhythmAmplitude;
		const timeOUT = argsIN.out.time;
		const valuesOUT = argsIN.out.values;

		let simulatedTime = [];
		let simulatedValues = [];
		for (let i = 0; i < N_hours; i += samplingPeriod_hours) {
			simulatedTime.push(new Date(new Date(startTime).getTime() + i * 3600000).toISOString());
			const amplitude =
				Math.floor(i % rhythmPeriod_hours) < rhythmPeriod_hours / 2 ? rhythmAmplitude : 1;
			const value = Math.random() * amplitude;
			simulatedValues.push(value);
		}

		if (timeOUT == -1 || valuesOUT == -1) {
			//this is just for preview, when no column is made
		} else {
			//this is for making and updating; set everything for the given columns
			getColumnById(timeOUT).data = simulatedTime;
			getColumnById(timeOUT).type = 'time';
			getColumnById(timeOUT).timeFormat = "YYYY-MM-DD'T'HH:mm:ss.S'Z'";

			getColumnById(valuesOUT).data = simulatedValues;
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
	import ColumnComponent from '$lib/core/Column.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	import { onMount } from 'svelte';

	let { p = $bindable() } = $props();

	let simulatedTime = $state();
	let simulatedValues = $state();

	function doSimulated() {
		[simulatedTime, simulatedValues, p.args.valid] = simulateddata(p.args);
	}
	onMount(() => {
		//needed to get the values when it first mounts
		doSimulated();
	});
</script>

<p>Start time: <input type="datetime-local" bind:value={p.args.startTime} /></p>
<p>
	Duration: <NumberWithUnits
		bind:value={p.args.N_hours}
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
</p>
<p>
	Sampling period: <NumberWithUnits
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
</p>

<p>
	Rhythm period: <NumberWithUnits
		bind:value={p.args.rhythmPeriod_hours}
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
</p>
<p>
	Rhythm amplitude: <NumberWithUnits
		bind:value={p.args.rhythmAmplitude}
		min="10"
		max="1000"
		step="1"
		onInput={doSimulated}
	/>
</p>
<p>Output:</p>
{#key simulatedValues}
	{#if p.args.valid && p.args.out.time != -1 && p.args.out.values != -1}
		{@const timeOut = getColumnById(p.args.out.time)}
		<ColumnComponent col={timeOut} />
		{@const yout = getColumnById(p.args.out.values)}
		<ColumnComponent col={yout} />
	{:else if p.args.valid}
		<p>Preview:</p>
		<p>N = {Math.floor(p.args.N_hours / p.args.samplingPeriod_hours)}</p>
		<p>X: {simulatedTime.slice(0, 5)}</p>
		<p>Y: {simulatedValues.slice(0, 5).map((y) => y.toFixed(2))}</p>
	{:else}
		<p>Need to have valid inputs to create columns.</p>
	{/if}
{/key}
