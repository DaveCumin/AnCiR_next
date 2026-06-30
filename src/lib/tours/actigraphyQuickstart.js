// actigraphyQuickstart.js — domain hands-on walkthrough for chronobiologists.
// Builds the canonical pipeline AND has the user wire each connection, one axis
// at a time (x first, then y):
//   data → Bin → Scatterplot (raw vs binned) → Actogram → Periodogram →
//   Cosinor → plot the Cosinor fit on a second Scatterplot.
// "Add" steps highlight the whole + palette (like getting-started); each "wire"
// step is an out-of-the-way bottom hint bar (no dim) while the overlay rings the
// exact source/target dot and animates an edge between them. Downstream wire
// steps draw the edge FROM the Bin Data (or Cosinor) node, not the raw source.
// A wire step advances as soon as ITS axis is connected. Loaded on demand.
import { core, appState } from '$lib/core/core.svelte.js';
import {
	findTP,
	tpStatus,
	plotStatus,
	plotSeriesCounts,
	cosinorFitStatus,
	axisHint,
	tpNodeId,
	plotNodeId,
	tpInPortEl,
	plotInPortEl,
	sourceOutElForAxis,
	binnedOutElForAxis,
	cosinorOutElForAxis
} from '$lib/core/tourWiring.js';

const ensureCanvas = () => {
	appState.view = 'canvas';
};

// The + palette: highlight the whole open palette once it's up, falling back to
// the trigger button before it opens (mirrors getting-started).
const paletteTarget = () =>
	document.querySelector('.palette-menu') ?? document.querySelector('.np-trigger');

// One "drag this wire" step: bottom hint bar + a ringed source/target dot with an
// animated edge (`wire`). Advances when `advanceWhen()` is true.
const wireStep = (title, body, advanceWhen, wire) => ({
	target: null,
	dim: false,
	placement: 'screen-bottom',
	title,
	body,
	beforeShow: ensureCanvas,
	wire,
	advance: { when: advanceWhen }
});

// Single-axis convenience: advances when this axis (x|y) of `statusFn()` is ok.
const wireAxisStep = (title, body, statusFn, axis, wire) =>
	wireStep(title, body, () => !!statusFn()[axis === 'x' ? 'xOk' : 'yOk'], wire);

