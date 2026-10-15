// Browser-side mount entry for headless plot rendering.
//
// Runs in a real Chromium page (served by Vite, so $lib resolves and Svelte
// compiles for the client). Reads a render payload injected by Playwright on
// `window.__ANCIR_RENDER__`, rebuilds the columns + plot in AnCiR's real `core`,
// mounts the real plot component, and signals readiness via `window.__ancirReady`.
//
// Payload shape (see src/engine/renderPlot.js):
//   { columns:[{id,name,type,values[]}], plot:{type, inputs, overlays?, settings?}, width, height }
// `settings` (payload only; no tool sets it) assigns plain plot fields after the series are
// wired, e.g. an FFT's `{ showPeriod: false, xlimsIN: [0, 0.1] }`. Only a field the plot
// already has, with a value of the same type (or an array of the same length), is accepted;
// anything else is refused, never ignored.
// `overlays` (reference lines / bands, on a plot whose class declares
// `overlayCapabilities`) is OverlayClass JSON with the column refIds already renumbered to
// the payload's compact ids. The session validated it per plot; a kind or form the plot
// does not allow is refused here too rather than coerced into another.
import { mount, flushSync } from 'svelte';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { loadPlots } from '$lib/plots/plotMap.js';
import { OverlayClass } from '$lib/components/plotbits/Overlay.svelte';
import { allowedForms, capabilitiesOf } from '$lib/components/plotbits/overlaySpec.js';
import { convertToImage } from '$lib/components/plotbits/helpers/save.svelte.js';

async function run() {
	const data = window.__ANCIR_RENDER__;
	if (!data) throw new Error('no render payload (window.__ANCIR_RENDER__)');

	appConsts.plotMap = await loadPlots();

	// Fresh core slices.
	core.rawData.clear();
	core.data.length = 0;
	core.plots.length = 0;

	// Rebuild columns, preserving the ids the payload references.
	for (const c of data.columns) {
		core.rawData.set(c.id, (c.values ?? []).slice());
		const col = Column.fromJSON({
			id: c.id,
			name: c.name ?? `col_${c.id}`,
			type: c.type ?? 'number',
			data: c.id,
			processes: []
		});
		if (c.type === 'time') col.timeFormat = 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]';
		col.customName = c.name ?? `col_${c.id}`;
		core.data.push(col);
	}

	const entry = appConsts.plotMap.get(data.plot.type);
	if (!entry) throw new Error(`unknown plot type ${data.plot.type}`);

	const p = new Plot({
		name: data.plot.type,
		type: data.plot.type,
		width: data.width ?? 700,
		height: data.height ?? 420
	});

	if (data.plot.type === 'tableplot') {
		const ids = Array.isArray(data.plot.inputs)
			? data.plot.inputs
			: Object.values(data.plot.inputs);
		p.plot.columnRefs = [...ids];
		p.plot.showCol = ids.map(() => true);
	} else {
		const fields = entry.defaultInputs ?? [];
		const dataIn = {};
		for (const f of fields) {
			const id = Array.isArray(data.plot.inputs)
				? data.plot.inputs[fields.indexOf(f)]
				: data.plot.inputs[f];
			if (id != null) dataIn[f] = { refId: id };
		}
		if (Object.keys(dataIn).length) p.plot.addData(dataIn);
	}
	for (const [key, value] of Object.entries(data.plot.settings ?? {})) {
		const current = p.plot[key];
		// A pair of limits (`xlimsIN`) replaces one of the same length; anything else must be a
		// boolean, number or string replacing one of the same type.
		const sameShape = Array.isArray(current)
			? Array.isArray(value) && value.length === current.length
			: current != null && typeof current !== 'object' && typeof current === typeof value;
		if (!sameShape) throw new Error(`${data.plot.type} has no setting "${key}" of that shape`);
		p.plot[key] = Array.isArray(value) ? [...value] : value;
	}
	const caps = capabilitiesOf(p.plot);
	for (const o of data.plot.overlays ?? []) {
		if (!Array.isArray(p.plot.overlays) || !caps) {
			throw new Error(`${data.plot.type} has no overlays`);
		}
		if (!allowedForms(caps, o.kind).includes(o.form)) {
			throw new Error(`${data.plot.type} has no ${o.kind} of form "${o.form}"`);
		}
		p.plot.overlays.push(OverlayClass.fromJSON(p.plot, o));
	}
	core.plots.push(p);

	mount(entry.plot, {
		target: document.getElementById('app'),
		props: { theData: p, which: 'plot' }
	});
	flushSync();

	// Expose the plot id + the GUI's own export function, so the orchestrator
	// rasterises through the exact same path as the app's "export PNG/SVG" buttons
	// (SVG → canvas → toDataURL for PNG; outerHTML → Blob for SVG).
	window.__ancirPlotId = p.id;
	window.__ancirExport = (filetype) => convertToImage('plot' + p.id, filetype);

	// A plot that computes its series asynchronously (the Periodogram: a 250 ms debounce, then
	// a worker or a timer) must finish before the export, or the picture has axes and overlays
	// but no spectrum. Wait until no series is calculating and each one that holds a computed
	// spectrum (`periodData`) has one, or failed; bounded, so a plot that never computes still
	// renders what it has.
	const settled = () =>
		(p.plot.data ?? []).every(
			(d) => !d?.calculating && (!d?.periodData || d.periodData.x?.length > 0 || d.calcError)
		);
	const started = Date.now();
	while (!settled() && Date.now() - started < 15000) {
		await new Promise((r) => setTimeout(r, 50));
	}

	// Let onMount effects (axis auto-scaling, etc.) settle before signalling ready.
	await new Promise((r) => setTimeout(r, 150));
	window.__ancirReady = true;
}

run().catch((e) => {
	window.__ancirError = e?.message || String(e);
	console.error('AnCiR render error:', e);
});
