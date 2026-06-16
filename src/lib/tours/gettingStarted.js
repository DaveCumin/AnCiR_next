// gettingStarted.js — general, persona-agnostic hands-on walkthrough.
// Loaded on demand by tourRunner (import.meta.glob). Predicates read live app
// state so steps that ask the user to DO something auto-advance when done.
import { core, appState } from '$lib/core/core.svelte.js';
import { anyPlotStatus, wiringHint } from '$lib/core/tourWiring.js';

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
				`Switch between <strong>Data</strong> (your columns), <strong>Worksheet</strong> (arrange plots), and <strong>Workflow</strong> (wire up the analysis). You’re in the <strong>${appState.view === 'plots' ? 'Worksheet' : 'Workflow'}</strong> canvas now — try clicking another view.`,
			// No beforeShow here — let the user switch views and watch the text update.
			advance: { on: 'next' }
		},
		{
			target: '.add-data-cta',
			placement: 'bottom',
			title: 'Add some data',
			body: 'Click here, then choose <strong>“Simulate data”</strong> to create example data to play with. (You can also import a CSV/Excel file or load an example.)',
			beforeShow: () => {
				appState.view = 'canvas';
			},
			advance: { when: () => core.data.length > 0 }
		},
		{
			target: '.np-trigger',
			placement: 'left',
			title: 'Add a plot',
			body: 'Open the <strong>+</strong> menu and pick a plot — try <strong>“Actogram”</strong>. It starts empty; we’ll connect your data to it next.',
			beforeShow: () => {
				appState.view = 'canvas';
			},
			advance: { when: () => core.plots.length > 0 }
		},
		{
			target: '.plot-preview-panel',
			placement: 'right',
			title: 'Connect data to the plot',
			// Reactive: ticks off each input and only advances once BOTH x and y are
			// wired, so the user learns to connect the whole plot, not just one dot.
			body: () =>
				wiringHint(
					'Drag from a data column’s output dot (right edge of the data node) onto the plot’s input dots (left edge):',
					'a column',
					'x',
					'a column',
					'y',
					anyPlotStatus()
				),
			beforeShow: () => {
				appState.view = 'canvas';
			},
			advance: { when: () => anyPlotStatus().done }
		},
		{
			target: null,
			title: 'You did it! 🎉',
			body: 'You imported data, created a plot, and wired it up. Double-click any node to edit it, and explore the <strong>+</strong> menu for analyses like <strong>Cosinor</strong> and <strong>Periodogram</strong>. You can reopen this tour anytime from the <strong>?</strong> menu.',
			advance: { on: 'next' }
		}
	]
};
