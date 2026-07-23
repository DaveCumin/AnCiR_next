// tourWiring.js — shared wiring-state helpers for hands-on tour steps.
// Two jobs: (1) tell a wire step whether wiring is COMPLETE (so it only advances
// once every required port is connected, not after a single wire), and (2) build
// a live "what's left" hint that ticks off each input as the user connects it.
// Kept in core/ (not tours/) so the tours glob doesn't treat it as a tour.
// Reads of core.* happen at call time; callers invoke these inside $derived /
// $effect (TourOverlay), so the reads are reactively tracked.
import { core } from '$lib/core/core.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';

export const findTP = (name) => (core.tableProcesses ?? []).find((tp) => tp.name === name);

// Most-recently-added plot of a type — the one the tour just had the user add.
export const lastPlot = (type) => [...core.plots].reverse().find((p) => p.type === type);

// --- Port-element resolvers for the tour's "highlight ports + animated edge" ---
// The workflow node ids mirror ProcessNode.svelte.js: `tableprocess_<id>`,
// `plot_<id>`, `data_<id>`. Port dots carry data-node-id / data-port-name /
// data-port-dir so the tour can find the exact dot to ring and wire to/from.
export const tpNodeId = (name) => {
	const t = findTP(name);
	return t ? `tableprocess_${t.id}` : null;
};
export const plotNodeId = (type) => {
	const p = lastPlot(type);
	return p ? `plot_${p.id}` : null;
};
export const portEl = (nodeId, portName, dir) => {
	if (!nodeId || typeof document === 'undefined') return null;
	const dirSel = dir ? `[data-port-dir="${dir}"]` : '';
	return document.querySelector(
		`[data-node-id="${nodeId}"][data-port-name="${portName}"]${dirSel}`
	);
};
export const tpInPortEl = (name, portName) => portEl(tpNodeId(name), portName, 'in');
export const plotInPortEl = (type, portName) => portEl(plotNodeId(type), portName, 'in');

// OUTPUT dots on a table-process node — the demo-edge SOURCE for steps that wire
// FROM an analysis node (Bin Data, Cosinor) rather than from the raw data source.
// A TP output dot's DOM port name is `col_<colId>` (see buildTPOutputs), while
// `args.out` maps the semantic output key (e.g. `binnedx`, `cosinory_<id>`) to
// that column id — so resolve key → colId → dot. `tpOutPortEl` takes an exact
// key; `tpOutPortElByPrefix` takes the first key starting with `prefix` (for the
// dynamic per-Y outputs `binnedy_*` / `cosinory_*`).
const tpOutDotForColId = (name, colId) => {
	if (typeof colId !== 'number' || colId < 0) return null;
	return portEl(tpNodeId(name), `col_${colId}`, 'out');
};
export const tpOutPortEl = (name, key) => tpOutDotForColId(name, findTP(name)?.args?.out?.[key]);
export const tpOutPortElByPrefix = (name, prefix) => {
	const out = findTP(name)?.args?.out ?? {};
	const entry = Object.entries(out).find(
		([k, v]) => k.startsWith(prefix) && typeof v === 'number' && v >= 0
	);
	return entry ? tpOutDotForColId(name, entry[1]) : null;
};

// Axis-aware sources from the canonical analysis nodes: x = the scalar output,
// y = the first per-Y output. So downstream wire steps draw the edge from the
// Bin Data / Cosinor node, not from the raw simulated-data source.
export const binnedOutElForAxis = (axis) =>
	axis === 'y' ? tpOutPortElByPrefix('BinnedData', 'binnedy_') : tpOutPortEl('BinnedData', 'binnedx');
export const cosinorOutElForAxis = (axis) =>
	axis === 'y' ? tpOutPortElByPrefix('Cosinor', 'cosinory_') : tpOutPortEl('Cosinor', 'cosinorx');

