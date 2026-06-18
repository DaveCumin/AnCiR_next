// gettingStarted.js — general, persona-agnostic hands-on walkthrough.
// Loaded on demand by tourRunner (import.meta.glob). Predicates read live app
// state so steps that ask the user to DO something auto-advance when done.
import { core, appState } from '$lib/core/core.svelte.js';
import { anyPlotStatus, axisHint, anyPlotInPortEl, sourceOutElForAxis } from '$lib/core/tourWiring.js';

// Inline view icons (match the Navbar: Data=table, Worksheet=layer, Workflow=process)
// so the tour's three-views list reads exactly like the toolbar. The tour body is
// rendered with {@html}, so small inline SVGs are the simplest way to show them.
const VIEW_ICON = {
	data: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="14" height="14" fill="currentColor" style="vertical-align:-2px;margin-right:6px"><path d="M64 256l0-96 160 0 0 96L64 256zm0 64l160 0 0 96L64 416l0-96zm224 96l0-96 160 0 0 96-160 0zM448 256l-160 0 0-96 160 0 0 96zM64 32C28.7 32 0 60.7 0 96L0 416c0 35.3 28.7 64 64 64l384 0c35.3 0 64-28.7 64-64l0-320c0-35.3-28.7-64-64-64L64 32z"/></svg>',
	worksheet:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" width="14" height="14" fill="currentColor" style="vertical-align:-2px;margin-right:6px"><path d="M264.5 5.2c14.9-6.9 32.1-6.9 47 0l218.6 101c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 149.8C37.4 145.8 32 137.3 32 128s5.4-17.9 13.9-21.8L264.5 5.2zM476.9 209.6l53.2 24.6c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 277.8C37.4 273.8 32 265.3 32 256s5.4-17.9 13.9-21.8l53.2-24.6 152 70.2c23.4 10.8 50.4 10.8 73.8 0l152-70.2zm-152 198.2l152-70.2 53.2 24.6c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 405.8C37.4 401.8 32 393.3 32 384s5.4-17.9 13.9-21.8l53.2-24.6 152 70.2c23.4 10.8 50.4 10.8 73.8 0z"/></svg>',
	workflow:
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="14" height="14" fill="currentColor" style="vertical-align:-2px;margin-right:6px"><path d="M467.8 98.4C479.8 93.4 493.5 96.2 502.7 105.3L566.7 169.3C572.7 175.3 576.1 183.4 576.1 191.9C576.1 200.4 572.7 208.5 566.7 214.5L502.7 278.5C493.5 287.7 479.8 290.4 467.8 285.4C455.8 280.4 448 268.9 448 256L448 224L416 224C405.9 224 396.4 228.7 390.4 236.8L358 280L318 226.7L339.2 198.4C357.3 174.2 385.8 160 416 160L448 160L448 128C448 115.1 455.8 103.4 467.8 98.4zM218 360L258 413.3L236.8 441.6C218.7 465.8 190.2 480 160 480L96 480C78.3 480 64 465.7 64 448C64 430.3 78.3 416 96 416L160 416C170.1 416 179.6 411.3 185.6 403.2L218 360zM502.6 534.6C493.4 543.8 479.7 546.5 467.7 541.5C455.7 536.5 448 524.9 448 512L448 480L416 480C385.8 480 357.3 465.8 339.2 441.6L185.6 236.8C179.6 228.7 170.1 224 160 224L96 224C78.3 224 64 209.7 64 192C64 174.3 78.3 160 96 160L160 160C190.2 160 218.7 174.2 236.8 198.4L390.4 403.2C396.4 411.3 405.9 416 416 416L448 416L448 384C448 371.1 455.8 359.4 467.8 354.4C479.8 349.4 493.5 352.2 502.7 361.3L566.7 425.3C572.7 431.3 576.1 439.4 576.1 447.9C576.1 456.4 572.7 464.5 566.7 470.5L502.7 534.5z"/></svg>'
};

