<!-- +page.svelte -->

<script>
	// @ts-nocheck
	// import { version } from "../../package.json";
	import '../app.css';
	import Navbar from '$lib/components/Navbar.svelte';
	import DisplayPanel from '../lib/components/DisplayPanel.svelte';
	import ControlPanel from '$lib/components/ControlPanel.svelte';
	import PlotPanel from '$lib/components/PlotPanel.svelte';
	
	import { onMount } from 'svelte';
	import { testJson } from './testJson.svelte.js';
	import { testJsonDC } from './testJsonDC.svelte';
	
	import { core, pushObj, appConsts, appState } from '$lib/core/core.svelte';
	import { Column } from '$lib/core/column.svelte';
	import { Table } from '$lib/core/table.svelte';
	import { Plot } from '$lib/core/plot.svelte';
	import { Process } from '$lib/core/process.svelte';

	import { loadProcesses } from '$lib/processes/processMap.js';
	import { loadPlots } from '$lib/plots/plotMap.js';

	onMount(async () => {
		//load the maps
		appConsts.processMap = await loadProcesses();
		appConsts.plotMap = await loadPlots();

		populatePanelWidth();
		loadTestJson();
	});

	function populatePanelWidth() {
		appState.positionDisplayPanel = 360 + appState.positionNavbar;
		appState.positionControlPanel = window.outerWidth - 360;
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
	};

</script>

<!-- <svelte:head>
  <title>AnCiR v β.{version}</title>
</svelte:head> 
-->

{ #if appState.showNavbar}
	<Navbar />
{/if}

{ #if appState.showDisplayPanel}
	<DisplayPanel />
{/if}

<PlotPanel />

{ #if appState.showControlPanel}
	<ControlPanel /> 
{/if}


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


