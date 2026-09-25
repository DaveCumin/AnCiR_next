/**
 * Dragging the actogram marker line, driven through the REAL component with real
 * pointer events, over the real shipped free-running demo.
 *
 * lineDrag.test.js pins the maths. This file pins the three things only the
 * component can be wrong about:
 *   1. a drag writes through setTau/setTheta, so the dragged parameter's lock
 *      flips to Fixed and the OTHER one is left alone;
 *   2. the whole gesture is ONE undo step, recorded on pointerup, never per move;
 *   3. a press that does not move records nothing and changes nothing.
 *
 * jsdom has no layout, so `getBoundingClientRect()` is all zeros. The component
 * guards that case (a zero-width rect means "no scaling"), which makes client
 * pixels equal the SVG's own pixels here — exactly what the geometry below
 * assumes.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup } from '@testing-library/svelte';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import PhaseMarker from './PhaseMarker.svelte';

const SESSION = join(
	process.cwd(),
	'static',
	'sessions',
	'demos',
	'demo-workflow-free-running.json'
);

/** An onset block: both locks start at Fit, which is what makes the flip visible. */
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

function actogramWithMarker(block) {
	const session = JSON.parse(readFileSync(SESSION, 'utf8'));
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.storedValues = {};
	core.rawData = new Map(Object.entries(session.rawData ?? {}).map(([k, v]) => [+k, v]));
	for (const cd of session.data ?? []) pushObj(Column.fromJSON(cd));

	const plotJson = session.plots.find((p) => p.type === 'actogram');
	plotJson.plot.data[0].phaseMarkers = [block];
	const plot = Plot.fromJSON(plotJson);
	core.plots.push(plot);
	plot.parentBox = { id: plot.id, width: 600, height: 500 };
	return { plot, marker: plot.plot.data[0].phaseMarkers[0] };
}

/** Where the drawn line sits, in the SVG's own pixels, at day coordinate `d`. */
function pointOnLine(marker, d) {
	const p = marker.parentData.parentPlot;
	const reg = marker.linearRegression;
	const tod = (reg.slope - p.periodHrs) * d + reg.intercept;
	return {
		x: (tod / (p.periodHrs * p.doublePlot)) * p.plotwidth + p.padding.left,
		y: p.padding.top + d * (p.eachplotheight + p.spaceBetween)
	};
}

/** Hours per horizontal pixel, so a drag can be expressed in hours. */
function hoursPerPx(marker) {
	const p = marker.parentData.parentPlot;
	return (p.periodHrs * p.doublePlot) / p.plotwidth;
}

/** An <svg> host, so the line has a namespace and an `ownerSVGElement`. */
function renderInSvg(marker) {
	const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	document.body.appendChild(host);
	const r = render(PhaseMarker, { props: { marker, which: 'plot' } }, { container: host });
	return { container: r.container };
}

function handleOf(container) {
	const el = container.querySelector('.line-handle');
	expect(el).toBeTruthy();
	return el;
}

function fire(target, type, { x, y }) {
	// jsdom has no PointerEvent; MouseEvent carries every field the handlers read.
	target.dispatchEvent(
		new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
	);
}

/** A whole gesture: press on the line, move through `steps`, release. */
function drag(container, from, to, steps = 4) {
	const el = handleOf(container);
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

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
});

beforeEach(() => {
	history.init();
	history.clear();
});
afterEach(() => cleanup());

