<!-- +page.svelte -->

<script>
	// import { version } from "../../package.json";
	import '../app.css';
	import Navbar from '$lib/components/Navbar.svelte';
	import ViewDisplay from '../lib/components/ViewDisplay.svelte';
	import { loadProcesses } from '$lib/processes/processMap.js';
	import { loadPlots } from '$lib/plots/plotMap.js';
	import { core, appConsts } from '$lib/core/theCore.svelte.js';
	import { Column } from '$lib/core/Column.svelte';
	import { Table } from '$lib/core/Table.svelte';
	import Plotcomponent, { Plot } from '$lib/core/Plot.svelte';
	import { onMount } from 'svelte';
	import Visualise from '$lib/components/Visualise.svelte';
	import ColourPicker from '$lib/components/ColourPicker.svelte';

	import { testjson } from '$lib/test.svelte.js';
	import DoubleRange from '$lib/components/inputs/DoubleRange.svelte';

	function addData(dataIN, type, name, provenance) {
		let newDataEntry;
		if (dataIN != null) {
			newDataEntry = new Column({ type, rawData: dataIN, name, provenance });
			if (type == 'time') {
				newDataEntry.timeformat = 1;
			}
			core.data.push(newDataEntry);
		} else {
			newDataEntry = new Column({
				type,
				rawData: [
					Math.round(10 * Math.random()),
					Math.round(10 * Math.random()),
					Math.round(10 * Math.random()),
					Math.round(10 * Math.random())
				],
				name,
				provenance
			});
			if (type == 'time') {
				newDataEntry.timeformat = 1;
			}
			core.data.push(newDataEntry);
		}
		return newDataEntry.columnID;
	}

	onMount(async () => {
		//load the maps
		appConsts.processMap = await loadProcesses();
		appConsts.plotMap = await loadPlots();
		refresh();
	});

	function makeArray(from, to, step) {
		let out = [];
		for (let i = from; i <= to; i += step) {
			out.push(i);
		}
		return out;
	}
	function makeRandom(N) {
		let out = [];
		for (let i = 0; i < N; i++) {
			out.push(Math.round(Math.random() * 10));
		}
		return out;
	}
	function makeRhythmic(N, period, low = 10, high = 100) {
		let out = [];
		for (let i = 0; i < N; i++) {
			const mult = i % period < period / 2 ? low : high;
			out.push(Math.round(Math.random() * mult));
		}
		return out;
	}

	function refresh() {
		//simulate importing data
		core.data = [];
		let d0id = addData(
			makeArray(5.15, 1_005 * 0.15, 0.15),
			'time',
			'the time',
			'just made this up'
		);
		core.data[0].addProcess('Add');

		let d1id = addData(makeRhythmic(1_000, 24 / 0.15), 'number', 'val1', 'imported from thin air');
		core.data[1].addProcess('Add');
		core.data[1].addProcess('Sub');

		let d2id = addData(['a', 'b', 'b', 'c'], 'category', 'mycat', 'imported from Egypt');

		let testawd = new Column({
			type: 'time',
			rawData: { start: 10, step: 1, length: 5 },
			compression: 'awd',
			name: 'AWD',
			timeformat: 3,
			provenance: 'another manufactured column'
		});
		core.data.push(testawd);

		let testref = new Column({
			refDataID: d1id
		});
		core.data.push(testref);

		let testrefref = new Column({
			refDataID: testref.columnID
		});
		core.data.push(testrefref);

		core.tables = [];
		core.tables.push(new Table({ name: 'table 1' }));
		core.tables[0].columnRefs = [
			testawd.columnID,
			d1id,
			d0id,
			testref.columnID,
			testrefref.columnID
		];
		core.tables.push(new Table({ name: 'table 2' }));
		core.tables[1].columnRefs = [d1id, d2id]; //Do we want to be able to have the same data in more than one table? Might need to ensure this doesn't happen.

		core.plots = [];
		core.plots.push(new Plot({ name: 'testscatter', type: 'scatterplot' }));
		core.plots[0].plot.addData({
			x: { refDataID: 0 },
			y: { refDataID: 1 }
		});
		core.plots.push(new Plot({ name: 'an actogram', type: 'actogram' }));
		core.plots[1].x = 300;
		core.plots[1].y = 400;
		core.plots[1].height = 700;
		core.plots[1].plot.addData({
			x: { refDataID: 0 },
			y: { refDataID: 1 }
		});
	}

	function load() {
		const jsonData = JSON.parse(`${testjson}`);

		//reset things
		core.data = [];
		core.tables = [];
		core.plots = [];

		//load in the data
		jsonData.data.map((datajson) => {
			core.data.push(Column.fromJSON(datajson));
		});
		//Set up the tables
		jsonData.tables.map((tablejson) => {
			core.tables.push(Table.fromJSON(tablejson));
		});
		//Make the plots
		jsonData.plots.map((plotjson) => {
			core.plots.push(Plot.fromJSON(plotjson));
		});
	}