export const tour = {
	id: 'actigraphy-quickstart',
	name: 'Actigraphy quick-start',
	description:
		'Build a circadian pipeline: bin activity, compare raw vs binned on a scatterplot, draw an actogram and periodogram, then fit and plot a cosinor.',
	estMinutes: 9,
	order: 2,
	steps: [
		{
			target: null,
			title: 'Actigraphy quick-start',
			body: 'We’ll build the classic circadian workflow and wire it up by hand, one connection at a time: bin the activity, compare the raw and binned signals on a scatterplot, draw an actogram and a periodogram, then fit a cosinor and plot it. Let’s go.',
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
			target: paletteTarget,
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
			target: paletteTarget,
			placement: 'left',
			title: 'Add a Scatterplot',
			body: 'Add a <strong>“Scatterplot”</strong> — we’ll plot the <strong>raw</strong> signal and the <strong>binned</strong> signal on it side by side, as two series, to see what binning did.',
			beforeShow: ensureCanvas,
			advance: { when: () => core.plots.some((p) => p.type === 'scatterplot') }
		},
		wireStep(
			'Plot the raw signal — time',
			() =>
				axisHint(
					'First series = the raw data. Connect the raw time:',
					'raw time',
					'x',
					plotSeriesCounts('scatterplot').withX >= 1
				),
			() => plotSeriesCounts('scatterplot').withX >= 1,
			{
				from: () => sourceOutElForAxis('x', plotNodeId('scatterplot')),
				to: () => plotInPortEl('scatterplot', 'x1')
			}
		),
		wireStep(
			'Plot the raw signal — activity',
			() =>
				axisHint(
					'Now the raw activity:',
					'raw activity',
					'y',
					plotSeriesCounts('scatterplot').withY >= 1
				),
			() => plotSeriesCounts('scatterplot').withY >= 1,
			{
				from: () => sourceOutElForAxis('y', plotNodeId('scatterplot')),
				to: () => plotInPortEl('scatterplot', 'ys1')
			}
		),
		wireStep(
			'Add the binned signal — time',
			() =>
				axisHint(
					'Second series = the binned data, from the <strong>Bin Data</strong> node. Connect the binned time:',
					'binned time',
					'x (2nd series)',
					plotSeriesCounts('scatterplot').withX >= 2
				),
			() => plotSeriesCounts('scatterplot').withX >= 2,
			{
				from: () => binnedOutElForAxis('x'),
				to: () => plotInPortEl('scatterplot', 'x2')
			}
		),
		wireStep(
			'Add the binned signal — activity',
			() =>
				axisHint(
					'Now the binned activity — the two series now overlay:',
					'binned activity',
					'y (2nd series)',
					plotSeriesCounts('scatterplot').withY >= 2
				),
			() => plotSeriesCounts('scatterplot').withY >= 2,
			{
				from: () => binnedOutElForAxis('y'),
				to: () => plotInPortEl('scatterplot', 'ys2')
			}
		),
		{
			target: paletteTarget,
			placement: 'left',
			title: 'Add an Actogram',
			body: 'Add an <strong>“Actogram”</strong> — the classic double-plotted view of daily rhythms. We’ll feed it the <strong>binned</strong> data.',
			beforeShow: ensureCanvas,
			advance: { when: () => core.plots.some((p) => p.type === 'actogram') }
		},
		wireAxisStep(
			'Wire the binned time → Actogram',
			() =>
				axisHint(
					'Connect the binned time (from the Bin Data node) to the Actogram:',
					'binned time',
					'x',
					plotStatus('actogram').xOk
				),
			() => plotStatus('actogram'),
			'x',
			{
				from: () => binnedOutElForAxis('x'),
				to: () => plotInPortEl('actogram', 'x1')
			}
		),
		wireAxisStep(
			'Wire the binned activity → Actogram',
			() => axisHint('Now the binned activity:', 'binned activity', 'y', plotStatus('actogram').yOk),
			() => plotStatus('actogram'),
			'y',
			{
				from: () => binnedOutElForAxis('y'),
				to: () => plotInPortEl('actogram', 'ys1')
			}
		),
		{
			target: paletteTarget,
			placement: 'left',
			title: 'Add a Periodogram',
			body: 'Add a <strong>“Periodogram”</strong> to estimate the dominant rhythm period (≈24 h) from the binned data.',
			beforeShow: ensureCanvas,
			advance: { when: () => core.plots.some((p) => p.type === 'periodogram') }
		},
		wireAxisStep(
			'Wire the binned time → Periodogram',
			() =>
				axisHint(
					'Connect the binned time to the Periodogram:',
					'binned time',
					'x',
					plotStatus('periodogram').xOk
				),
			() => plotStatus('periodogram'),
			'x',
			{
				from: () => binnedOutElForAxis('x'),
				to: () => plotInPortEl('periodogram', 'x1')
			}
		),
		wireAxisStep(
			'Wire the binned activity → Periodogram',
			() =>
				axisHint('Now the binned activity:', 'binned activity', 'y', plotStatus('periodogram').yOk),
			() => plotStatus('periodogram'),
			'y',
			{
				from: () => binnedOutElForAxis('y'),
				to: () => plotInPortEl('periodogram', 'ys1')
			}
		),
		{
			target: paletteTarget,
			placement: 'left',
			title: 'Add a Cosinor',
			body: 'Add a <strong>“Cosinor”</strong> to fit a cosine model to the binned data — its period, amplitude and acrophase appear as output ports.',
			beforeShow: ensureCanvas,
			advance: { when: () => !!findTP('Cosinor') }
		},
		wireAxisStep(
			'Wire the binned time → Cosinor',
			() =>
				axisHint('Connect the binned time to the Cosinor:', 'binned time', 'xIN', tpStatus('Cosinor').xOk),
			() => tpStatus('Cosinor'),
			'x',
			{
				from: () => binnedOutElForAxis('x'),
				to: () => tpInPortEl('Cosinor', 'xIN')
			}
		),
		wireAxisStep(
			'Wire the binned activity → Cosinor',
			() =>
				axisHint(
					'Now the binned activity — it fits each y you wire in:',
					'binned activity',
					'yIN',
					tpStatus('Cosinor').yOk
				),
			() => tpStatus('Cosinor'),
			'y',
			{
				from: () => binnedOutElForAxis('y'),
				to: () => tpInPortEl('Cosinor', 'yIN')
			}
		),
		{
			target: paletteTarget,
			placement: 'left',
			title: 'Add a Scatterplot for the fit',
			body: 'Add another <strong>“Scatterplot”</strong> — we’ll plot the Cosinor’s fitted curve here.',
			beforeShow: ensureCanvas,
			advance: {
				when: () => core.plots.filter((p) => p.type === 'scatterplot').length >= 2
			}
		},
		wireAxisStep(
			'Plot the Cosinor fit — x',
			() =>
				axisHint(
					'Wire the fitted curve’s x (the Cosinor’s <strong>cosinorx</strong> output) onto the Scatterplot:',
					'cosinorx',
					'x',
					cosinorFitStatus().xOk
				),
			() => cosinorFitStatus(),
			'x',
			{
				from: () => cosinorOutElForAxis('x'),
				to: () => plotInPortEl('scatterplot', 'x1')
			}
		),
		wireAxisStep(
			'Plot the Cosinor fit — y',
			() =>
				axisHint(
					'Now the fitted curve’s y (a <strong>cosinory</strong> output):',
					'cosinory',
					'y',
					cosinorFitStatus().yOk,
					'Tip: add your binned activity as a second series to see the fit over the data.'
				),
			() => cosinorFitStatus(),
			'y',
			{
				from: () => cosinorOutElForAxis('y'),
				to: () => plotInPortEl('scatterplot', 'ys1')
			}
		),
		{
			target: null,
			title: 'Pipeline complete 🎉',
			body: 'You built and wired a full actigraphy pipeline — raw vs binned, an actogram, a periodogram, and a plotted cosinor fit. Use <strong>Tidy layout</strong> (bottom-right) to arrange it, and the <strong>Worksheet</strong> view to lay the plots out for a figure. Reopen this tour anytime from the <strong>?</strong> menu.',
			advance: { on: 'next' }
		}
	]
};
