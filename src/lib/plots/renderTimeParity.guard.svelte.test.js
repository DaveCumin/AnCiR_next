// @ts-nocheck
// Render-path parity for EVERY two-input plot: the same data drawn once against a numeric-hours
// x and once against a time column of the same instants must draw the same marks, and some
// marks (not a bare axis). Through the headless render's own path: the engine's
// renderPlotToFiles builds the payload (renderPlot.js is stubbed to capture it instead of
// launching Chromium), and the render page's own mount script (mcp/src/render/mount.js) rebuilds
// the columns and mounts the real plot component, here in happy-dom.
//
// Generalises 2026-11-09 bug 11 (a headless actogram of a time column was blank: the payload's
// epoch-ms instants were re-parsed as ISO text; render.payloadColumn.test.js pins the column).
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { flushSync, tick } from 'svelte';

const captured = vi.hoisted(() => ({ payload: null }));
vi.mock('../../../mcp/src/engine/renderPlot.js', () => ({
	renderPlot: async (payload) => {
		captured.payload = payload;
		return {};
	},
	drawnKind: () => null
}));

const { AncirSession, ensureRegistry } = await import('../../../mcp/src/engine/session.js');
const { appConsts } = await import('$lib/core/core.svelte.js');
await ensureRegistry();

// Two-input plots whose first input is an x or time axis, from the registry.
const TIME_PLOTS = [...appConsts.plotMap]
	.filter(([, e]) => (e.defaultInputs ?? []).length === 2)
	.map(([type]) => type)
	.sort();

// Plots left out, each with why. Every other two-input plot is drawn both ways.
const SKIP = {
	// A categorical x (groups), not a time axis.
	boxplot: 'x is a grouping, not a time axis'
};

const H = 3600000;
const N = 24 * 6;
const T0 = Date.UTC(2024, 3, 1);
const hours = Array.from({ length: N }, (_, i) => i);
const values = hours.map((h) => 50 + 40 * Math.cos((2 * Math.PI * h) / 24) + (h % 5));

beforeAll(() => {
	document.body.innerHTML = '';
});

const MARK = 'path, circle, rect, line, polygon, polyline, ellipse, image, canvas';

/**
 * How much DATA a plot drew: every mark outside its axes, legend and colour scale (whose tick
 * counts differ between a clock axis and an hours axis), a path counted by its drawing commands
 * so a path with no data (`d=""`) counts nothing.
 */
function dataMarks(root) {
	let n = 0;
	for (const el of root.querySelectorAll(MARK)) {
		if (el.closest('.tick, [class*="axis"], .plot-legend, .colour-scale')) continue;
		if (/gridline|domain/.test(el.getAttribute('class') ?? '')) continue;
		if (el.tagName.toLowerCase() === 'path') {
			n += (el.getAttribute('d') ?? '').match(/[MLHVCSQTA]/gi)?.length ?? 0;
		} else if (el.tagName.toLowerCase().startsWith('poly')) {
			n += (el.getAttribute('points') ?? '').trim().split(/\s+/).filter(Boolean).length;
		} else n++;
	}
	return n;
}

/** Mount `type` through the render page's own script, for x given as `xValues` of `xType`. */
async function drawnMarks(type, xType, xValues) {
	const s = new AncirSession(`render-${type}-${xType}`);
	s.importColumns([
		{ name: 'x', type: xType, values: xValues },
		{ name: 'v', values }
	]);
	captured.payload = null;
	await s.renderPlotToFiles(type, ['x', 'v'], { outBase: '/dev/null' });
	expect(captured.payload, `${type}: payload`).toBeTruthy();

	document.body.innerHTML = '<div id="app"></div>';
	for (const k of ['__ancirReady', '__ancirError', '__ancirPlotId']) delete window[k];
	window.__ANCIR_RENDER__ = captured.payload;
	vi.resetModules();
	await import('../../../mcp/src/render/mount.js');
	const t0 = Date.now();
	while (!window.__ancirReady && !window.__ancirError && Date.now() - t0 < 20000) {
		flushSync();
		await tick();
		await new Promise((r) => setTimeout(r, 20));
	}
	expect(window.__ancirError, `${type} (${xType}) render error`).toBeUndefined();
	const svg = document.getElementById('plot' + window.__ancirPlotId);
	return dataMarks(svg ?? document.getElementById('app'));
}

describe('a plot draws the same marks for a time x as for numeric hours', () => {
	it('covers the two-input plots', () => expect(TIME_PLOTS.length).toBeGreaterThanOrEqual(6));

	for (const type of TIME_PLOTS.filter((t) => !SKIP[t])) {
		it(
			type,
			async () => {
				const numeric = await drawnMarks(type, 'number', hours);
				const time = await drawnMarks(
					type,
					'time',
					hours.map((h) => new Date(T0 + h * H).toISOString())
				);
				expect(numeric, `${type}: marks with numeric hours`).toBeGreaterThan(5);
				expect(time, `${type}: marks with a time column (numeric drew ${numeric})`).toBe(numeric);
			},
			60000
		);
	}
});