describe('dragging the line on the plot', () => {
	it('drags the middle: θ moves, its lock fixes, τ is left fitted', () => {
		const { marker } = actogramWithMarker(structuredClone(ONSET));
		const { container } = renderInSvg(marker);
		expect(marker.lockTau).toBe('fit');
		expect(marker.lockTheta).toBe('fit');

		const before = marker.linearRegression;
		const refDay = marker.fitRefDay;
		const P = marker.parentData.parentPlot.periodHrs;
		const thetaBefore = (before.slope - P) * refDay + before.intercept;

		const from = pointOnLine(marker, 7);
		const dxPx = 40;
		drag(container, from, { x: from.x + dxPx, y: from.y });

		expect(marker.lockTheta).toBe('fixed');
		expect(marker.lockTau).toBe('fit');
		const after = marker.linearRegression;
		const thetaAfter = (after.slope - P) * refDay + after.intercept;
		expect(thetaAfter - thetaBefore).toBeCloseTo(dxPx * hoursPerPx(marker), 6);
	});

	it('drags an end: τ moves and its lock fixes, θ is left fitted', () => {
		const { marker } = actogramWithMarker(structuredClone(ONSET));
		const { container } = renderInSvg(marker);
		const tauBefore = marker.linearRegression.slope;

		// Day 13 of a 0..14 span is inside the far end zone.
		const from = pointOnLine(marker, 13);
		drag(container, from, { x: from.x + 40, y: from.y });

		expect(marker.lockTau).toBe('fixed');
		expect(marker.lockTheta).toBe('fit');
		expect(marker.linearRegression.slope).toBeGreaterThan(tauBefore);
	});

	it('records the whole gesture as exactly one undo step', () => {
		const { marker } = actogramWithMarker(structuredClone(ONSET));
		const { container } = renderInSvg(marker);
		expect(history.undoStack.length).toBe(0);

		const from = pointOnLine(marker, 7);
		drag(container, from, { x: from.x + 40, y: from.y }, 8);

		// Eight pointermoves, one history entry.
		expect(history.undoStack.length).toBe(1);
	});

	it('undo puts the line back where it was', () => {
		const { plot, marker } = actogramWithMarker(structuredClone(ONSET));
		const { container } = renderInSvg(marker);
		const before = { ...marker.linearRegression };

		const from = pointOnLine(marker, 7);
		drag(container, from, { x: from.x + 40, y: from.y });
		expect(plot.plot.data[0].phaseMarkers[0].lockTheta).toBe('fixed');

		history.undo();
		const restored = plot.plot.data[0].phaseMarkers[0];
		expect(restored.lockTheta).toBe('fit');
		expect(restored.linearRegression.slope).toBeCloseTo(before.slope, 9);
		expect(restored.linearRegression.intercept).toBeCloseTo(before.intercept, 9);
	});

	it('a press that does not move changes nothing and records nothing', () => {
		const { marker } = actogramWithMarker(structuredClone(ONSET));
		const { container } = renderInSvg(marker);
		const before = { ...marker.linearRegression };

		const from = pointOnLine(marker, 7);
		const el = handleOf(container);
		fire(el, 'pointerdown', from);
		// Under the 3 px threshold: a click, not a drag.
		fire(window, 'pointermove', { x: from.x + 2, y: from.y + 1 });
		fire(window, 'pointerup', { x: from.x + 2, y: from.y + 1 });

		expect(history.undoStack.length).toBe(0);
		expect(marker.lockTau).toBe('fit');
		expect(marker.lockTheta).toBe('fit');
		expect(marker.linearRegression.slope).toBe(before.slope);
		expect(marker.linearRegression.intercept).toBe(before.intercept);
	});

	it('leaves the pointer alone while "Add markers" is armed, so the click still places one', () => {
		const { marker } = actogramWithMarker(structuredClone(ONSET));
		const { container } = renderInSvg(marker);
		marker.parentData.parentPlot.isAddingMarkerTo = marker.id;

		const from = pointOnLine(marker, 7);
		const el = handleOf(container);
		const down = new MouseEvent('pointerdown', {
			bubbles: true,
			cancelable: true,
			clientX: from.x,
			clientY: from.y,
			button: 0
		});
		el.dispatchEvent(down);
		// Not swallowed: the actogram's own click-to-place handler must still see it.
		expect(down.defaultPrevented).toBe(false);
		fire(window, 'pointermove', { x: from.x + 40, y: from.y });
		fire(window, 'pointerup', { x: from.x + 40, y: from.y });
		expect(marker.lockTheta).toBe('fit');
		expect(history.undoStack.length).toBe(0);
	});
});
