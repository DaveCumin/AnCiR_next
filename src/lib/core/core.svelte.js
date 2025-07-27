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
	widthNavBar: 56,
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

/* Core Documentation
- core contains columns, plots, tables. E.g. call core.columns[column.ids]
- call pushObj(obj) to add into core.arrays

*/

//TODOs:
//- consider states for:
//- UI theme (defaults for colours, rems, fonts, border, shading, etc).
//(stretch) and the ability to store custom values
//- How best to give users feedback (trigger Toasts)?
//- Import data logic (including time format guessing - this is currently OK, I think; though, could include a formats for "epoch" or "seconds", etc [if not already])
//- Simulate data - extend the current options to include Bob's algorithms
//- Carefully consider plots (?layercake)
//- structure for the 'Box' that houses a plot (width, height, xpos, ypos, layer)..
// should this be in the Plot class or separate? (i.e. do we want to allow making a 'Box' larger or smaller than the contents?)
//- UI: allow a 'Box' to be 'fullscreen'
//- (stretch) UI: Drag and drop items (show zones where allowed, etc)
//- (stretch) consider localstorage for UX preferences [and possibly data/sessions]; consoider cloud storage for sessions (Super-stretch: concurrent working a'la Google Sheets)
//- (stretch) a store for edits to undo/redo: this needs careful thought
