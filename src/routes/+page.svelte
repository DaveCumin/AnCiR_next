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

	import AreYouSure from '$lib/components/views/modals/AreYouSure.svelte';

	import { loadProcesses } from '$lib/processes/processMap.js';
	import { loadPlots } from '$lib/plots/plotMap.js';
	import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';

	import { onMount } from 'svelte';
	import { testJson } from './testJson.svelte.js';
	import { testJsonDC } from './testJsonDC.svelte';

	import {
		core,
		pushObj,
		appConsts,
		appState,
		snapToGrid,
		outputCoreAsJson
	} from '$lib/core/core.svelte';
	import { Column } from '$lib/core/Column.svelte';
	import { Table } from '$lib/core/Table.svelte';
	import { Plot, selectAllPlots } from '$lib/core/Plot.svelte';
	import { Process } from '$lib/core/Process.svelte';
	import { TableProcess } from '$lib/core/tableProcess.svelte';

	import Icon from '$lib/icons/Icon.svelte';

	// import { testjson } from '$lib/test.svelte.js';

	import { guessFormatD3 } from '$lib/utils/time/guessTimeFormat_d3.js';
	import { guessFormat } from '$lib/utils/time/guessTimeFormat.js';

	let loadingMsg = $state('Warming up...');
	let isLoaded = $state(false);

	// const timesToTest = ['2025/10/01', '2025/12/01', '2025/13/01'];
	// console.log('times to test: ', timesToTest);
	// console.log('d3 guess: ', guessFormatD3(timesToTest));
	// console.log('guess: ', guessFormat(timesToTest[0]));
	// import { timeParse, utcParse } from 'd3-time-format';
	// import { faL } from '@fortawesome/free-solid-svg-icons';
	// console.log(
	// 	'parse: ',
	// 	timeParse('%Y/%m/%d')(timesToTest[0]),
	// 	timeParse('%Y/%m/%d')(timesToTest[1]),
	// 	timeParse('%Y/%m/%d')(timesToTest[2])
	// );

	// const timesToTest2 = [
	// 	'2025-04-06T02:45:29.833Z',
	// 	'2025-04-06T04:45:29.833Z',
	// 	'2025-04-06T06:45:29.833Z'
	// ];
	// console.log('times to test: ', timesToTest2);
	// console.log('d3 guess: ', guessFormatD3(timesToTest2));
	// console.log('guess: ', guessFormat(timesToTest2[0]));

	// console.log(
	// 	'parse: ',
	// 	timeParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[0]),
	// 	timeParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[1]),
	// 	timeParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[2])
	// );
	// console.log(
	// 	'parse: ',
	// 	Number(timeParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[0])),
	// 	Number(timeParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[1])),
	// 	Number(timeParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[2]))
	// );
	// console.log(
	// 	'parse utc: ',
	// 	Number(utcParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[0])),
	// 	Number(utcParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[1])),
	// 	Number(utcParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[2]))
	// );

	//------------------------------------
	const N = 2_000;
	//------------------------------------

	onMount(async () => {
		//load the maps
		loadingMsg = 'Loading processes ...';
		appConsts.processMap = await loadProcesses();
		loadingMsg = 'Loading plots ...';
		appConsts.plotMap = await loadPlots();
		loadingMsg = 'Loading table processes ...';
		appConsts.tableProcessMap = await loadTableProcesses();

		isLoaded = true;

		//add event listeners
		const updateWidth = () => {
			appState.windowWidth = window.innerWidth;
		};
		window.addEventListener('resize', updateWidth);

		document.addEventListener('keydown', (event) => {
			const ISMAC =
				navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
				navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
			const MODIFIER = ISMAC ? event.metaKey : event.ctrlKey;

			// Print out info - DEGUGGING
			if (MODIFIER && event.shiftKey && event.key.toLowerCase() === 'i') {
				event.preventDefault();
				console.log($state.snapshot(core));
				console.log($state.snapshot(appState));
				console.log($state.snapshot(appConsts));
			}
			// Create sample data quickly - FOR TESTING
			if (MODIFIER && event.shiftKey && event.key.toLowerCase() === 's') {
				refresh();
			}

			// CHANGE SCALE - ZOOM IN
			if (MODIFIER && event.shiftKey && event.key.toLowerCase() === 'p') {
				appState.canvasScale += 0.1;
			}
			// CHANGE SCALE - ZOOM OUT
			if (MODIFIER && event.shiftKey && event.key.toLowerCase() === 'o') {
				appState.canvasScale -= 0.1;
			}
			// SELCT ALL PLOTS
			if (MODIFIER && event.key.toLowerCase() === 'a') {
				event.preventDefault();
				selectAllPlots();
			}
			// SAVE THE SESSION
			if (!event.shiftKey && MODIFIER && event.key.toLowerCase() === 's') {
				event.preventDefault();
				//TODO: Can this be put into the Setting module? I tried before and had issues
				try {
					// Get JSON string and validate
					const jsonStr = outputCoreAsJson();
					if (typeof jsonStr !== 'string' || !jsonStr) {
						throw new Error('Invalid or empty JSON string returned by outputCoreAsJson');
					}

					// Validate JSON content
					try {
						JSON.parse(jsonStr); // Ensure it's valid JSON
					} catch (e) {
						throw new Error('Invalid JSON format: ' + e.message);
					}

					// Create Blob with JSON content
					const blob = new Blob([jsonStr], { type: 'application/json' });
					const url = URL.createObjectURL(blob);

					// Create temporary <a> element
					const a = document.createElement('a');
					a.innerText = 'download';
					a.href = url;
					a.download = 'session.json'; // File name for download
					document.body.appendChild(a);

					// Programmatically trigger click
					a.click();

					console.log(
						'should have started download of ',
						JSON.parse(jsonStr),
						' from ',
						url,
						' : ',
						blob
					);
					// Clean up
					setTimeout(() => {
						document.body.removeChild(a);
						URL.revokeObjectURL(url);
					}, 10); // Delay cleanup to ensure download starts
				} catch (error) {
					console.error('Failed to export JSON:', error.message);
					alert('Error exporting JSON: ' + error.message); // Notify user of error
				}
			}
		});

		//remove the listeners on close
		return () => {
			window.removeEventListener('resize', updateWidth);
			document.removeEventListener('keydown');
		};
	});

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
			data: { start: 10, step: 1, length: N },
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
		core.data[core.data.length - 1].timeFormat = "yyyy-LL-dd'T'HH:mm:ss.S'Z'"; //'%Y-%m-%dT%H:%M:%S.%L%Z';

		core.tables = [];
		core.tables.push(new Table({ name: 'my first table' }));
		core.tables[0].columnRefs = [testtimestring, testawd.id, testref.id, testrefref.id];
		core.tables.push(new Table({ name: 'table too' }));
		core.tables[1].columnRefs = [d1id, d0id, d2id]; //Do we want to be able to have the same data in more than one table? Might need to ensure this doesn't happen.
		core.tables[1].processes.push(
			new TableProcess(
				{
					name: 'BinnedData',
					args: {
						xIN: d0id,
						yIN: d1id,
						binSize: 2,
						binStart: 0,
						out: { binnedx: -1, binnedy: -1 }
					}
				},
				core.tables[1]
			)
		);

		core.plots = [];
		//Scatter plot
		pushObj(new Plot({ name: 'A Scatterplot', type: 'scatterplot' }));
		core.plots[0].plot.addData({
			x: { refId: core.data[0].id },
			y: { refId: core.data[1].id }
		});
		core.plots[0].plot.addData({
			x: { refId: core.data[core.data.length - 2].id },
			y: { refId: core.data[core.data.length - 1].id }
		});
		core.plots[core.plots.length - 1].x = 15;
		core.plots[core.plots.length - 1].y = 15;

		// //Actogram
		pushObj(new Plot({ name: 'An Actogram', type: 'actogram' }));
		core.plots[core.plots.length - 1].height = snapToGrid(700);
		core.plots[core.plots.length - 1].plot.addData({
			x: { refId: core.data[0].id },
			y: { refId: core.data[1].id }
		});
		core.plots[core.plots.length - 1].plot.addData({
			x: { refId: core.data[core.data.length - 2].id },
			y: { refId: core.data[core.data.length - 1].id }
		});
		core.plots[core.plots.length - 1].plot.data[1].colour = '#bf796b91';
		core.plots[core.plots.length - 1].x = snapToGrid(15);
		core.plots[core.plots.length - 1].y = snapToGrid(335);

		//Periodogram
		pushObj(new Plot({ name: 'A Periodogram', type: 'periodogram' }));
		core.plots[core.plots.length - 1].plot.addData({
			x: { refId: core.data[0].id },
			y: { refId: core.data[1].id }
		});
		core.plots[core.plots.length - 1].plot.addData({
			x: { refId: core.data[core.data.length - 2].id },
			y: { refId: core.data[core.data.length - 1].id }
		});
		core.plots[core.plots.length - 1].x = snapToGrid(555);
		core.plots[core.plots.length - 1].y = snapToGrid(15);
		core.plots[core.plots.length - 1].width = snapToGrid(510);

		//Table
		core.plots.push(new Plot({ name: 'a table', type: 'tableplot' }));
		core.plots[core.plots.length - 1].x = snapToGrid(555);
		core.plots[core.plots.length - 1].y = snapToGrid(330);
		core.plots[core.plots.length - 1].plot.columnRefs = [
			core.data[0].id,
			core.data[1].id,
			core.data[core.data.length - 2].id,
			core.data[core.data.length - 1].id
		];
		core.plots[core.plots.length - 1].plot.showCol = [true, true, true, true];

		//Correlogram
		pushObj(new Plot({ name: 'An Autocorrelogram', type: 'correlogram' }));
		core.plots[core.plots.length - 1].plot.addData({
			x: { refId: core.data[0].id },
			y: { refId: core.data[1].id }
		});
		core.plots[core.plots.length - 1].plot.addData({
			x: { refId: core.data[core.data.length - 2].id },
			y: { refId: core.data[core.data.length - 1].id }
		});
		core.plots[core.plots.length - 1].x = snapToGrid(555);
		core.plots[core.plots.length - 1].y = snapToGrid(645);
		core.plots[core.plots.length - 1].width = snapToGrid(510);

		// FFT
		pushObj(new Plot({ name: 'A Fourier Analysis', type: 'fft' }));
		core.plots[core.plots.length - 1].plot.addData({
			x: { refId: core.data[0].id },
			y: { refId: core.data[1].id }
		});
		core.plots[core.plots.length - 1].plot.addData({
			x: { refId: core.data[core.data.length - 2].id },
			y: { refId: core.data[core.data.length - 1].id }
		});
		core.plots[core.plots.length - 1].x = snapToGrid(555);
		core.plots[core.plots.length - 1].y = snapToGrid(960);
		core.plots[core.plots.length - 1].width = snapToGrid(510);

		//--------
		//Add another tableprocess to test removal
		core.tables[1].processes.push(
			new TableProcess(
				{
					name: 'Duplicate',
					args: {
						xIN: core.data[core.data.length - 1].id,
						out: { result: -1 }
					}
				},
				core.tables[1]
			)
		);
		core.plots[0].plot.data[1].y.refId = core.data[core.data.length - 1].id;
	}

	// TODO: Key Handling accessibility, e.g. ctrl+i == import