export const tour = {
	id: 'getting-started',
	name: 'Getting started',
	description: 'A short hands-on tour: import data and make your first plot.',
	estMinutes: 2,
	order: 1,
	steps: [
		{
			target: null,
			title: 'Welcome to AnCiR 👋',
			body: 'AnCiR helps you <strong>import, analyse and visualise</strong> time-series data. Let’s make your first plot together — it only takes a minute.',
			advance: { on: 'next' }
		},
		{
			target: 'nav',
			placement: 'right',
			title: 'Three views',
			// Reactive body: reflects whichever view the user is in right now.
			body: () =>
				`Switch between: <ul><li>${VIEW_ICON.data}<strong>Data</strong> (your columns)</li><li>${VIEW_ICON.worksheet}<strong>Worksheet</strong> (arrange plots)</li><li>${VIEW_ICON.workflow}<strong>Workflow</strong> (wire up the analysis)</li></ul>You’re in the <strong>${appState.view === 'plots' ? 'Worksheet' : 'Workflow'}</strong> canvas now — try clicking another view.`,
			// No beforeShow here — let the user switch views and watch the text update.
			advance: { on: 'next' }
		},
		{
			// Highlight the "add data" prompt, then follow the menu it opens so the
			// ring lands on the choices once they appear (resolveTarget re-runs after
			// each click — see TourOverlay onPointerUp).
			target: () => document.querySelector('.add-data-menu') ?? document.querySelector('.add-data-cta'),
			placement: 'right',
			title: 'Add some data',
			body: 'Click here, then choose <strong>“Simulate data”</strong> to create example data to play with. (You can also import a CSV/Excel file or load an example.)',
			beforeShow: () => {
				appState.view = 'canvas';
			},
			advance: { when: () => core.data.length > 0 }
		},
		{
			// Highlight the + button, then the palette once it opens.
			target: () => document.querySelector('.palette-menu') ?? document.querySelector('.np-trigger'),
			placement: 'left',
			title: 'Add a plot',
			body: 'Open the <strong>+</strong> menu and pick a plot — try <strong>“Actogram”</strong>. It starts empty; we’ll connect your data to it next.',
			beforeShow: () => {
				appState.view = 'canvas';
			},
			advance: { when: () => core.plots.length > 0 }
		},
		{
			target: null,
			dim: false,
			placement: 'screen-bottom',
			title: 'Connect data — the x axis',
			// The overlay rings the highlighted dots and animates a demo edge (see
			// `wire`). x first; advances as soon as x is wired.
			body: () =>
				axisHint(
					'Plots have an <strong>x</strong> (across) and a <strong>y</strong> (up) input. Drag from a data column’s <strong>output dot</strong> (right edge of the data node) onto the highlighted <strong>x</strong> dot.',
					'a column',
					'x',
					anyPlotStatus().xOk
				),
			beforeShow: () => {
				appState.view = 'canvas';
			},
			wire: {
				from: () => sourceOutElForAxis('x', null),
				to: () => anyPlotInPortEl('x1')
			},
			advance: { when: () => anyPlotStatus().xOk }
		},
		{
			target: null,
			dim: false,
			placement: 'screen-bottom',
			title: 'Connect data — the y axis',
			body: () =>
				axisHint(
					'Now drag a column onto the <strong>y</strong> dot. The <strong>y</strong> shows a <strong>*</strong> because it can take several columns at once to overlay series.',
					'a column',
					'y',
					anyPlotStatus().yOk
				),
			beforeShow: () => {
				appState.view = 'canvas';
			},
			wire: {
				from: () => sourceOutElForAxis('y', null),
				to: () => anyPlotInPortEl('ys1')
			},
			advance: { when: () => anyPlotStatus().yOk }
		},
		{
			target: null,
			title: 'You did it! 🎉',
			body: 'You imported data, created a plot, and wired it up. Double-click any node to edit it, and explore the <strong>+</strong> menu for analyses like <strong>Cosinor</strong> and <strong>Periodogram</strong>. You can reopen this tour anytime from the <strong>?</strong> menu.',
			advance: { on: 'next' }
		}
	]
};
