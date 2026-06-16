// tourWiring.js — shared wiring-state helpers for hands-on tour steps.
// Two jobs: (1) tell a wire step whether wiring is COMPLETE (so it only advances
// once every required port is connected, not after a single wire), and (2) build
// a live "what's left" hint that ticks off each input as the user connects it.
// Kept in core/ (not tours/) so the tours glob doesn't treat it as a tour.
// Reads of core.* happen at call time; callers invoke these inside $derived /
// $effect (TourOverlay), so the reads are reactively tracked.
import { core } from '$lib/core/core.svelte.js';

export const findTP = (name) => (core.tableProcesses ?? []).find((tp) => tp.name === name);

// Most-recently-added plot of a type — the one the tour just had the user add.
export const lastPlot = (type) => [...core.plots].reverse().find((p) => p.type === type);

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
