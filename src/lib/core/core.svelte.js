import { Column } from './Column.svelte';
import { Plot } from './Plot.svelte';
import { Table } from './table.svelte.js';

export const core = $state({
	data: [],
	plots: [],
	tables: []
});

export const appState = $state({
	currentTab: 'data',

	showNavbar: true,
	showDisplayPanel: true,
	showControlPanel: false,

	windowWidth: window.innerWidth,
	widthNavBar: 40,
	widthDisplayPanel: 200,
	widthControlPanel: 200,

	canvasOffset: { x: 0, y: 0 },
	canvasScale: 1.0,

	selectedPlotIds: []
});

export const appConsts = $state({
	processMap: new Map(),
	plotMap: new Map(),
	tableProcessMap: new Map(),
	gridsize: Number(5), // TODO query I think this should be in appState
	appColours: ['#0B090B', '#F8BFD4', '#787C3F', '#3B565E', '#E5A15E'] // TODO query I think this should also be in appState
});

export function pushObj(obj) {
	if (obj instanceof Column) {
		core.data.push(obj);
	} else if (obj instanceof Table) {
		core.tables.push(obj);
	} else if (obj instanceof Plot) {
		core.plots.push(obj);
	} else {
		console.log('Error: object not instance of Column, Table or Plot');
	}
}

export function outputCoreAsJson() {
	const output = { ...core }; // TODO: output appState also, so when it loads, it will look exactly the same.
	return JSON.stringify(output, null, 2);
}
