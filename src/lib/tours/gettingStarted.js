// gettingStarted.js — general, persona-agnostic hands-on walkthrough.
// Loaded on demand by tourRunner (import.meta.glob). Predicates read live app
// state so steps that ask the user to DO something auto-advance when done.
import { core, appState } from '$lib/core/core.svelte.js';
import { anyPlotStatus, axisHint, anyPlotInPortEl, sourceOutElForAxis } from '$lib/core/tourWiring.js';
import { iconHtml } from '$lib/icons/iconRegistry.js';

// Inline icon markup for the "Find on canvas" row button. Tour bodies render via
// {@html}, so the <Icon> component can't be used here — `iconHtml` pulls the same
// artwork from the shared icon registry as a string (single source of icons).
const processIconHtml = iconHtml('process');

// The actogram the user just made (the tour creates one). Falls back to the most
// recent plot so the resize step still works if the type lookup ever changes.
function actogramPlot() {
	const plots = core.plots ?? [];
	return plots.find((p) => p.type === 'actogram') ?? plots[plots.length - 1] ?? null;
}

// The Dimension group in the control panel's properties tab (Width + Height), so
// the resize step rings the size fields. Labels render as <span class="ci-label">
// (the ControlInput component), not <p>, so match on that and ring the whole
// Dimension control-component. Falls back to the first control-component.
function dimensionControlEl() {
	if (typeof document === 'undefined') return null;
	const label = [...document.querySelectorAll('.control-input .ci-label')].find((el) =>
		(el.textContent || '').trim().startsWith('Width')
	);
	return (
		label?.closest('.control-component') ??
		label?.closest('.control-input') ??
		document.querySelector('.control-component') ??
		null
	);
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
					'Scatterplots have an <strong>x</strong> and a <strong>y</strong> input. Drag from your data node’s <strong>output dot</strong> (right edge) onto the highlighted <strong>x</strong> dot — the time column.',
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
			body: `This is the <strong>Data</strong> panel. Everything in your session lives here, grouped into <strong>Data</strong> (your columns and sources), <strong>Nodes</strong> (analysis steps) and <strong>Plots</strong>. Click the ${processIconHtml} button on any row to jump to it on the canvas.`,
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
			// Select the actogram, then have the user open the control panel from the
			// edge button so they learn where it lives. Starts from closed so the
			// "open" button is the target; advances once the panel is open.
			target: () => document.querySelector('.open-control-panel-icon-container'),
			placement: 'left',
			title: 'Open the control panel',
			body: 'With the actogram selected, open the <strong>control panel</strong> from this button on the right edge. It shows the selected plot’s properties.',
			beforeShow: () => {
				appState.view = 'plots';
				appState.showDisplayPanel = false;
				const act = actogramPlot();
				(core.plots ?? []).forEach((p) => (p.selected = p === act));
				appState.currentControlTab = 'properties';
				appState.showControlPanel = false;
			},
			advance: { when: () => appState.showControlPanel === true }
		},
		{
			// Control panel is open now; ring the Dimension group and advance once the
			// user actually changes the width or height.
			target: () => dimensionControlEl(),
			placement: 'left',
			title: 'Style it — resize',
			body: 'The <strong>control panel</strong> shows the actogram’s properties. Try changing the <strong>Width</strong> or <strong>Height</strong> under <em>Dimension</em> and watch the plot update.',
			beforeShow: () => {
				appState.view = 'plots';
				appState.showDisplayPanel = false;
				const act = actogramPlot();
				(core.plots ?? []).forEach((p) => (p.selected = p === act));
				appState.showControlPanel = true;
				appState.currentControlTab = 'properties';
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
