// actigraphyQuickstart.js — domain hands-on walkthrough for chronobiologists.
// Builds the canonical pipeline AND has the user wire each connection, one axis
// at a time (x first, then y): data → Bin → Actogram, Periodogram, Cosinor →
// plot the Cosinor fit on a Scatterplot. "Add" steps highlight the + palette;
// each "wire" step is an out-of-the-way bottom hint bar (no dim) while the
// overlay rings the exact source/target dot and animates an edge between them.
// A wire step advances as soon as ITS axis is connected. Loaded on demand.
import { core, appState } from '$lib/core/core.svelte.js';
import {
	findTP,
	tpStatus,
	plotStatus,
	cosinorFitStatus,
	axisHint,
	tpNodeId,
	plotNodeId,
	tpInPortEl,
	plotInPortEl,
	sourceOutElForAxis
} from '$lib/core/tourWiring.js';

const ensureCanvas = () => {
	appState.view = 'canvas';
};

// One single-axis "drag this wire" step: bottom hint bar + a ringed source/target
// dot with an animated edge (`wire`). Advances when this axis (x|y) is connected.
const wireAxisStep = (title, body, statusFn, axis, wire) => ({
	target: null,
	dim: false,
	placement: 'screen-bottom',
	title,
	body,
	beforeShow: ensureCanvas,
	wire,
	advance: { when: () => !!statusFn()[axis === 'x' ? 'xOk' : 'yOk'] }
});

