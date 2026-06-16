// actigraphyQuickstart.js — domain hands-on walkthrough for chronobiologists.
// Builds the canonical pipeline AND has the user wire each connection:
// data → Bin → Actogram, Periodogram, Cosinor → plot the Cosinor fit on a
// Scatterplot. "Add" steps highlight the + palette; "wire" steps are an
// out-of-the-way bottom hint bar (no dim) so the user can see and drag the
// ports. Wire steps only advance once wiring is COMPLETE (every required port),
// and their body updates live to tick off each input + nudge what's still
// missing. Loaded on demand by tourRunner.
import { core, appState } from '$lib/core/core.svelte.js';
import {
	findTP,
	tpStatus,
	plotStatus,
	cosinorFitStatus,
	wiringHint
} from '$lib/core/tourWiring.js';

const ensureCanvas = () => {
	appState.view = 'canvas';
};

// Shared shape for the "now drag the wires" hint-bar steps. `body` is a function
// so it re-renders live as the user connects ports; `when` gates on COMPLETE
// wiring (status.done), not a single wire.
const wireStep = (title, body, status) => ({
	target: null,
	dim: false,
	placement: 'screen-bottom',
	title,
	body,
	beforeShow: ensureCanvas,
	advance: { when: () => status().done }
});

export const tour = {
	id: 'actigraphy-quickstart',
	name: 'Actigraphy quick-start',
	description: 'Build a circadian pipeline: data → Bin → Actogram → Periodogram → Cosinor fit.',
	estMinutes: 6,
	order: 2,
	steps: [
		{
			target: null,
			title: 'Actigraphy quick-start',
			body: 'We’ll build the classic circadian workflow and wire it up by hand: bin activity, draw an actogram, find the period, fit a rhythm, and plot the fit. Let’s go.',
			advance: { on: 'next' }
		},
		{
			target: '.add-data-cta',
			placement: 'top',
			title: 'Get a time + activity series',
			body: 'Add data with this prompt — <strong>Import a file</strong> (a time column + an activity column) or <strong>Simulate data</strong> to try it out.',
			beforeShow: ensureCanvas,
			advance: { when: () => core.data.length > 0 }
		},
		{
			target: '.np-trigger',
			placement: 'left',
			title: 'Add a Bin Data node',
			body: 'Open <strong>+</strong> and add <strong>“Bin Data”</strong>. Binning groups raw activity into even intervals (e.g. 15 min).',
			beforeShow: ensureCanvas,
			advance: { when: () => !!findTP('BinnedData') }
		},
		wireStep(
			'Wire data → Bin Data',
			() =>
				wiringHint(
					'Connect your data into Bin Data:',
					'time',
					'xIN',
					'activity',
					'yIN',
					tpStatus('BinnedData')
				),
			() => tpStatus('BinnedData')
		),
		{
			target: '.np-trigger',
			placement: 'left',
			title: 'Add an Actogram',
			body: 'Add an <strong>“Actogram”</strong> — the classic double-plotted view of daily rhythms.',
			beforeShow: ensureCanvas,
			advance: { when: () => core.plots.some((p) => p.type === 'actogram') }
		},
		wireStep(
			'Wire the binned data → Actogram',
			() =>
				wiringHint(
					'Connect the binned series to the Actogram:',
					'binned time',
					'x',
					'binned activity',
					'y',
					plotStatus('actogram')
				),
			() => plotStatus('actogram')
		),
		{
			target: '.np-trigger',
			placement: 'left',
			title: 'Add a Periodogram',
			body: 'Add a <strong>“Periodogram”</strong> to estimate the dominant rhythm period (≈24 h).',
			beforeShow: ensureCanvas,
			advance: { when: () => core.plots.some((p) => p.type === 'periodogram') }
		},
		wireStep(
			'Wire data → Periodogram',
			() =>
				wiringHint(
					'Connect your series to the Periodogram:',
					'time',
					'x',
					'activity',
					'y',
					plotStatus('periodogram')
				),
			() => plotStatus('periodogram')
		),
		{
			target: '.np-trigger',
			placement: 'left',
			title: 'Add a Cosinor',
			body: 'Add a <strong>“Cosinor”</strong> to fit a cosine model — its period, amplitude and acrophase appear as output ports.',
			beforeShow: ensureCanvas,
			advance: { when: () => !!findTP('Cosinor') }
		},
		wireStep(
			'Wire data → Cosinor',
			() =>
				wiringHint(
					'Connect your data into the Cosinor:',
					'time',
					'xIN',
					'activity',
					'yIN',
					tpStatus('Cosinor')
				),
			() => tpStatus('Cosinor')
		),
		{
			target: '.np-trigger',
			placement: 'left',
			title: 'Add a Scatterplot for the fit',
			body: 'Add a <strong>“Scatterplot”</strong> — we’ll overlay the Cosinor fit on your data here.',
			beforeShow: ensureCanvas,
			advance: { when: () => core.plots.some((p) => p.type === 'scatterplot') }
		},
		wireStep(
			'Plot the Cosinor fit',
			() =>
				wiringHint(
					'Overlay the fitted curve on the Scatterplot:',
					'cosinorx',
					'x',
					'a cosinory',
					'y',
					cosinorFitStatus(),
					'Tip: add your raw activity as a second series to see the fit over the data.'
				),
			() => cosinorFitStatus()
		),
		{
			target: null,
			title: 'Pipeline complete 🎉',
			body: 'You built and wired a full actigraphy pipeline and plotted the rhythm fit. Use <strong>Tidy layout</strong> (bottom-right) to arrange it, and the <strong>Worksheet</strong> view to lay the plots out for a figure. Reopen this tour anytime from the <strong>?</strong> menu.',
			advance: { on: 'next' }
		}
	]
};