</script>

<!-- <svelte:head>
  <title>AnCiR v β.{version}</title>
</svelte:head> 
-->

<Navbar />
<ViewDisplay />
<div style="position:absolute; top:0; left:30px; z-index:1000; background:blue;">
	<button onclick={() => console.log(core)}>printJSON</button>
	<button onclick={() => refresh()}>Refresh</button>
	<button onclick={() => load()}>Load</button>
</div>

<div style="position:absolute; top:0; right:300px; z-index:1000; border:1px solid black;">
	<ColourPicker />
</div>
<div style="position:absolute; top:0; right:270px; z-index:1000; border:1px solid black;">
	<ColourPicker />
</div>
<div
	style="position:absolute; top:100; right:170px; z-index:1000; border:1px solid black; background:white;"
>
	<DoubleRange />
</div>
{#each core.plots as plot}
	<Plotcomponent {plot} />
{/each}

<!--
<p>Data:</p>
<button onclick={() => load()}>load</button>
<button onclick={() => refresh()}>Refresh</button>

<div>
	<button onclick={() => core.tables.push(new Table({ name: 'table ' + (core.tables.length + 1) }))}
		>New table</button
	>
	{#each core.tables as table}
		<p><strong>{table.name}</strong></p>
		<button
			onclick={() => {
				const tempid = addData([Math.random(), Math.random()], 'number');
				table.addColumn(tempid);
			}}>add Data</button
		>
		{#each table.columnRefs as col, colidx}
			{#each core.data as dat}
				{#if dat.columnID == col}
					<p>
						{dat.columnID} <input bind:value={dat.name} /> : {JSON.stringify(dat.getData())}
						type:
						<select name="datatype" bind:value={dat.type}>
							<option value="time">Time</option>
							<option value="number">Number</option>
							<option value="category">Category</option>
						</select>
						<button onclick={() => table.removeColumn(colidx)}>-</button>
						<button
							onclick={() => {
								core.data = core.data.filter((d) => d.columnID !== dat.columnID);
							}}>!-!</button
						>
					</p>
					<button onclick={() => dat.addProcess(Math.random() > 0.5 ? 'add' : 'sub')}
						>add Process</button
					>
					{#if dat.type == 'time'}
						<br />
						Time format:
						<input type="number" bind:value={dat.timeformat} />
					{/if}

					{#each dat.processes as p}
						<div>
							{p.id}
							{p.name} -
							{#each Object.keys(p.args) as arg}
								{arg} ({dat.getProcessArgType(p.name, arg)}):
								
								{#if dat.getProcessArgType(p.name, arg) === 'number'}
									<input type="number" bind:value={p.args[arg]} />
								{:else if dat.getProcessArgType(p.name, arg) === 'category'}
									<input type="text" bind:value={p.args[arg]} />
								{/if}
							{/each}
							<button onclick={() => dat.removeProcess(p.processid)}>-</button>
						</div>
					{/each}
					<hr />
				{/if}
			{/each}
		{/each}
	{/each}
</div>

<PlotHandler />

<Visualise />

<pre>{JSON.stringify(core, null, 2)}</pre>

<style>
	section {
		padding: 8px;
		margin: 4px 0;
		border: 1px solid #ccc;
		background: grey;
	}
</style>
-->
