// @ts-nocheck
// Actogram markers on a facet PANEL write through to the GENERATOR (plan
// 2026-09-26-facets-as-views, Phase 1 risk and risk 6): a panel's series are projected
// copies, so a marker placed or a line dragged on panel 2 must land on generator series 2's
// marker and on no other, or the next projection would erase it. Driven through the real
// components with real events, over the real shipped free-running demo.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup } from '@testing-library/svelte';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { panelsFor, projectPanel, panelSeriesTarget } from '$lib/core/facetPanels.svelte.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import PhaseMarker from './PhaseMarker.svelte';
import Actogram from './Actogram.svelte';

const SESSION = join(
	process.cwd(),
	'static',
	'sessions',
	'demos',
	'demo-workflow-free-running.json'
);

const ONSET = {
	name: 'marker_0',
	type: 'onset',
	centileThreshold: 50,
	templateHrsBefore: 3,
	templateHrsAfter: 3,
	colour: '#234154',
	showLine: true,
	showMarkers: true,
	lineWidth: 1,
	markerSize: 5,
	manualMarkers: []
};
const MANUAL = { ...ONSET, name: 'manual_0', type: 'manual', showLine: false };

/** A two-series faceted actogram generator: the demo's series, then a second copy of it. */
function facetedActogram(block) {
	const session = JSON.parse(readFileSync(SESSION, 'utf8'));
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.storedValues = {};
	core.rawData = new Map(Object.entries(session.rawData ?? {}).map(([k, v]) => [+k, v]));
	for (const cd of session.data ?? []) pushObj(Column.fromJSON(cd));

	const plotJson = session.plots.find((p) => p.type === 'actogram');
	const s0 = structuredClone(plotJson.plot.data[0]);
	const s1 = structuredClone(plotJson.plot.data[0]);
	s0.phaseMarkers = [structuredClone(block)];
	s1.phaseMarkers = [structuredClone(block)];
	delete s0.x.id;
	delete s0.y.id;
	delete s1.x.id;
	delete s1.y.id;
	plotJson.plot.data = [s0, s1];
	plotJson.facet = true;
	plotJson.width = 600;
	plotJson.height = 500;
	const gen = Plot.fromJSON(plotJson);
	core.plots.push(gen);
	const panels = panelsFor(gen);
	expect(panels).toHaveLength(2);
	for (const p of panels) projectPanel(p);
	return { gen, panels };
}

function pointOnLine(marker, d) {
	const p = marker.parentData.parentPlot;
	const reg = marker.linearRegression;
	const tod = (reg.slope - p.periodHrs) * d + reg.intercept;
	return {
		x: (tod / (p.periodHrs * p.doublePlot)) * p.plotwidth + p.padding.left,
		y: p.padding.top + d * (p.eachplotheight + p.spaceBetween)
	};
}
function renderInSvg(marker) {
	const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	document.body.appendChild(host);
	const r = render(PhaseMarker, { props: { marker, which: 'plot' } }, { container: host });
	return { container: r.container };
}
function fire(target, type, { x, y }) {
	target.dispatchEvent(
		new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
	);
}
function drag(container, from, to, steps = 4) {
	const el = container.querySelector('.line-handle');
	expect(el).toBeTruthy();
	fire(el, 'pointerdown', from);
	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		fire(window, 'pointermove', {
			x: from.x + (to.x - from.x) * t,
			y: from.y + (to.y - from.y) * t
		});
	}
	fire(window, 'pointerup', to);
}
function clickAt(svg, offsetX, offsetY) {
	const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
	Object.defineProperty(e, 'offsetX', { value: offsetX });
	Object.defineProperty(e, 'offsetY', { value: offsetY });
	svg.dispatchEvent(e);
}

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
});
beforeEach(() => {
	history.init();
	history.clear();
});
afterEach(() => cleanup());

describe('panelSeriesTarget', () => {
	it('maps panel j-th series to the generator series it copies, and null off a plot', () => {
		const { gen, panels } = facetedActogram(ONSET);
		expect(panelSeriesTarget(panels[0], 0)).toBe(gen.plot.data[0]);
		expect(panelSeriesTarget(panels[1], 0)).toBe(gen.plot.data[1]);
		expect(panelSeriesTarget(panels[1], 1)).toBeNull();
		expect(panelSeriesTarget(gen, 0)).toBeNull();
	});
});

