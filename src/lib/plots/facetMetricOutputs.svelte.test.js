// @ts-nocheck
// A faceted metric plot must keep writing its metric OUTPUT columns (peak_period, ...).
//
// Regression (v77.0, facets as views): the columns were written only by the plot
// component's own metric effect (usePlotMetricOutputs), and a faceted generator is never
// mounted as a component (only its derived panels are, and panels are excluded from metric
// outputs). So while faceted nothing wrote the generator's columns: on the free-running demo
// the periodogram's peak_period port stayed at 24.85 until faceting was turned off, and
// anything wired downstream silently read the old value.
//
// Pins, in BOTH views (the workspace mounts a FacetGroup, the canvas an EmbeddedPlot):
//   - a faceted generator's columns follow a change to its settings or data;
//   - toggling facet on and off never creates a column or changes a column id (downstream
//     wiring holds the ids);
//   - exactly ONE write per change, however many panels there are.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';

// Count every output-column write, passing through to the real implementation.
const writes = vi.hoisted(() => ({ calls: [] }));
vi.mock('$lib/tableProcesses/outputColumns.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		writeOutputColumn: (colId, data, opts) => {
			writes.calls.push({ colId, data: [...data] });
			return actual.writeOutputColumn(colId, data, opts);
		}
	};
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, appState, pushObj } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column, getColumnById } from '$lib/core/Column.svelte';
import { panelsFor } from '$lib/core/facetPanels.svelte.js';
import {
	plotMetricStats,
	plotMetricKeys,
	PLOT_METRIC_DEFS
} from '$lib/plots/plotMetricOutputs.svelte.js';
import { addRule } from '$lib/plots/Actogram/markerRules.svelte.js';
import { history } from '$lib/core/opHistory.svelte.js';
import EmbeddedPlot from '$lib/components/workflow/EmbeddedPlot.svelte';
import WorkspacePlotBranch from '$lib/components/views/__fixtures__/WorkspacePlotBranch.svelte';

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

// Hourly samples over 20 days: a strong rhythm at `main` h plus a weaker one at 12 h, so
// narrowing the visible period range moves the peak from `main` to 12.
const T = Array.from({ length: 480 }, (_, i) => i);
const wave = (main) =>
	T.map((t) => Math.sin((2 * Math.PI * t) / main) + 0.4 * Math.sin((2 * Math.PI * t) / 12));

function makeGenerator(type, mains, { facet = true } = {}) {
	const gen = new Plot({
		type,
		facet,
		x: 60,
		y: 60,
		width: 400,
		height: 250,
		plot: { data: [] }
	});
	const x = mkCol('hour', T);
	for (const m of mains)
		gen.plot.addData({ x: { refId: x }, y: { refId: mkCol(`y${m}`, wave(m)) } });
	if (type === 'fft') {
		// Period axis (as the demos use it), so xlimsIN are hours.
		gen.plot.showPeriod = true;
		gen.plot.xlimsIN = [4, 30];
	}
	core.plots.push(gen);
	return gen;
}

async function settle(ms = 0) {
	await new Promise((r) => queueMicrotask(r));
	await new Promise((r) => setTimeout(r, ms));
	flushSync();
	await new Promise((r) => queueMicrotask(r));
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
}

const colValues = (gen, key) => core.rawData.get(gen.metricOut[key]);
const expectedPeriods = (gen) => plotMetricStats(gen).map((s) => s.peak_period);
const writesTo = (gen, key) => writes.calls.filter((c) => c.colId === gen.metricOut[key]);

// The two places a faceted generator is mounted. A render that is not faceted mounts the
// generator's own plot component in the same slot, as the real views do.
const VIEWS = {
	workspace: (gen) => render(WorkspacePlotBranch, { props: { plot: gen } }),
	canvas: (gen) => render(EmbeddedPlot, { props: { plot: gen, size: { w: 300, h: 200 } } })
};

beforeEach(async () => {
	appConsts.plotMap = await loadPlots();
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	appState.gridSize = 15;
	appState.canvasScale = 1;
	appState.canvasOffset = { x: 0, y: 0 };
	history.init();
	history.clear();
	writes.calls.length = 0;
});
afterEach(() => cleanup());