// Type-agnostic: the named input dot on the LAST plot node on the canvas
// (getting-started lets the user pick any plot type).
export const anyPlotInPortEl = (portName) => {
	if (typeof document === 'undefined') return null;
	const dots = [...document.querySelectorAll(`[data-port-dir="in"][data-port-name="${portName}"]`)].filter(
		(d) => (d.getAttribute('data-node-id') || '').startsWith('plot_')
	);
	return dots[dots.length - 1] || null;
};

// Candidate SOURCE output dots to animate the demo edge from: output dots on a
// raw DATA node only.
//
// Restricting to data nodes matters: once a plot is wired it sprouts its OWN
// output dot (a wired actogram gains a `col_0` out port on `plot_*`), and that
// dot lands FIRST in document order — which used to shift the positional y-source
// pick off the data column and onto the time column at the "connect y" step.
// Sources are groups (`group_*`) or bare data nodes (`data_*`); plots
// (`plot_*`) and analyses (`tableprocess_*`) are not.
const isSourceNodeId = (nodeId) =>
	!!nodeId && (nodeId.startsWith('group_') || nodeId.startsWith('data_'));

const sourceOutDots = (excludeNodeId) => {
	if (typeof document === 'undefined') return [];
	const all = [...document.querySelectorAll('[data-port-dir="out"]')].filter((d) => {
		const nodeId = d.getAttribute('data-node-id');
		return nodeId !== excludeNodeId && isSourceNodeId(nodeId);
	});
	const named = all.filter((d) => d.getAttribute('data-port-name') !== 'all');
	return named.length ? named : all;
};

// The column a source dot points at. Its DOM port name is `col_<columnId>`
// (see GroupNode), so the id resolves straight to the column and its type.
const columnForDot = (dot) => {
	const m = /^col_(\d+)$/.exec(dot?.getAttribute('data-port-name') ?? '');
	return m ? (getColumnById(Number(m[1])) ?? null) : null;
};
const isTimeDot = (dot) => columnForDot(dot)?.type === 'time';

// A representative source output dot for the demo edge. First non-`all` output.
export const firstSourceOutEl = (excludeNodeId) => sourceOutDots(excludeNodeId)[0] ?? null;

// Axis-aware source: pick the dot by the COLUMN'S TYPE, not by position. The x
// edge comes from the time column, the y edge from the first non-time (value)
// column — so the demo never draws the y wire from the time output regardless of
// how many dots exist or what order the DOM puts them in. Falls back to
// positional order when the types don't disambiguate (e.g. no time column).
export const sourceOutElForAxis = (axis, excludeNodeId) => {
	const dots = sourceOutDots(excludeNodeId);
	if (!dots.length) return null;
	const xDot = dots.find(isTimeDot) ?? dots[0];
	if (axis !== 'y') return xDot;
	// y is the first VALUE column — a non-time dot that isn't already the x pick. When nothing
	// disambiguates (no time column), fall back to the second dot, then the first.
	return dots.find((d) => d !== xDot && !isTimeDot(d)) ?? dots.find((d) => d !== xDot) ?? dots[0];
};

// Wiring state for a multi-Y table process: needs an x input and ≥1 y input.
export const tpStatus = (name) => {
	const t = findTP(name);
	const xOk = !!t && (t.args?.xIN ?? -1) >= 0;
	const yOk = !!t && Array.isArray(t.args?.yIN) && t.args.yIN.length > 0;
	return { xOk, yOk, done: xOk && yOk };
};

const seriesXOk = (d) => (d?.x?.refId ?? -1) >= 0;
const seriesYOk = (d) => (d?.y?.refId ?? -1) >= 0;

// Wiring state for a specific plot type: COMPLETE = one series has BOTH x and y.
export const plotStatus = (type) => {
	const series = lastPlot(type)?.plot?.data ?? [];
	return {
		xOk: series.some(seriesXOk),
		yOk: series.some(seriesYOk),
		done: series.some((d) => seriesXOk(d) && seriesYOk(d))
	};
};

