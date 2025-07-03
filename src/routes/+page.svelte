<!-- +page.svelte -->

<script>
	// @ts-nocheck
	// import { version } from "../../package.json";
	import '../app.css';
	import Navbar from '$lib/components/Navbar.svelte';
	import ViewPanel from '../lib/components/ViewPanel.svelte';
	import ControlPanel from '$lib/components/ControlPanel.svelte';
	import PlotComponent from '$lib/components/PlotComponent.svelte';
	
	import { onMount } from 'svelte';
	
	import { core, pushObj, appConsts } from '$lib/core/core.svelte';
	import { Column } from '$lib/core/column.svelte';
	import { Table } from '$lib/core/table.svelte';
	import { Plot } from '$lib/core/plot.svelte';
	import { Process } from '$lib/core/process.svelte';

	import { loadProcesses } from '$lib/processes/processMap.js';
	import { loadPlots } from '$lib/plots/plotMap.js';

	// Test Initialisation
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
	
	function makeDateTimeArray(N, from = new Date(), step_hrs = 1) {
		let out = [];
		let currentDate = new Date(from);
		for (let i = 0; i < N; i++) {
			out.push(new Date(currentDate));
			currentDate.setHours(currentDate.getHours() + step_hrs);
		}
		//now convert to timestamps
		//out = out.map((d) => d.getTime()); // this makes the UNIX timestamps
		out = out.map((d) => d.toISOString()); // this makes the ISO strings
		return out;
	}

	function loadData() {
		let d0id = addData(
			makeArray(5.15, 1_005 * 0.15, 0.15),
			'time',
			'the time',
			'just made this up'
		);
		core.data[0].addProcess('Add');
		core.data[0].addProcess('FilterByOtherCol');

		let d1id = addData(makeRhythmic(1_000, 24 / 0.15), 'number', 'val1', 'imported from thin air');
		core.data[1].addProcess('Add');
		core.data[1].addProcess('Sub');

		let d2id = addData(['a', 'b', 'b', 'c'], 'category', 'mycat', 'imported from Egypt');

		let testawd = new Column({
			type: 'time',
			data: { start: 10, step: 1, length: 5 },
			compression: 'awd',
			name: 'AWD',
			timeFormat: 3,
			provenance: 'another manufactured column'
		});
		core.data.push(testawd);

		let testref = new Column({
			redId: d1id
		});
		core.data.push(testref);

		let testrefref = new Column({
			redId: testref.columnID
		});
		core.data.push(testrefref);

		let testtimestring = addData(makeDateTimeArray(), 'time', 'REALTIME', 'Just made up');

		core.tables = [];
		core.tables.push(new Table({ name: 'table 1' }));
		core.tables[0].columnRefs = [
			testtimestring,
			testawd.id,
			d1id,
			d0id,
			testref.id,
			testrefref.id
		];
		core.tables.push(new Table({ name: 'table 2' }));
		core.tables[1].columnRefs = [d1id, d2id]; //Do we want to be able to have the same data in more than one table? Might need to ensure this doesn't happen.


		// Actogram
		core.plots.push(new Plot({ name: 'an actogram', type: 'actogram' }));
		core.plots[1].x = 300;
		core.plots[1].y = 400;
		core.plots[1].height = 700;
		core.plots[1].plot.addData({
			x: { refDataID: 0 },
			y: { refDataID: 1 }
		});
	}

	onMount(async () => {
		appConsts.processMap = await loadProcesses();
		appConsts.plotMap = await loadPlots();
		// loadData();
	});
	

</script>

<!-- <svelte:head>
  <title>AnCiR v β.{version}</title>
</svelte:head> 
-->

<Navbar />
<ViewPanel />
<ControlPanel />

<PlotComponent />




<style>
	:global(body) {
		font-family: 'Inter', sans-serif;
		font-size: 14px;
	}

	/* :global(p) {
		font-family: 'Inter', sans-serif;
		font-size: 14px;
	} */

	:global(button) {
		font-family: 'Inter', sans-serif;
		font-size: 14px;
	}

	:global(.card) {
		font-family: 'Inter', sans-serif;
		font-size: 14px;
	}
	
</style>