describe('dragging a line on panel 2', () => {
	it("moves generator series 2's line, fixes its θ, and touches no other series", () => {
		const { gen, panels } = facetedActogram(ONSET);
		const copy = panels[1].plot.data[0].phaseMarkers[0];
		const g1 = gen.plot.data[0].phaseMarkers[0];
		const g2 = gen.plot.data[1].phaseMarkers[0];
		expect(copy).not.toBe(g2);
		const before1 = { ...g1.linearRegression, lock: g1.lockTheta };
		const before2 = { ...g2.linearRegression };

		const { container } = renderInSvg(copy);
		const from = pointOnLine(copy, 7);
		drag(container, from, { x: from.x + 40, y: from.y });

		// The generator's own series 2 marker took the edit (the inner was rebuilt by the op,
		// so read it back from the generator).
		const after2 = gen.plot.data[1].phaseMarkers[0];
		expect(after2.lockTheta).toBe('fixed');
		expect(after2.lockTau).toBe('fit');
		expect(after2.linearRegression.intercept).not.toBeCloseTo(before2.intercept, 6);
		// Series 1 untouched.
		const after1 = gen.plot.data[0].phaseMarkers[0];
		expect(after1.lockTheta).toBe(before1.lock);
		expect(after1.linearRegression.intercept).toBeCloseTo(before1.intercept, 9);
		// One undo step, and it is on the GENERATOR (its id, not the panel's).
		expect(history.undoStack).toHaveLength(1);
		expect(history.undoStack[0].forward.id).toBe(gen.id);
		// The projection mirrors the edit onto panel 2's copy, and panel 1's copy stays put.
		projectPanel(panels[1]);
		projectPanel(panels[0]);
		expect(panels[1].plot.data[0].phaseMarkers[0].lockTheta).toBe('fixed');
		expect(panels[0].plot.data[0].phaseMarkers[0].lockTheta).toBe('fit');
		history.undo();
		expect(gen.plot.data[1].phaseMarkers[0].lockTheta).toBe('fit');
	});

	it('a press that does not move records nothing on the generator', () => {
		const { gen, panels } = facetedActogram(ONSET);
		const copy = panels[1].plot.data[0].phaseMarkers[0];
		const { container } = renderInSvg(copy);
		const from = pointOnLine(copy, 7);
		drag(container, from, from, 1);
		expect(history.undoStack).toHaveLength(0);
		expect(gen.plot.data[1].phaseMarkers[0].lockTheta).toBe('fit');
	});
});

describe('clicking a panel with "Add markers" armed on the generator', () => {
	it('places the marker on the generator series the panel shows, and only there', () => {
		const { gen, panels } = facetedActogram(MANUAL);
		const armed = gen.plot.data[1].phaseMarkers[0];
		gen.plot.isAddingMarkerTo = armed.id;
		const r = render(Actogram, { props: { theData: panels[1], which: 'plot' } });
		const svg = r.container.querySelector('svg');
		expect(svg).toBeTruthy();
		const p = panels[1].plot;
		clickAt(
			svg,
			p.padding.left + p.plotwidth / 4,
			p.padding.top + 2 * (p.eachplotheight + p.spaceBetween) + 1
		);

		expect(gen.plot.data[1].phaseMarkers[0].manualMarkers).toHaveLength(1);
		expect(gen.plot.data[0].phaseMarkers[0].manualMarkers).toHaveLength(0);
		// The panel's own copy was not written; the projection carries it over.
		expect(panels[1].plot.data[0].phaseMarkers[0].manualMarkers).toHaveLength(0);
		projectPanel(panels[1]);
		expect(panels[1].plot.data[0].phaseMarkers[0].manualMarkers).toHaveLength(1);
	});

	it('a click on the OTHER panel does nothing, as a click on an unarmed child did', () => {
		const { gen, panels } = facetedActogram(MANUAL);
		gen.plot.isAddingMarkerTo = gen.plot.data[1].phaseMarkers[0].id;
		const r = render(Actogram, { props: { theData: panels[0], which: 'plot' } });
		const svg = r.container.querySelector('svg');
		const p = panels[0].plot;
		clickAt(
			svg,
			p.padding.left + p.plotwidth / 4,
			p.padding.top + 2 * (p.eachplotheight + p.spaceBetween) + 1
		);
		expect(gen.plot.data[0].phaseMarkers[0].manualMarkers).toHaveLength(0);
		expect(gen.plot.data[1].phaseMarkers[0].manualMarkers).toHaveLength(0);
	});
});
