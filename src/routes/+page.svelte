<!-- +page.svelte -->

<script>
	// import { version } from "../../package.json";
	import '../app.css';
	import Navbar from '$lib/components/Navbar.svelte';
	import ViewDisplay from '../lib/components/ViewDisplay.svelte';

	import { core } from '$lib/core/theCore.svelte.js';
	import { Column } from '$lib/core/Column.svelte';
	import { Table } from '$lib/core/Table.svelte';
	import { Plot } from '$lib/core/Plot.svelte';
	import { onMount } from 'svelte';
	import Visualise from '$lib/components/Visualise.svelte';

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
					Math.round(10 * Math.random(), 2),
					Math.round(10 * Math.random(), 2),
					Math.round(10 * Math.random(), 2),
					Math.round(10 * Math.random(), 2)
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
		refresh();
	});

	function refresh() {
		//simulate importing data
		core.data = [];
		let d0id = addData([1, 2, 3, 4], 'time', 'the time', 'just made this up');
		core.data[0].addProcess('Add');

		let d1id = addData(null, 'number', 'val1', 'imported from thin air');
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
		core.plots.push(new Plot({ name: 'test scatterplot', type: 'Scatterplot' }));
	}

	function load() {
		const jsonData = JSON.parse(
			`{"tables":[{"tableid":0,"name":"table 1","columnRefs":[3,1,0]},{"tableid":1,"name":"table 2","columnRefs":[1,2]},{"tableid":2,"name":"table 3","columnRefs":[4,5]}],"plots":[{"plotid":0,"name":"test","type":"Scatterplot","plot":{"width":300,"height":100,"data":[{"x":{"columnID":6,"name":"val1","refDataID":1,"type":"number","processes":[]},"y":{"columnID":7,"name":"the time","refDataID":0,"type":"time","processes":[]}},{"x":{"columnID":8,"name":"AWD","refDataID":3,"type":"time","processes":[]},"y":{"columnID":9,"refDataID":4,"type":"number","processes":[]}}]}}],"data":[{"columnID":0,"name":"the time","rawData":[1,2,3,4],"type":"time","timeformat":1,"processes":[{"processid":0,"name":"Add","args":{"value":4}}]},{"columnID":1,"name":"val1","rawData":[0,10,8,2],"type":"number","processes":[{"processid":1,"name":"Add","args":{"value":4}},{"processid":2,"name":"Sub","args":{"find":0,"replace":0}}]},{"columnID":2,"name":"mycat","rawData":["a","b","b","c"],"type":"category","processes":[]},{"columnID":3,"name":"AWD","rawData":{"start":10,"step":1,"length":5},"type":"time","timeformat":3,"compression":"awd","processes":[]},{"columnID":4,"rawData":[0.5320851666862695,0.08923008150735368],"type":"number","processes":[]},{"columnID":5,"rawData":[0.9092213365565878,0.7247559800547119],"type":"number","processes":[]}]}`
		);

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
-->
<style>
	section {
		padding: 8px;
		margin: 4px 0;
		border: 1px solid #ccc;
		background: grey;
	}
</style>
