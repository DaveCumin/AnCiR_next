// Browser-side mount entry for headless plot rendering.
//
// Runs in a real Chromium page (served by Vite, so $lib resolves and Svelte
// compiles for the client). Reads a render payload injected by Playwright on
// `window.__ANCIR_RENDER__`, rebuilds the columns + plot in AnCiR's real `core`,
// mounts the real plot component, and signals readiness via `window.__ancirReady`.
//
// Payload shape (see src/engine/renderPlot.js):
//   { columns:[{id,name,type,values[]}], plot:{type, inputs}, width, height }
import { mount, flushSync } from 'svelte';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { loadPlots } from '$lib/plots/plotMap.js';
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

	// Let onMount effects (axis auto-scaling, etc.) settle before signalling ready.
	await new Promise((r) => setTimeout(r, 150));
	window.__ancirReady = true;
}

run().catch((e) => {
	window.__ancirError = e?.message || String(e);
	// eslint-disable-next-line no-console
	console.error('AnCiR render error:', e);
});
