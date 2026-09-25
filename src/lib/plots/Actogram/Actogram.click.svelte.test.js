/**
 * Click-to-place a manual phase marker on the actogram, driven through the REAL
 * component over the real shipped free-running demo (the same harness the
 * PhaseMarker drag and legend tests use).
 *
 * The bug this file pins: `handleClick` destructured `getClickedTime(e)`, which
 * returns `null` for a click outside the drawn plot area (the margin, the axis,
 * the gap below the last row). With "Add markers" armed, such a click threw
 * `TypeError: null is not iterable` instead of quietly doing nothing.
 *
 * jsdom has no layout, so `offsetX`/`offsetY` are always 0 on a synthesised
 * MouseEvent; they are defined explicitly here, which is also exactly the
 * quantity the component reads.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup } from '@testing-library/svelte';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import Actogram from './Actogram.svelte';

const SESSION = join(
	process.cwd(),
	'static',
	'sessions',
	'demos',
	'demo-workflow-free-running.json'
);

/** A manual block: it holds exactly the markers the user clicks in. */
const MANUAL = {
	name: 'manual_0',
	type: 'manual',
	colour: '#234154',
	showLine: false,
	showMarkers: true,
	lineWidth: 1,
	markerSize: 5,
	manualMarkers: []
};

function actogramWithManualBlock() {
	const session = JSON.parse(readFileSync(SESSION, 'utf8'));
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.storedValues = {};
	core.rawData = new Map(Object.entries(session.rawData ?? {}).map(([k, v]) => [+k, v]));
	for (const cd of session.data ?? []) pushObj(Column.fromJSON(cd));

	const plotJson = session.plots.find((p) => p.type === 'actogram');
	plotJson.plot.data[0].phaseMarkers = [structuredClone(MANUAL)];
	const plot = Plot.fromJSON(plotJson);
	core.plots.push(plot);
	plot.parentBox = { id: plot.id, width: 600, height: 500 };
	return { plot, marker: plot.plot.data[0].phaseMarkers[0] };
}

function renderPlot(plot) {
	const r = render(Actogram, { props: { theData: plot, which: 'plot' } });
	const svg = r.container.querySelector('svg');
	expect(svg).toBeTruthy();
	return svg;
}

/** A left click at the given offset INSIDE the svg element. */
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
afterEach(() => cleanup());

describe('clicking the actogram with "Add markers" armed', () => {
	it('places a marker for a click inside the plot area', () => {
		const { plot, marker } = actogramWithManualBlock();
		const svg = renderPlot(plot);
		plot.plot.isAddingMarkerTo = marker.id;

		const pad = plot.plot.padding;
		clickAt(svg, pad.left + plot.plot.plotwidth / 2, pad.top + plot.plot.plotheight / 2);

		expect(marker.manualMarkers).toHaveLength(1);
		expect(Number.isFinite(marker.manualMarkers[0])).toBe(true);
	});

	it('does not throw and adds nothing for a click in the left margin', () => {
		const { plot, marker } = actogramWithManualBlock();
		const svg = renderPlot(plot);
		plot.plot.isAddingMarkerTo = marker.id;

		const pad = plot.plot.padding;
		expect(() => clickAt(svg, pad.left / 2, pad.top + plot.plot.plotheight / 2)).not.toThrow();
		expect(marker.manualMarkers).toHaveLength(0);
	});

	it('does not throw and adds nothing for a click on the top axis', () => {
		const { plot, marker } = actogramWithManualBlock();
		const svg = renderPlot(plot);
		plot.plot.isAddingMarkerTo = marker.id;

		const pad = plot.plot.padding;
		expect(() => clickAt(svg, pad.left + plot.plot.plotwidth / 2, pad.top / 2)).not.toThrow();
		expect(marker.manualMarkers).toHaveLength(0);
	});

	it('does not throw and adds nothing for a click past the right edge', () => {
		const { plot, marker } = actogramWithManualBlock();
		const svg = renderPlot(plot);
		plot.plot.isAddingMarkerTo = marker.id;

		const pad = plot.plot.padding;
		expect(() =>
			clickAt(svg, pad.left + plot.plot.plotwidth + 5, pad.top + plot.plot.plotheight / 2)
		).not.toThrow();
		expect(marker.manualMarkers).toHaveLength(0);
	});

	it('adds nothing when "Add markers" is not armed', () => {
		const { plot, marker } = actogramWithManualBlock();
		const svg = renderPlot(plot);
		expect(plot.plot.isAddingMarkerTo).toBe(-1);

		const pad = plot.plot.padding;
		clickAt(svg, pad.left + plot.plot.plotwidth / 2, pad.top + plot.plot.plotheight / 2);
		expect(marker.manualMarkers).toHaveLength(0);
	});
});
