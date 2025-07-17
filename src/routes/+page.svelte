<!-- +page.svelte -->

<script>
	// @ts-nocheck
	// import { version } from "../../package.json";
	import '../app.css';
	import Navbar from '$lib/components/Navbar.svelte';
	import DisplayPanel from '$lib/components/DisplayPanel.svelte';
	import ControlPanel from '$lib/components/ControlPanel.svelte';
	import PlotPanel from '$lib/components/PlotPanel.svelte';
	import PlotDisplay from '$lib/components/views/PlotDisplay.svelte';

	import { loadProcesses } from '$lib/processes/processMap.js';
	import { loadPlots } from '$lib/plots/plotMap.js';

	import { onMount } from 'svelte';
	import { testJson } from './testJson.svelte.js';
	import { testJsonDC } from './testJsonDC.svelte';

	import { core, pushObj, appConsts, appState, snapToGrid } from '$lib/core/core.svelte';
	import { Column } from '$lib/core/Column.svelte';
	import { Table } from '$lib/core/table.svelte';
	import { Plot } from '$lib/core/Plot.svelte';
	import { Process } from '$lib/core/Process.svelte';
	import { TableProcess } from '$lib/core/tableProcess.svelte';

	// import { testjson } from '$lib/test.svelte.js';

	import { guessFormatD3 } from '$lib/utils/time/guessTimeFormat_d3.js';
	import { guessFormat } from '$lib/utils/time/guessTimeFormat.js';

	const timesToTest = ['2025/10/01', '2025/12/01', '2025/13/01'];
	console.log('times to test: ', timesToTest);
	console.log('d3 guess: ', guessFormatD3(timesToTest));
	console.log('guess: ', guessFormat(timesToTest[0]));
	import { timeParse, utcParse } from 'd3-time-format';
	import { faL } from '@fortawesome/free-solid-svg-icons';
	console.log(
		'parse: ',
		timeParse('%Y/%m/%d')(timesToTest[0]),
		timeParse('%Y/%m/%d')(timesToTest[1]),
		timeParse('%Y/%m/%d')(timesToTest[2])
	);

	const timesToTest2 = [
		'2025-04-06T02:45:29.833Z',
		'2025-04-06T04:45:29.833Z',
		'2025-04-06T06:45:29.833Z'
	];
	console.log('times to test: ', timesToTest2);
	console.log('d3 guess: ', guessFormatD3(timesToTest2));
	console.log('guess: ', guessFormat(timesToTest2[0]));

	console.log(
		'parse: ',
		timeParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[0]),
		timeParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[1]),
		timeParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[2])
	);
	console.log(
		'parse: ',
		Number(timeParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[0])),
		Number(timeParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[1])),
		Number(timeParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[2]))
	);
	console.log(
		'parse utc: ',
		Number(utcParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[0])),
		Number(utcParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[1])),
		Number(utcParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[2]))
	);

	document.addEventListener('keydown', (event) => {
		// Check if Ctrl, Shift, and 'I' are pressed simultaneously
		if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'i') {
			event.preventDefault(); // Prevent default browser behavior (e.g., opening developer tools)
			console.log($state.snapshot(core));
		}
	});

	//------------------------------------
	const N = 1_000;
	//------------------------------------

	onMount(async () => {
		//load the maps
		appConsts.processMap = await loadProcesses();
		appConsts.plotMap = await loadPlots();

		populatePanelWidth();
		refresh();
		// loadTestJson();
	});

	function populatePanelWidth() {
		appState.positionDisplayPanel = 360 + appState.positionNavbar;
		appState.positionControlPanel = window.innerWidth - 360;
	}

	function loadTestJson() {
		// const jsonData = JSON.parse(`${testJson}`);
		const jsonData = JSON.parse(`${testJsonDC}`);

		//reset things
		core.data = [];
		core.tables = [];
		core.plots = [];

		jsonData.data.map((datajson) => {
			core.data.push(Column.fromJSON(datajson));
		});

		jsonData.tables.map((tablejson) => {
			core.tables.push(Table.fromJSON(tablejson));
		});

		jsonData.plots.map((plotjson) => {
			core.plots.push(Plot.fromJSON(plotjson));
		});
	}

	function addData(dataIN, type, name, provenance) {
		let newDataEntry;
		if (dataIN != null) {
			newDataEntry = new Column({ type, data: dataIN, name, provenance });
			if (type == 'time') {
				newDataEntry.timeFormat = '';
			}
			core.data.push(newDataEntry);
		} else {
			newDataEntry = new Column({
				type,
				data: [
					Math.round(10 * Math.random()),
					Math.round(10 * Math.random()),
					Math.round(10 * Math.random()),
					Math.round(10 * Math.random())
				],
				name,
				provenance
			});
			if (type == 'time') {
				newDataEntry.timeFormat = 1;
			}
			core.data.push(newDataEntry);
		}
		return newDataEntry.id;
	}

	function makeArray(N, from, step) {
		let out = [];
		for (let i = 0; i < N; i++) {
			out.push(from + i * step);
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
		for (let i = 0; i < N; i++) {
			out.push(new Date(Number(from) + i * step_hrs * 3600000)); //step_hrs is in hours, so convert to milliseconds
		}
		//now convert to timestamps
		//out = out.map((d) => d.getTime()); // this makes the UNIX timestamps
		out = out.map((d) => d.toISOString()); // this makes the ISO strings
		return out;
	}

	function refresh() {
		//simulate importing data
		core.data = [];
		let d0id = addData(makeArray(N, 5, 0.15), 'number', 'the time', 'just made this up');
		core.data[0].addProcess('Add');

		let d1id = addData(makeRhythmic(N, 24 / 0.15), 'number', 'val1', 'imported from thin air');
		core.data[1].addProcess('Add');
		core.data[1].addProcess('Sub');

		let d2id = addData(['a', 'b', 'b', 'c'], 'category', 'mycat', 'imported from Egypt');

		let testawd = new Column({
			type: 'number',
			data: { start: 10, step: 1, length: 5 },
			compression: 'awd',
			name: 'AWD',
			timeFormat: 3,
			provenance: 'another manufactured column'
		});
		core.data.push(testawd);

		let testref = new Column({
			refId: d1id
		});
		core.data.push(testref);

		let testrefref = new Column({
			refId: testref.id
		});
		core.data.push(testrefref);

		let testtimestring = addData(
			makeDateTimeArray(N, new Date(), 0.15),
			'time',
			'REALTIME',
			'Just made up'
		); //yyyy-LL-dd'T'HH:mm:ss.S'Z'
		core.data[core.data.length - 1].timeformat = '%Y-%m-%dT%H:%M:%S.%L%Z';

		core.tables = [];
		core.tables.push(new Table({ name: 'table 1' }));
		core.tables[0].columnRefs = [testtimestring, testawd.id, d1id, d0id, testref.id, testrefref.id];
		core.tables.push(new Table({ name: 'table 2' }));
		core.tables[1].columnRefs = [d1id, d2id]; //Do we want to be able to have the same data in more than one table? Might need to ensure this doesn't happen.
		core.tables[1].processes.push(
			new TableProcess(
				{
					name: 'binneddata',
					args: {
						xIN: 0,
						yIN: 1,
						binSize: 0.25,
						binStart: 0,
						xOUT: -1,
						yOUT: -1
					}
				},
				core.tables[1]
			)
		);

		core.plots = [];
		//Scatter plot
		pushObj(new Plot({ name: 'testscatter', type: 'scatterplot' }));
		core.plots[0].plot.addData({
			x: { refId: core.data[0].id },
			y: { refId: core.data[1].id }
		});
		// //Actogram
		pushObj(new Plot({ name: 'an actogram', type: 'actogram' }));
		core.plots[core.plots.length - 1].height = snapToGrid(700);
		core.plots[core.plots.length - 1].plot.addData({
			x: { refId: core.data[0].id },
			y: { refId: core.data[1].id }
		});
		//Periodogram
		pushObj(new Plot({ name: 'a periodogram', type: 'periodogram' }));
		core.plots[core.plots.length - 1].plot.addData({
			x: { refId: core.data[0].id },
			y: { refId: core.data[1].id }
		});

		// console.log('ALL SET UP: ', $state.snapshot(core));
	}

	// TODO: Key Handling accessibility, e.g. ctrl+i == import

</script>

<!-- <svelte:head>
  <title>AnCiR v β.{version}</title>
</svelte:head> 
-->

{#if appState.showNavbar}
	<Navbar />
{/if}

{#if appState.showDisplayPanel}
	<DisplayPanel />
{/if}

{#if appState.showControlPanel}
	<ControlPanel />
{/if}

<PlotDisplay />

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

	/* resizer style */
	:global(.resizer) {
		width: 4px;
		cursor: col-resize;
		height: 100%;
		position: absolute;
		top: 0;
		right: 0;
		background-color: transparent;
	}

	:global(.resizer:hover) {
		background-color: var(--color-hover);
	}

	/* button style */
	:global(.dialog-button-container) {
		display: flex;
		justify-content: flex-end;
	}

	:global(button.dialog-button) {
		margin-top: 10px;
		background-color: var(--color-lightness-95);
		border-radius: 4px;
		padding: 10px;
		padding-right: 12px;

		font-size: 14px;
		text-align: center;
	}

	:global(button.dialog-button:hover) {
		background-color: var(--color-hover);
	}
</style>
