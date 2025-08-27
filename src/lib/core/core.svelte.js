// @ts-nocheck

import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core//Plot.svelte';
import { Table } from '$lib/core//Table.svelte';

export const core = $state({
	data: [],
	plots: [],
	tables: []
});

export const appState = $state({
	currentTab: initialiseCurrentTab(false, false), // change values if panel visibility initialised differently
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

	invisiblePlotIds: [],

	appColours: [
		'#234154',
		'#BE796B',
		'#3E7295',
		'#EDADAD',
		'#A6ACD5',
		'#83422A',
		'#6B9FD5',
		'#4A1E0E',

		'#fbe67280' // transparrent yellow for light
	],
	showColourPicker: false,

	showAYSModal: false, // AreYouSure modal
	AYStext: '',
	AYScallback: null
});

export const appConsts = $state({
	version: 'β.4.6',
	processMap: new Map(),
	plotMap: new Map(),
	tableProcessMap: new Map(),
	timeoutRefresh_ms: 20,
	colourPalettes: {
		batlowk: [
			'#04050A',
			'#FACCFA',
			'#4F6657',
			'#FDB9BF',
			'#6F7845',
			'#F6A986',
			'#A18E38',
			'#D89E50'
		],
		devon: ['#2C1A4C', '#3669AD', '#D0CCF5', '#6181D0', '#BAB3F1', '#989BE7', '#275186', '#E8E5FA'],
		glasgow: [
			'#361338',
			'#A6BED8',
			'#6B260B',
			'#74A9B0',
			'#716311',
			'#DBD3FF',
			'#687C48',
			'#60927D'
		],
		lipari: [
			'#031326',
			'#E9C99F',
			'#13385A',
			'#E7A279',
			'#47587A',
			'#BC6461',
			'#6B5F76',
			'#8E616C'
		],
		oslo: ['#010101', '#D4D6DB', '#133251', '#AAB6CA', '#1F4C7B', '#89A0CA', '#3869A8', '#658AC7'],
		berlin: ['#234154', '#BE796B', '#3E7295', '#EDADAD', '#A6ACD5', '#83422A', '#6B9FD5', '#4A1E0E']
	}
});

function initialiseCurrentTab(showDisplayPanel, showControlPanel) {
	if (!showDisplayPanel && !showControlPanel) return 'null';
	return 'data';
}

export function pushObj(obj, autoPosition = true) {
	if (obj instanceof Column) {
		core.data.push(obj);
	} else if (obj instanceof Table) {
		core.tables.push(obj);
	} else if (obj instanceof Plot) {
		if (autoPosition) {
			const container = document.getElementsByClassName('canvas')[0];
			console.log('DEBUGGING new plot from pushObj: ');
			console.log(container.offsetLeft);
			console.log(container.offsetTop);
			const pos = findNextAvailablePosition(core.plots);
			obj.x = pos.x + container.offsetLeft;
			obj.y = pos.y + container.offsetTop;
		}
		//now do sizing
		if (obj.type === 'scatterplot') {
			obj.width = snapToGrid(500);
			obj.height = snapToGrid(300);
		} else if (obj.type === 'periodogram') {
			obj.width = snapToGrid(400);
			obj.height = snapToGrid(250);
		} else if (obj.type === 'actogram') {
			obj.width = snapToGrid(500);
			obj.height = snapToGrid(600);
		}

		core.plots.push(obj);
	} else {
		console.warn('Error: object not instance of Column, Table or Plot');
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
