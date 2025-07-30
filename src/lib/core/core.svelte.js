// @ts-nocheck

import { Column } from './Column.svelte';
import { Plot } from './Plot.svelte';
import { Table } from './Table.svelte';

export const core = $state({
	data: [],
	plots: [],
	tables: []
});

export const appState = $state({
	currentTab: 'data',
	currentControlTab: 'properties',

	showNavbar: true,
	showDisplayPanel: false,
	showControlPanel: false,

	windowWidth: window.innerWidth,
	windowHeight: window.innerHeight,
	widthNavBar: 56,
	widthDisplayPanel: 250,
	widthControlPanel: 250,

	gridSize: 15,
	canvasOffset: { x: 0, y: 0 },
	canvasScale: 1.0,

	selectedPlotIds: [],

	appColours: ['#0B090B', '#F8BFD4', '#787C3F', '#3B565E', '#E5A15E'],
	showColourPicker: false
});

export const appConsts = $state({
	processMap: new Map(),
	plotMap: new Map(),
	tableProcessMap: new Map(),

	appColours: ['#0B090B', '#F8BFD4', '#787C3F', '#3B565E', '#E5A15E']
});

export function pushObj(obj) {
	if (obj instanceof Column) {
		core.data.push(obj);
	} else if (obj instanceof Table) {
		core.tables.push(obj);
	} else if (obj instanceof Plot) {
		const pos = findNextAvailablePosition(core.plots);
		obj.x = pos.x;
		obj.y = pos.y;

		core.plots.push(obj);
	} else {
		console.log('Error: object not instance of Column, Table or Plot');
	}
}

export function snapToGrid(value) {
	return Math.round(value / appState.gridSize) * appState.gridSize;
}

// TODO: change to grid* layout
let _attempt = 0;
function findNextAvailablePosition(existingPlots) {
	const baseX = 10;
	const baseY = 20;
	const offsetX = 40;
	const offsetY = 40;

	while (true) {
		const rawX = baseX + _attempt * offsetX;
		const rawY = baseY + _attempt * offsetY;

		const x = snapToGrid(rawX);
		const y = snapToGrid(rawY);

		const collision = existingPlots.some((p) => Math.abs(p.x - x) < 30 && Math.abs(p.y - y) < 30);

		if (!collision) {
			return { x, y };
		}

		_attempt++;
	}
}

export function outputCoreAsJson() {
	const output = { ...core }; // TODO: output appState also, so when it loads, it will look exactly the same.
	return JSON.stringify(output, null, 2);
}
