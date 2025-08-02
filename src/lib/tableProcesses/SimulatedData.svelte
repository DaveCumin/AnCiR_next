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
</script>

<script>
	import ColumnComponent from '$lib/core/Column.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	import { onMount } from 'svelte';

	let { p = $bindable() } = $props();

	let simulatedTime = $state([]);
	let simulatedValues = $state([]);

	function makeSimulatedData() {
		const startTime = p.args.startTime;
		const N_hours = p.args.N_hours;
		const samplingPeriod_hours = p.args.samplingPeriod_hours;
		const rhythmPeriod_hours = p.args.rhythmPeriod_hours;
		const rhythmAmplitude = p.args.rhythmAmplitude;
		const timeOUT = p.args.out.time;
		const valuesOUT = p.args.out.values;

		simulatedTime = [];
		simulatedValues = [];
		for (let i = 0; i < N_hours; i += samplingPeriod_hours) {
			simulatedTime.push(new Date(new Date(startTime).getTime() + i * 3600000).toISOString());
			const amplitude =
				Math.floor(i % rhythmPeriod_hours) < rhythmPeriod_hours / 2 ? rhythmAmplitude : 1;
			const value = Math.random() * amplitude;
			simulatedValues.push(value);
		}

		if (timeOUT == -1 || valuesOUT == -1) {
		} else {
			getColumnById(timeOUT).data = simulatedTime;
			getColumnById(timeOUT).timeFormat = "YYYY-MM-DD'T'HH:mm:ss.S'Z'";
			getColumnById(timeOUT).type = 'time';
			getColumnById(valuesOUT).data = simulatedValues;
			const processHash = crypto.randomUUID();
			getColumnById(timeOUT).tableProcessGUId = processHash;
			getColumnById(valuesOUT).tableProcessGUId = processHash;
		}
		if (simulatedValues.length > 0) {
			p.args.valid = true;
		} else {
			p.args.valid = false;
		}
	}

	//TODO: something strange when this is mounted - there is an "Uncaught RangeError: Maximum call stack size exceeded" error in $effect (I don't know why ;( )
	onMount(() => {
		//needed to get the values when it first mounts
		makeSimulatedData();
	});
</script>

<p>Start time: <input type="datetime-local" bind:value={p.args.startTime} /></p>
<p>
	Duration: <NumberWithUnits
		bind:value={p.args.N_hours}
		min="0.1"
		step="0.1"
		max={1000 * 24}
		onInput={makeSimulatedData}
		selectedUnitStart="day"
	/>
</p>
<p>
	Sampling period: <NumberWithUnits
		bind:value={p.args.samplingPeriod_hours}
		min="0.01"
		step="0.01"
		max={50}
		onInput={makeSimulatedData}
		selectedUnitStart="min"
	/>
</p>

<p>
	Rhythm period: <NumberWithUnits
		bind:value={p.args.rhythmPeriod_hours}
		min="0.1"
		step="0.1"
		max={50}
		onInput={makeSimulatedData}
	/>
</p>
<p>
	Rhythm amplitude: <NumberWithUnits
		bind:value={p.args.rhythmAmplitude}
		min="10"
		max="1000"
		step="1"
		units={{}}
		onInput={makeSimulatedData}
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
