// gettingStarted.js — general, persona-agnostic hands-on walkthrough.
// Loaded on demand by tourRunner (import.meta.glob). Predicates read live app
// state so steps that ask the user to DO something auto-advance when done.
import { core, appState } from '$lib/core/core.svelte.js';
import { anyPlotStatus, axisHint, anyPlotInPortEl, sourceOutElForAxis } from '$lib/core/tourWiring.js';

// The actogram the user just made (the tour creates one). Falls back to the most
// recent plot so the resize step still works if the type lookup ever changes.
function actogramPlot() {
	const plots = core.plots ?? [];
	return plots.find((p) => p.type === 'actogram') ?? plots[plots.length - 1] ?? null;
}

// The Width row in the control panel's Shared properties → Dimension group, so the
// final step can ring the actual size field. Falls back to the panel container.
function widthControlEl() {
	if (typeof document === 'undefined') return null;
	const label = [...document.querySelectorAll('.control-input p')].find((p) =>
		(p.textContent || '').trim().startsWith('Width')
	);
	// Fall back to the control-panel content (NOT '.view-container', which the Data
	// panel also uses) so the ring never lands on the wrong panel.
	return label?.closest('.control-input') ?? document.querySelector('.control-component') ?? null;
}

// Captured when the resize step opens, so we can detect that the user actually
// changed the actogram's size (vs. its starting dimensions).
let resizeBaseline = null;

export const tour = {
	id: 'getting-started',
	name: 'Getting started',
	description: 'A short hands-on tour: simulate data, plot an actogram, and style it.',
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
			// Highlight the "add data" prompt, then follow the menu it opens so the
			// ring lands on the choices once they appear (resolveTarget re-runs after
			// each click — see TourOverlay onPointerUp).
			target: () => document.querySelector('.add-data-menu') ?? document.querySelector('.add-data-cta'),
			placement: 'right',
			title: 'Add some data',
			body: 'Click here, then choose <strong>“Simulate data”</strong> to create an example rhythmic signal to play with.',
			beforeShow: () => {
				appState.view = 'canvas';
			},
			advance: { when: () => core.data.length > 0 }
		},
		{
			// Highlight the + button, then the palette once it opens.
			target: () => document.querySelector('.palette-menu') ?? document.querySelector('.np-trigger'),
			placement: 'left',
			title: 'Add an actogram',
			body: 'Open the <strong>+</strong> menu and pick <strong>“Actogram”</strong> — the classic chronobiology plot. It starts empty; we’ll connect your data to it next.',
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
					'Plots have an <strong>x</strong> (across) and a <strong>y</strong> (up) input. Drag from your data node’s <strong>output dot</strong> (right edge) onto the highlighted <strong>x</strong> dot — the time column.',
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
					'Now drag a column onto the <strong>y</strong> dot — the values to plot. The <strong>y</strong> shows a <strong>*</strong> because it can take several columns at once to overlay series.',
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
			// Open the Data panel and point at its sections so the user knows where to
			// find everything later.
			target: () => document.querySelector('.display-list') ?? document.querySelector('.view-container'),
			placement: 'right',
			title: 'Find everything here',
			body: 'This is the <strong>Data</strong> panel. Everything in your session lives here, grouped into <strong>Data</strong> (your columns and sources), <strong>Nodes</strong> (analysis steps) and <strong>Plots</strong>. Click any row to jump to it on the canvas.',
			beforeShow: () => {
				appState.showDisplayPanel = true;
				appState.currentTab = 'data';
			},
			advance: { on: 'next' }
		},
		{
			// Switch to the Workspace (plots) view so the user can focus on visuals.
			target: () => document.querySelector('.view-pair') ?? document.querySelector('nav'),
			placement: 'right',
			title: 'The Workspace',
			body: 'Switch to the <strong>Workspace</strong> to focus on your visuals. Drag plots to rearrange them, and resize from the corner handle. Use the two view buttons to flip between the <strong>Workflow</strong> (the wiring) and the <strong>Workspace</strong> (the plots).',
			beforeShow: () => {
				appState.view = 'plots';
				appState.showDisplayPanel = false;
			},
			advance: { on: 'next' }
		},
		{
			// Select the actogram + open the control panel so its size fields show,
			// then advance once the user actually changes the width or height.
			target: () => widthControlEl(),
			placement: 'left',
			title: 'Style it — resize',
			body: 'With the actogram selected, the <strong>control panel</strong> shows its properties. Try changing the <strong>Width</strong> or <strong>Height</strong> under <em>Dimension</em> and watch the plot update.',
			beforeShow: () => {
				appState.view = 'plots';
				appState.showDisplayPanel = false;
				const act = actogramPlot();
				(core.plots ?? []).forEach((p) => (p.selected = p === act));
				appState.showControlPanel = true;
				resizeBaseline = act ? { w: act.width, h: act.height } : null;
			},
			advance: {
				when: () => {
					const act = actogramPlot();
					if (!act || !resizeBaseline) return false;
					return act.width !== resizeBaseline.w || act.height !== resizeBaseline.h;
				}
			}
		},
		{
			target: null,
			title: 'You did it! 🎉',
			body: 'You simulated data, plotted an actogram, wired it up, and styled it. Double-click any node to edit it, and explore the <strong>+</strong> menu for analyses like <strong>Cosinor</strong> and <strong>Periodogram</strong>. You can reopen this tour anytime from the <strong>?</strong> menu.',
			advance: { on: 'next' }
		}
	]
};