</script>

<svelte:head>
	<title>AnCiR {appConsts.version}</title>
</svelte:head>

{#if isLoaded}
	{#if appState.showNavbar}
		<Navbar />
	{/if}

	<DisplayPanel />

	<PlotDisplay />

	<ControlPanel />

	<AreYouSure
		bind:showModal={appState.showAYSModal}
		text={appState.AYStext}
		callback={appState.AYScallback}
	/>
{:else}
	<div>
		<p>
			<Icon name="spinner" width={32} height={32} className="spinner" />
			{loadingMsg}
		</p>
	</div>
{/if}

<style>
	:global(body) {
		font-family: system-ui, sans-serif;
		font-size: 14px;
	}

	:global(button) {
		font-family: system-ui, sans-serif;
		font-size: 14px;
	}

	:global(button.icon) {
		background-color: transparent;
		border: none;
		margin: 0;
		padding: 0;
		text-align: inherit;
		font: inherit;
		border-radius: 0;
		appearance: none;
		display: flex;
		justify-content: center;
		align-items: center;
	}

	/* :global(input:focus) {
		background-color: blue;
	} */

	/* resizer style */
	:global(.resizer) {
		cursor: col-resize;
		width: 4px;
		height: 100%;
		position: absolute;
		top: 0;
		right: 0;
		background-color: transparent;
	}

	/* TODO: scroll down, resizer not working */

	/* dialog button style */
	:global(.dialog-button-container) {
		display: flex;
		justify-content: flex-end;

		cursor: pointer;
	}

	:global(button.dialog-button) {
		margin-top: 10px;
		background-color: var(--color-lightness-95);
		border: transparent;
		border-radius: 4px;
		padding: 10px;
		padding-right: 12px;

		font-size: 14px;
		text-align: center;

		cursor: pointer;
	}

	:global(button.dialog-button:hover) {
		background-color: var(--color-hover);
	}

	/* space filler */
	:global(.div-line) {
		height: 1px;
		width: 100%;
		background-color: var(--color-lightness-85);
		margin-top: 1rem;
		margin-bottom: 0.5rem;
	}

	:global(.div-block) {
		height: 150px;
		width: 100%;
		background-color: transparent;
	}

	/* dropdown */
	:global(.dropdown-action button) {
		display: flex;
		margin: 0.6em;

		font-size: 14px;
		font: inherit;
		text-align: inherit;

		background-color: transparent;
		border: none;
		border-radius: 0;
		appearance: none;

		cursor: pointer;
	}

	:global(.dropdown-action:hover) {
		background-color: var(--color-lightness-95);
	}

	:global(.dropdown-item) {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.6em;
		cursor: pointer;
		border: none;
		background: transparent;
		text-align: left;
		font: inherit;
	}

	:global(.dropdown-item:hover) {
		background-color: var(--color-lightness-95);
	}

	:global(.dropdown-item.has-submenu::after) {
		content: '▶';
		font-size: 0.8em;
		color: var(--color-lightness-35);
	}

	:global(.submenu) {
		position: fixed;
		min-width: 150px;
		background-color: white;
		border-radius: 4px;
		border: 1px solid var(--color-lightness-85);
		box-shadow:
			0 4px 8px 0 rgba(0, 0, 0, 0.2),
			0 6px 10px 0 rgba(0, 0, 0, 0.1);
		z-index: 1001; /* Above dialog */
	}

	:global(.submenu-item) {
		display: block;
		padding: 0.6em;
		cursor: pointer;
		border: none;
		background: transparent;
		text-align: left;
		font: inherit;
		width: 100%;
		font-size: 14px;
	}

	:global(.submenu-item:hover) {
		background-color: var(--color-lightness-95);
	}

	/* display collapsible */
	:global(details) {
		margin: 0.25rem 0.5rem;
		padding: 0;
	}

	:global(summary) {
		list-style: none;

		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;

		margin: 0;
		padding: 0;
	}

	:global(summary p) {
		margin: 0;
		padding: 0;
	}

	:global(summary button) {
		margin: 0;
		padding: 0;
	}

	:global(.clps-title) {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;

		gap: 0.5rem;
	}

	:global(.clps-title-button) {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;

		margin-left: 0.5rem;
		gap: 0.25rem;
	}

	:global(.clps-icon-container) {
		display: flex;
		align-items: center;
		justify-content: center;

		padding: 0.5rem 0.5rem;
		padding-left: 1rem;
	}

	:global(.clps-icon) {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: center;

		width: 100%;
		padding: 0.5rem 0;

		background-color: white;
		border-radius: 4px;
		border: solid 1px var(--color-lightness-85);

		border-color: none;
		appearance: none;
	}

	:global(.clps-icon p) {
		margin: 0 0 0 0.2rem;
		padding: 0;
		color: var(--color-lightness-35);
	}

	:global(.clps-icon:hover) {
		background-color: var(--color-lightness-98);
		cursor: pointer;
	}

	:global(.second-clps) {
		width: 100%;
		padding: 0 0 0 0.25rem;
	}

	/* plot control */
	:global(.control-banner) {
		position: sticky;
		top: 0;

		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;

		font-weight: bold;
		background-color: white;
		z-index: 99;
	}

	:global(.control-banner-title) {
		width: 100%;
		display: flex;
		flex: 1 1 0;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
	}

	:global(.control-banner-icons) {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-end;

		margin: 0;
		padding: 0;
	}

	:global(.control-tab) {
		position: sticky;
		top: 0;

		width: 100%;
		display: flex;
		flex-direction: row;
		flex-wrap: nowrap; /* Prevent buttons from wrapping */
		align-items: center;
		justify-content: flex-start;
		gap: 0.4rem;
		overflow-x: auto;
	}

	:global(.control-tab::-webkit-scrollbar) {
		display: none;
	}

	:global(.control-tab button) {
		font-size: 14px;
		margin: 0;
		padding: 0.25rem 0.5rem;
		color: var(--color-lightness-35);
		background-color: transparent;
		border-radius: 4px;
		border: none;
		appearance: none;
		white-space: nowrap; /* Prevent text wrapping within buttons */
	}

	:global(.control-tab button.active) {
		color: black;
		background-color: var(--color-lightness-95);
	}

	:global(.control-tab button:hover) {
		background-color: var(--color-lightness-95);
	}

	:global(.control-data-add) {
		position: fixed;
		top: 4.2rem;
		width: 100%;
		z-index: 100;
		left: calc(100% - 2rem);
	}

	:global(.control-component) {
		display: flex;
		flex-direction: column;
		align-items: flex-start;

		width: 100%;
		/* margin-bottom: 0.5rem; */
	}

	:global(.control-component-title) {
		width: 100%;
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;

		/* font-weight: bold; */
	}

	:global(.control-component-title button) {
		margin: 0;
		margin-left: 0.5rem;
		padding: 0;
	}

	:global(.control-component-title-colour) {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;

		gap: 0.5rem;
	}

	:global(.control-component-title-icons) {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-end;
	}

	:global(.control-input-vertical) {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 100%;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	:global(.control-input-horizontal) {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: center;
		width: 100%;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	:global(.control-input-square) {
		width: 100%;
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.5rem;

		margin-bottom: 0.5rem;
	}

	:global(.control-input-color) {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;

		width: 100%;
		gap: 0.5rem;
	}

	:global(.control-input-color button) {
		margin: 0;
		padding: 0;
	}

	:global(.control-input) {
		display: flex;
		flex: 1 1 0;
		flex-direction: column;
		width: 100%;
		min-width: 0;
	}

	:global(.control-input-checkbox) {
		display: flex;
		flex: 1 1 0;
		flex-direction: row;
		align-items: center;
		text-align: center;
		width: 100%;
		min-width: 0;

		margin: 0;
	}

	:global(.control-input p) {
		font-size: 12px;
		text-align: left;
		color: var(--color-lightness-35);
		margin: 0 0 4px 0;
	}

	:global(.control-input-checkbox p) {
		font-size: 12px;
		text-align: left;
		color: var(--color-lightness-35);
		margin: 0 0 0 0.2rem;
	}

	:global(.control-input select, .control-input input) {
		width: 100%;

		height: var(--control-input-height);
		box-sizing: border-box;

		font-size: 14px;
		font-weight: lighter;
		padding: 0.2rem 0.5rem;
		border: solid 1px transparent;
		background-color: var(--color-lightness-97);
		border: solid 1px var(--color-lightness-85);
		border-radius: 2px;
		transition: border-color 0.2s;
	}

	:global(.control-input select) {
		padding: 0.2rem 0.25rem;
	}

	:global(.control-input select:hover, .control-input input:hover) {
		border: solid 1px var(--color-lightness-35);
	}

	:global(.control-color) {
		display: flex;
		align-items: baseline;
		justify-content: baseline;

		box-sizing: border-box;
		border: solid 1px transparent;

		margin-top: 1.2rem;
	}

	:global(button.control-block-add) {
		width: 100%;

		border: solid 1px var(--color-lightness-85);
		background-color: var(--color-lightness-97);
		border-radius: 4px;

		padding: 0.5rem 0;

		cursor: pointer;
	}

	:global(button.control-block-add:hover) {
		border: solid 1px var(--color-lightness-90);
		background-color: var(--color-lightness-90);
	}

	/* plot control (data) */
	:global(.control-data-container) {
		display: flex;
		flex: 1 1 0;
		flex-direction: column;

		width: 100%;
		min-width: 0;

		margin: 0;
		gap: 0.25rem;
	}

	:global(.control-data) {
		display: flex;
		flex: 1 1 0;
		flex-direction: column;
		width: 100%;
		min-width: 0;
	}

	:global(.control-data-title) {
		display: flex;
		flex: 1 1 0;
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;

		width: 100%;
		min-width: 0;

		margin: 0;
		padding: 0;

		gap: 0.5rem;
	}

	:global(.control-data-title p) {
		margin: 0;
		padding: 0;
	}

	:global(.with-icon) {
		justify-content: space-between;
	}

	/* process */
	:global(.process) {
		width: 100%;
		flex: 1 1 0;
		margin: 0;
	}

	:global(.process-title) {
		width: 100%;
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;

		margin: 0;
		padding: 0;

		font-weight: bold;
	}

	:global(.process-title button) {
		margin: 0;
		padding: 0;
	}

	:global(input[type='checkbox']) {
		width: 1rem;
		height: 1rem;
		accent-color: var(--color-lightness-97);
		cursor: pointer;
	}

	:global(.column-indicator) {
		position: absolute;
		top: 0;
		left: 0;
		bottom: 0;

		width: 4px;
		height: 100%;
		background-color: var(--color-lightness-90);

		border-radius: 4px;
	}

	:global(.tooltip) {
		position: absolute;
		background-color: rgba(0, 0, 0, 0.7);
		color: white;
		padding: 0.5rem 0.8rem;
		border-radius: 4px;
		pointer-events: none;
		font-size: 0.8rem;
		z-index: 9999;
		width: 100px;
	}

	:global(.tableProcess-container) {
		display: flex;
		flex-direction: column;

		border: 0.1rem solid var(--color-lightness-85);
		padding-right: 0.25rem;
		margin-left: -0.25rem;
		margin-right: 0.5rem;
		border-radius: 0.25rem;
	}

	:global(.section-row) {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.25rem;
		padding-left: 0.25rem;
		margin-top: 0.5rem;
	}
	:global(.tableProcess-label) {
		display: flex;
		align-items: center;
		margin-bottom: 0rem;
		margin-left: -0.25rem;
		background: white;
		padding: 0.25rem;
	}

	:global(.tableProcess-label span) {
		color: #555;
	}
</style>
