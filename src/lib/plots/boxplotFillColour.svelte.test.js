// Guard for the "copy-pasted source node shares the same fill colour" bug.
//
// THE BUG. BoxClass resolves `colour` at READ time (v72's fix), but `fillColour` was
// still resolved ONCE, in the constructor — at which moment the series is not wired
// yet (y.refId === -1, wired afterwards; see the wiring-order note at the top of
// BoxClass in components/plotbits/Box.svelte). So `this.colour` fell back to
// getPaletteColor(0) for EVERY series and the snapshot froze it: two independent
// columns (e.g. a Random node and its pasted copy) wired to one boxplot rendered
// distinct STROKES but the identical FILL.
//
// This models the real interactive path exactly: series constructed unwired, column
// wired afterwards, then the app-shell pinning pass runs.
//
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appState } from '$lib/core/core.svelte';
import { Column } from '$lib/core/Column.svelte';
import { Boxplotclass } from './Boxplot/Boxplot.svelte';
import { pinAllSeriesAppearance } from './appearanceIdentity.js';

const PALETTE = ['#aa0000', '#00aa00', '#0000aa', '#aaaa00'];

function mkCol(type, values) {
	const c = new Column({ type, data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
	core.categoryColours = {};
	core.seriesAppearance = {};
	core.orphanProcesses = [];
	core.tableProcesses = [];
	appState.appColours = [...PALETTE];
});

describe('boxplot fill colour follows the wired column (two independent sources)', () => {
	it('two series wired to two independent columns get two distinct fills', () => {
		// Two independent root columns — the shape a Random node and its pasted copy
		// produce (a fresh TP output column each, no shared ancestry).
		const yA = mkCol('number', [1, 2, 3, 4]);
		const yB = mkCol('number', [5, 6, 7, 8]);

		// The real interactive sequence: add the series UNWIRED, wire afterwards.
		const parentBox = { id: 1, width: 400, height: 300, data: [] };
		const chart = new Boxplotclass(parentBox, null);
		chart.addData({ x: null, y: null });
		chart.addData({ x: null, y: null });
		chart.data[0].y.refId = yA;
		chart.data[1].y.refId = yB;

		// The app shell's pinning effect (src/routes shell → pinAllSeriesAppearance).
		pinAllSeriesAppearance([{ plot: { data: chart.data } }]);

		const [a, b] = chart.data.map((d) => d.boxPlot);
		// Strokes already resolve at read time and differ.
		expect(a.colour).not.toBe(b.colour);
		// The bug: both fills were frozen at construction as getPaletteColor(0).
		expect(a.fillColour).not.toBe(b.fillColour);
		// And an automatic fill should track the series' own stroke.
		expect(a.fillColour).toBe(a.colour);
		expect(b.fillColour).toBe(b.colour);
	});

	it('a deliberately chosen fill survives (only auto fills track the column)', () => {
		const yA = mkCol('number', [1, 2, 3, 4]);
		const parentBox = { id: 1, width: 400, height: 300, data: [] };
		const chart = new Boxplotclass(parentBox, null);
		chart.addData({ x: null, y: null });
		chart.data[0].y.refId = yA;
		pinAllSeriesAppearance([{ plot: { data: chart.data } }]);

		chart.data[0].boxPlot.fillColour = '#123456';
		expect(chart.data[0].boxPlot.fillColour).toBe('#123456');
	});
});