// How many of a plot's series carry x / y. Lets a multi-series wire step advance
// independently of the previous one — e.g. raw on series 1 (x1/ys1), binned on
// series 2 (x2/ys2): `withX >= 2` means the second x is now wired.
export const plotSeriesCounts = (type) => {
	const series = lastPlot(type)?.plot?.data ?? [];
	return {
		withX: series.filter(seriesXOk).length,
		withY: series.filter(seriesYOk).length
	};
};

// Type-agnostic: is ANY plot fully wired? (getting-started lets the user pick.)
// columnRefs ≥ 2 is accepted as a fallback for plots that wire via columnRefs.
export const anyPlotStatus = () => {
	let xOk = false;
	let yOk = false;
	let done = false;
	for (const p of core.plots) {
		const series = p?.plot?.data ?? [];
		if (series.some(seriesXOk)) xOk = true;
		if (series.some(seriesYOk)) yOk = true;
		if (series.some((d) => seriesXOk(d) && seriesYOk(d))) done = true;
		if ((p?.plot?.columnRefs?.length ?? 0) >= 2) {
			xOk = yOk = done = true;
		}
	}
	return { xOk, yOk, done };
};

// Wiring state for "the Cosinor fit is plotted on a scatterplot": one scatterplot
// series must carry the fitted curve — cosinorx on x AND a cosinory_* on y.
export const cosinorFitStatus = () => {
	const out = findTP('Cosinor')?.args?.out ?? {};
	const xId = typeof out.cosinorx === 'number' ? out.cosinorx : -1;
	const yIds = new Set(
		Object.entries(out)
			.filter(([k, v]) => k.startsWith('cosinory_') && typeof v === 'number' && v >= 0)
			.map(([, v]) => v)
	);
	const series = lastPlot('scatterplot')?.plot?.data ?? [];
	return {
		xOk: xId >= 0 && series.some((d) => d?.x?.refId === xId),
		yOk: series.some((d) => yIds.has(d?.y?.refId)),
		done: xId >= 0 && series.some((d) => d?.x?.refId === xId && yIds.has(d?.y?.refId))
	};
};

// Build a live hint: an intro line, a tick-list of the two inputs, and a nudge
// telling the user exactly which port is still missing. Returns HTML (the tour
// tooltip renders body with @html; all copy here is developer-authored).
export const wiringHint = (intro, xLabel, xPort, yLabel, yPort, status, tip = '') => {
	const row = (ok, what, port) =>
		`${ok ? '✅' : '⬜️'} ${what} → <strong>${port}</strong>`;
	let nudge;
	if (status.done) nudge = 'Both connected — moving on…';
	else if (!status.xOk && !status.yOk) nudge = 'Drag both wires to continue.';
	else if (!status.xOk) nudge = `Almost — now wire ${xLabel} → <strong>${xPort}</strong>.`;
	else nudge = `Almost — now wire ${yLabel} → <strong>${yPort}</strong>.`;
	const tipHtml = tip ? `<br><span class="tour-tip">${tip}</span>` : '';
	return `${intro}<br><br>${row(status.xOk, xLabel, xPort)}<br>${row(
		status.yOk,
		yLabel,
		yPort
	)}<br><br><em>${nudge}</em>${tipHtml}`;
};

// Single-axis hint for the split "wire x, then wire y" steps. `ok` ticks the line
// and switches the nudge to a confirmation.
export const axisHint = (intro, label, port, ok, tip = '') => {
	const nudge = ok ? 'Connected — moving on…' : `Drag <strong>${label}</strong> onto <strong>${port}</strong>.`;
	const tipHtml = tip ? `<br><span class="tour-tip">${tip}</span>` : '';
	return `${intro}<br><br>${ok ? '✅' : '⬜️'} ${label} → <strong>${port}</strong><br><br><em>${nudge}</em>${tipHtml}`;
};