describe.each(Object.keys(VIEWS))('faceted FFT metric outputs (%s view)', (view) => {
	it('writes the generator stats while faceted and follows a settings change', async () => {
		const gen = makeGenerator('fft', [24, 25, 26]);
		VIEWS[view](gen);
		await settle();
		expect(panelsFor(gen)).toHaveLength(3);

		const keys = PLOT_METRIC_DEFS.fft.keys;
		for (const k of keys) expect(getColumnById(gen.metricOut[k]), k).toBeTruthy();
		const before = colValues(gen, 'peak_period');
		expect(before).toHaveLength(3);
		expect(before).toEqual(expectedPeriods(gen));
		for (const p of before) expect(p).toBeGreaterThan(20);

		// Narrow the visible period range below the main rhythm: the peak moves to ~12 h.
		writes.calls.length = 0;
		gen.plot.xlimsIN = [4, 20];
		await settle();
		const after = colValues(gen, 'peak_period');
		expect(after).toEqual(expectedPeriods(gen));
		for (const p of after) expect(p).toBeLessThan(14);
		// ONE write per key for the change, not one per panel.
		for (const k of keys) expect(writesTo(gen, k), k).toHaveLength(1);
	});

	it('follows a change to the input data while faceted', async () => {
		const gen = makeGenerator('fft', [24, 24]);
		VIEWS[view](gen);
		await settle();
		expect(colValues(gen, 'peak_period')[1]).toBeCloseTo(24, 0);

		// Rewire the second series to an 18 h rhythm (a rebuilt panel, a new unit key).
		gen.plot.data[1].y = new Column({ refId: mkCol('y18', wave(18)) });
		await settle();
		const periods = colValues(gen, 'peak_period');
		expect(periods).toEqual(expectedPeriods(gen));
		expect(periods[1]).toBeCloseTo(18, 0);
	});

	it('toggling facet keeps the same columns, ids and values, with no duplicate writes', async () => {
		const gen = makeGenerator('fft', [24, 25, 26], { facet: false });
		VIEWS[view](gen);
		await settle();
		const ids = { ...gen.metricOut };
		const colCount = core.data.length;
		const values = colValues(gen, 'peak_period');
		expect(values).toEqual(expectedPeriods(gen));

		writes.calls.length = 0;
		for (const facet of [true, false, true, false, true]) {
			gen.facet = facet;
			await settle();
			expect(gen.metricOut).toEqual(ids);
			expect(core.data.length).toBe(colCount);
			expect(colValues(gen, 'peak_period')).toEqual(values);
		}
		// Nothing changed, so a toggle writes nothing (the stats are the generator's either way).
		expect(writes.calls).toHaveLength(0);

		// Still live after all that toggling, while faceted.
		gen.plot.xlimsIN = [4, 20];
		await settle();
		expect(colValues(gen, 'peak_period')).toEqual(expectedPeriods(gen));
		for (const p of colValues(gen, 'peak_period')) expect(p).toBeLessThan(14);
		expect(gen.metricOut).toEqual(ids);
		expect(core.data.length).toBe(colCount);
	});
});

// The periodogram is the case a headless read of the generator cannot cover: its spectrum
// is $state filled by the COMPONENT's calculation effect, so with no generator instance
// mounted the generator's own peak never recomputes. The fix must run that effect too.
describe.each(Object.keys(VIEWS))('faceted periodogram metric outputs (%s view)', (view) => {
	it('recomputes and writes when a data setting changes while faceted', async () => {
		const gen = makeGenerator('periodogram', [24, 26]);
		gen.plot.periodlimsIN = [20, 30];
		gen.plot.periodSteps = 0.1;
		VIEWS[view](gen);
		await settle(600);
		const first = colValues(gen, 'peak_period');
		expect(first).toHaveLength(2);
		expect(first[0]).toBeCloseTo(24, 0);
		expect(first[1]).toBeCloseTo(26, 0);
		expect(colValues(gen, 'peak_pvalue').every((p) => Number.isNaN(p))).toBe(true);

		// Chi-squared gives every peak a p-value; the generator must recompute to know it.
		writes.calls.length = 0;
		for (const d of gen.plot.data) d.method = 'Chi-squared';
		await settle(800);
		const pv = colValues(gen, 'peak_pvalue');
		expect(pv.every((p) => Number.isFinite(p))).toBe(true);
		expect(colValues(gen, 'peak_period')).toEqual(expectedPeriods(gen));
		// Each series' spectrum lands on its own (debounced, per-series), so up to one write
		// per series; never one per panel on top of that.
		expect(writesTo(gen, 'peak_pvalue').length).toBeGreaterThanOrEqual(1);
		expect(writesTo(gen, 'peak_pvalue').length).toBeLessThanOrEqual(gen.plot.data.length);
	});
});

// The actogram's outputs are its MARKER RULES' ports (five per rule, plotMetricDefs.js). Its
// def made it a metric type, so the facet host mounts the generator headless and the
// generator writes the rule columns exactly once per change, however many panels there are.
describe.each(Object.keys(VIEWS))('faceted actogram marker-rule outputs (%s view)', (view) => {
	function restGenerator() {
		const session = JSON.parse(
			readFileSync(
				join(process.cwd(), 'static/sessions/demos/demo-workflow-rest-activity.json'),
				'utf8'
			)
		);
		core.rawData = new Map(Object.entries(session.rawData ?? {}).map(([k, v]) => [+k, v]));
		for (const cd of session.data ?? []) pushObj(Column.fromJSON(cd));
		const pj = session.plots.find((p) => p.type === 'actogram');
		pj.facet = true;
		pj.width = 600;
		pj.height = 500;
		const gen = Plot.fromJSON(pj);
		core.plots.push(gen);
		addRule(gen.plot, { type: 'onset', templateHrsBefore: 3, templateHrsAfter: 3 });
		return gen;
	}
	const expectedRule = (gen, key) => plotMetricStats(gen).map((s) => s[key]);

	it('writes every rule column once per change, from the generator, while faceted', async () => {
		const gen = restGenerator();
		VIEWS[view](gen);
		await settle();
		expect(panelsFor(gen)).toHaveLength(2);
		const keys = plotMetricKeys(gen);
		expect(keys).toEqual(['r1_tau', 'r1_phi', 'r1_r2', 'r1_rmse', 'r1_n']);
		for (const k of keys) expect(getColumnById(gen.metricOut[k]), k).toBeTruthy();
		expect(colValues(gen, 'r1_phi')[0]).toBeCloseTo(7.357, 3);
		expect(colValues(gen, 'r1_phi')[1]).toBeCloseTo(6.18, 3);
		const ids = { ...gen.metricOut };
		const before = colValues(gen, 'r1_tau');

		writes.calls.length = 0;
		gen.plot.markerRules[0].centileThreshold = 80;
		await settle();
		expect(colValues(gen, 'r1_tau')).toEqual(expectedRule(gen, 'r1_tau'));
		expect(colValues(gen, 'r1_tau')).not.toEqual(before);
		expect(gen.metricOut).toEqual(ids);
		// ONE write per key for the change, not one per panel.
		for (const k of keys) expect(writesTo(gen, k), k).toHaveLength(1);
	});
});
