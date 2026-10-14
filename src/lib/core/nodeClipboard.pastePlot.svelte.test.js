// @ts-nocheck
// A pasted plot must not share its original's output columns (plan 2026-10-15 "fold Data
// View into Table", 2.4 and step 2). `metricOut` ({ key: colId }) is saved with the plot, so a
// copy that carried it reused the ORIGINAL's column ids: the copy's metric hook found the
// columns alive, kept them, and wrote its own values into them, so the original's ports (and
// everything wired to them) showed the copy's results.
//
// The copy and paste steps below are the canvas's own: snapshotNode (toJSON, JSON clone, drop
// id and selection, clearPlotInputs) then the paste path (clearPlotInputs again, for an
// envelope written by an older build, and mutationService.addPlot).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column, getColumnById } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { mutationService } from '$lib/core/mutationService.js';
import { loadPlots } from '$test/plotRegistry.js';
import {
	syncPlotMetricColumns,
	writePlotMetricOutputs
} from '$lib/plots/plotMetricOutputs.svelte.js';
import { addRuleRecorded } from '$lib/plots/Actogram/markerRuleActions.js';
import { clearPlotInputs } from './nodeClipboard.js';

const REST = join(process.cwd(), 'static', 'sessions', 'demos', 'demo-workflow-rest-activity.json');
const ONSET = { type: 'onset', templateHrsBefore: 3, templateHrsAfter: 3, centileThreshold: 50 };

function restActogram() {
	const session = JSON.parse(readFileSync(REST, 'utf8'));
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.storedValues = {};
	core.rawData = new Map(Object.entries(session.rawData ?? {}).map(([k, v]) => [+k, v]));
	for (const cd of session.data ?? []) pushObj(Column.fromJSON(cd));
	const plot = Plot.fromJSON(session.plots.find((p) => p.type === 'actogram'));
	core.plots.push(plot);
	return plot;
}

/** What the metric hook does, synchronously. */
function sync(plot) {
	syncPlotMetricColumns(plot);
	writePlotMetricOutputs(plot);
}

/** The canvas's copy (snapshotNode) then paste, for one plot. */
function copyPaste(plot) {
	const cloned = JSON.parse(JSON.stringify(plot.toJSON()));
	delete cloned.id;
	delete cloned.selected;
	const entry = { type: 'plot', plotData: clearPlotInputs(cloned) };
	return mutationService.addPlot({ ...clearPlotInputs(entry.plotData), x: 10, y: 10 });
}

beforeAll(async () => {
	appConsts.plotMap = await loadPlots();
});
beforeEach(() => {
	history.init();
	history.clear();
});

describe('clearPlotInputs', () => {
	it('drops the output-column map, so the copy mints its own columns', () => {
		const out = clearPlotInputs({
			type: 'actogram',
			metricOut: { r1_tau: 7 },
			plot: { data: [{ x: { refId: 1 } }] }
		});
		expect(out.metricOut).toBeUndefined();
		expect(out.plot.data).toEqual([]);
	});

	it('turns a Data View copied in a tab running an older build into a Table', () => {
		const reactive = clearPlotInputs({
			type: 'dataview',
			name: 'Data: x',
			plot: { sourcePlotId: 4, sourceType: 'reactive', staticHeaders: ['a'], staticRows: [[1]] }
		});
		expect(reactive.type).toBe('tableplot');
		expect(reactive.name).toBe('Data: x');
		expect(reactive.plot.source).toBe('plot');
		expect(reactive.plot.sourcePlotId).toBe(4);
		expect(reactive.plot.columnRefs).toEqual([]);
		expect(reactive.plot).not.toHaveProperty('data');
		expect(reactive.plot).not.toHaveProperty('staticRows');

		// A static one has no session to name its node's type: a frozen snapshot.
		const stat = clearPlotInputs({
			type: 'dataview',
			sourceNodeId: 'tableprocess_3',
			plot: { sourceType: 'static', staticHeaders: ['column'], staticRows: [['a']] }
		});
		expect(stat.type).toBe('tableplot');
		expect(stat.plot.source).toBe('node');
		expect(stat.plot.snapshot).toEqual({ headers: ['column'], rows: [['a']] });
	});

	it('does not mutate its input', () => {
		const input = { type: 'tableplot', metricOut: { series: 3 }, plot: { columnRefs: [1] } };
		clearPlotInputs(input);
		expect(input.metricOut).toEqual({ series: 3 });
		expect(input.plot.columnRefs).toEqual([1]);
	});
});

describe('pasting an actogram with marker-rule outputs', () => {
	it("the copy gets its own output columns and never writes into the original's", () => {
		const original = restActogram();
		addRuleRecorded(original.plot, ONSET);
		sync(original);
		const originalOut = { ...original.metricOut };
		expect(Object.keys(originalOut)).toHaveLength(5);
		const originalTau = [...core.rawData.get(originalOut.r1_tau)];

		const copy = copyPaste(original);
		expect(copy).toBeTruthy();
		// The pasted copy carries the rule but none of the original's column ids.
		expect(copy.plot.markerRules.map((r) => r.id)).toEqual(['r1']);
		sync(copy);
		const copyIds = Object.values(copy.metricOut);
		expect(copyIds).toHaveLength(5);
		for (const id of copyIds) {
			expect(Object.values(originalOut)).not.toContain(id);
			expect(getColumnById(id)).toBeTruthy();
		}
		// The original's ports and columns are untouched: same ids, same values.
		expect(original.metricOut).toEqual(originalOut);
		expect(core.rawData.get(originalOut.r1_tau)).toEqual(originalTau);
		// The copy has no series wired (clearPlotInputs), so its own tau column is empty,
		// where a shared column would have been overwritten with that empty write.
		expect(core.rawData.get(copy.metricOut.r1_tau)).toEqual([]);
	});
});