export const tour = {
	id: 'actigraphy-quickstart',
	name: 'Actigraphy quick-start',
	description: 'Build a circadian pipeline: data → Bin → Actogram → Periodogram → Cosinor fit.',
	estMinutes: 7,
	order: 2,
	steps: [
		{
			target: null,
			title: 'Actigraphy quick-start',
			body: 'We’ll build the classic circadian workflow and wire it up by hand, one connection at a time: bin activity, draw an actogram, find the period, fit a rhythm, and plot the fit. Let’s go.',
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
		wireAxisStep(
			'Wire the time → Bin Data',
			() => axisHint('First, connect your time column:', 'time', 'xIN', tpStatus('BinnedData').xOk),
			() => tpStatus('BinnedData'),
			'x',
			{
				from: () => sourceOutElForAxis('x', tpNodeId('BinnedData')),
				to: () => tpInPortEl('BinnedData', 'xIN')
			}
		),
		wireAxisStep(
			'Wire the activity → Bin Data',
			() =>
				axisHint('Now connect your activity column:', 'activity', 'yIN', tpStatus('BinnedData').yOk),
			() => tpStatus('BinnedData'),
			'y',
			{
				from: () => sourceOutElForAxis('y', tpNodeId('BinnedData')),
				to: () => tpInPortEl('BinnedData', 'yIN')
			}
		),
		{
			target: '.np-trigger',
			placement: 'left',
			title: 'Add an Actogram',
			body: 'Add an <strong>“Actogram”</strong> — the classic double-plotted view of daily rhythms.',
			beforeShow: ensureCanvas,
			advance: { when: () => core.plots.some((p) => p.type === 'actogram') }
		},
		wireAxisStep(
			'Wire the binned time → Actogram',
			() => axisHint('Connect the binned time to the Actogram:', 'binned time', 'x', plotStatus('actogram').xOk),
			() => plotStatus('actogram'),
			'x',
			{
				from: () => sourceOutElForAxis('x', plotNodeId('actogram')),
				to: () => plotInPortEl('actogram', 'x1')
			}
		),
		wireAxisStep(
			'Wire the binned activity → Actogram',
			() => axisHint('Now the binned activity:', 'binned activity', 'y', plotStatus('actogram').yOk),
			() => plotStatus('actogram'),
			'y',
			{
				from: () => sourceOutElForAxis('y', plotNodeId('actogram')),
				to: () => plotInPortEl('actogram', 'ys1')
			}
		),
		{
			target: '.np-trigger',
			placement: 'left',
			title: 'Add a Periodogram',
			body: 'Add a <strong>“Periodogram”</strong> to estimate the dominant rhythm period (≈24 h).',
			beforeShow: ensureCanvas,
			advance: { when: () => core.plots.some((p) => p.type === 'periodogram') }
		},
		wireAxisStep(
			'Wire the time → Periodogram',
			() => axisHint('Connect your time to the Periodogram:', 'time', 'x', plotStatus('periodogram').xOk),
			() => plotStatus('periodogram'),
			'x',
			{
				from: () => sourceOutElForAxis('x', plotNodeId('periodogram')),
				to: () => plotInPortEl('periodogram', 'x1')
			}
		),
		wireAxisStep(
			'Wire the activity → Periodogram',
			() => axisHint('Now your activity:', 'activity', 'y', plotStatus('periodogram').yOk),
			() => plotStatus('periodogram'),
			'y',
			{
				from: () => sourceOutElForAxis('y', plotNodeId('periodogram')),
				to: () => plotInPortEl('periodogram', 'ys1')
			}
		),
		{
			target: '.np-trigger',
			placement: 'left',
			title: 'Add a Cosinor',
			body: 'Add a <strong>“Cosinor”</strong> to fit a cosine model — its period, amplitude and acrophase appear as output ports.',
			beforeShow: ensureCanvas,
			advance: { when: () => !!findTP('Cosinor') }
		},
		wireAxisStep(
			'Wire the time → Cosinor',
			() => axisHint('Connect your time to the Cosinor:', 'time', 'xIN', tpStatus('Cosinor').xOk),
			() => tpStatus('Cosinor'),
			'x',
			{
				from: () => sourceOutElForAxis('x', tpNodeId('Cosinor')),
				to: () => tpInPortEl('Cosinor', 'xIN')
			}
		),
		wireAxisStep(
			'Wire the activity → Cosinor',
			() =>
				axisHint('Now your activity — it fits each y you wire in:', 'activity', 'yIN', tpStatus('Cosinor').yOk),
			() => tpStatus('Cosinor'),
			'y',
			{
				from: () => sourceOutElForAxis('y', tpNodeId('Cosinor')),
				to: () => tpInPortEl('Cosinor', 'yIN')
			}
		),
		{
			target: '.np-trigger',
			placement: 'left',
			title: 'Add a Scatterplot for the fit',
			body: 'Add a <strong>“Scatterplot”</strong> — we’ll overlay the Cosinor fit on your data here.',
			beforeShow: ensureCanvas,
			advance: { when: () => core.plots.some((p) => p.type === 'scatterplot') }
		},
		wireAxisStep(
			'Plot the Cosinor fit — x',
			() => axisHint('Wire the fitted curve’s x onto the Scatterplot:', 'cosinorx', 'x', cosinorFitStatus().xOk),
			() => cosinorFitStatus(),
			'x',
			{
				from: () => sourceOutElForAxis('x', plotNodeId('scatterplot')),
				to: () => plotInPortEl('scatterplot', 'x1')
			}
		),
		wireAxisStep(
			'Plot the Cosinor fit — y',
			() =>
				axisHint(
					'Now the fitted curve’s y:',
					'a cosinory',
					'y',
					cosinorFitStatus().yOk,
					'Tip: add your raw activity as a second series to see the fit over the data.'
				),
			() => cosinorFitStatus(),
			'y',
			{
				from: () => sourceOutElForAxis('y', plotNodeId('scatterplot')),
				to: () => plotInPortEl('scatterplot', 'ys1')
			}
		),
		{
			target: null,
			title: 'Pipeline complete 🎉',
			body: 'You built and wired a full actigraphy pipeline and plotted the rhythm fit. Use <strong>Tidy layout</strong> (bottom-right) to arrange it, and the <strong>Worksheet</strong> view to lay the plots out for a figure. Reopen this tour anytime from the <strong>?</strong> menu.',
			advance: { on: 'next' }
		}
	]
};
