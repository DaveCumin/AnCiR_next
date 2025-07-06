export const core = $state({});
export const app_state = $state({
	current_tab: 'data'
});
export const appConsts = $state({
	processMap: new Map(),
	plotMap: new Map(),
	gridsize: Number(10),
	appColours: ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000']
});

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

// OTHER PLOTS
