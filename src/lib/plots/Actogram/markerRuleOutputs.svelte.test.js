// @ts-nocheck
/**
 * Actogram MARKER RULES, Phase B: the rules' OUTPUT PORTS (plan
 * docs/plans/2026-09-30-actogram-marker-rules-and-outputs.md, sections 2 and 4).
 *
 * Five keys per rule, keyed on the persisted rule id (`r1_tau`, `r1_phi`, `r1_r2`,
 * `r1_rmse`, `r1_n`), one value per series. Driven over the shipped rest-activity demo
 * (plot 0, two series, 7 days hourly), whose onset-block numbers the plan pinned in
 * section 8: tau 24.143 / 24.627 h fitted, phi 7.357 / 6.180 h, 6 markers each.
 *
 * The component's metric effect is `syncPlotMetricColumns` then `writePlotMetricOutputs` in
 * a microtask; these tests call the two directly (`sync`), so they pin the model. The
 * faceted, mounted path is in facetMetricOutputs.svelte.test.js.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, pushObj, getStoredValue } from '$lib/core/core.svelte.js';
import { Column, getColumnById } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { mutationService } from '$lib/core/mutationService.js';
import {
	getCachedProcessNodeGraph,
	clearProcessNodeGraphCache
} from '$lib/core/ProcessNode.svelte.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { PhaseMarkerClass } from './PhaseMarker.svelte';
import {
	plotMetricKeys,
	plotMetricStats,
	plotMetricLabel,
	syncPlotMetricColumns,
	writePlotMetricOutputs,
	ruleOutputValues,
	PLOT_METRIC_DEFS
} from '$lib/plots/plotMetricOutputs.svelte.js';
import {
	addRuleRecorded,
	setRuleSettings,
	removeRuleRecorded,
	detachRecorded,
	promoteRecorded
} from './markerRuleActions.js';

const REST = join(process.cwd(), 'static', 'sessions', 'demos', 'demo-workflow-rest-activity.json');
const ONSET = { type: 'onset', templateHrsBefore: 3, templateHrsAfter: 3, centileThreshold: 50 };
const SUFFIXES = ['tau', 'phi', 'r2', 'rmse', 'n'];

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

/** What the component's metric effect does, synchronously. */
function sync(plot) {
	syncPlotMetricColumns(plot);
	writePlotMetricOutputs(plot);
}
const col = (plot, key) => core.rawData.get(plot.metricOut[key]);
const graph = () => {
	clearProcessNodeGraphCache();
	return getCachedProcessNodeGraph(core, appConsts);
};

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
});
beforeEach(() => {
	history.init();
	history.clear();
});

describe('keys follow the rules, keyed on the rule id', () => {
	it('five keys per rule, in rule order; none without rules', () => {
		const plot = restActogram();
		expect(plotMetricKeys(plot)).toEqual([]);
		addRuleRecorded(plot.plot, ONSET);
		addRuleRecorded(plot.plot, { ...ONSET, type: 'offset' });
		expect(plotMetricKeys(plot)).toEqual([
			...SUFFIXES.map((s) => `r1_${s}`),
			...SUFFIXES.map((s) => `r2_${s}`)
		]);
		sync(plot);
		expect(Object.keys(plot.metricOut)).toEqual(plotMetricKeys(plot));
		for (const k of plotMetricKeys(plot)) expect(getColumnById(plot.metricOut[k]), k).toBeTruthy();
		expect(getColumnById(plot.metricOut.r1_tau).name).toBe(`Rule_1_tau_${plot.id}`);
	});

	it('the dynamic keys reach the actogram node as metric ports, labelled by the rule', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		sync(plot);
		const node = graph().nodes.find((n) => n.id === `plot_${plot.id}`);
		const metric = node.ports.outputs.filter((p) => p.metric);
		expect(metric.map((p) => p.name)).toEqual(
			SUFFIXES.map((s) => `col_${plot.metricOut[`r1_${s}`]}`)
		);
		expect(metric.map((p) => p.display)).toEqual([
			'Rule 1 τ (h)',
			'Rule 1 φ (h)',
			'Rule 1 R²',
			'Rule 1 RMSE (h)',
			'Rule 1 n'
		]);
	});
});

describe('values', () => {
	it('tau is the harmonic-check pick; phi, R², RMSE and n are the line as drawn (plan 8 pins)', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		sync(plot);
		const [a, b] = plot.plot.data.map((d) => d.ruleInstances[0]);
		expect(col(plot, 'r1_tau')).toEqual([
			a.harmonicCheck.strongest.peakPeriod,
			b.harmonicCheck.strongest.peakPeriod
		]);
		expect(col(plot, 'r1_tau')[0]).toBeCloseTo(24.143, 3);
		expect(col(plot, 'r1_tau')[1]).toBeCloseTo(24.627, 3);
		expect(col(plot, 'r1_phi')[0]).toBeCloseTo(7.357, 3);
		expect(col(plot, 'r1_phi')[1]).toBeCloseTo(6.18, 3);
		// R² in the time-of-day frame (review FIT-4, 2026-10-04): was 0.99997 on absolute
		// time, where the 24 h-per-day ramp made any onsets score near 1. A near-entrained
		// line (24.14 h) has little drift to explain, so R² is modest; RMSE is the quality.
		expect(col(plot, 'r1_r2')[0]).toBeCloseTo(0.5714, 4);
		expect(col(plot, 'r1_rmse')[0]).toBeCloseTo(0.244, 3);
		expect(col(plot, 'r1_rmse')[1]).toBeCloseTo(0.616, 3);
		expect(col(plot, 'r1_n')).toEqual([6, 6]);
	});

	it('tau follows the harmonic pick when it is tau/2, not the fitted slope', () => {
		const plot = restActogram();
		// A line fixed at 47 h: the pinned harmonic check picks tau/2 = 23.5 h on both series.
		addRuleRecorded(plot.plot, {
			type: 'manual',
			lockTau: 'fixed',
			lockTheta: 'fixed',
			fixedTau: 47,
			fixedTheta: 6
		});
		sync(plot);
		expect(col(plot, 'r1_tau')).toEqual([23.5, 23.5]);
		expect(plot.plot.data[0].ruleInstances[0].linearRegression.slope).toBe(47);
	});

	it('no valid fit: tau, phi, R², RMSE are NaN, n is the count (0), matching the other defs', () => {
		const plot = restActogram();
		// A line-only rule with no hand-placed points and nothing fixed: no line at all.
		addRuleRecorded(plot.plot, { type: 'manual' });
		sync(plot);
		for (const s of ['tau', 'phi', 'r2', 'rmse']) {
			expect(col(plot, `r1_${s}`), s).toEqual([NaN, NaN]);
		}
		expect(col(plot, 'r1_n')).toEqual([0, 0]);
		// A fixed line with no markers to compare against: tau and phi, but no R²/RMSE.
		setRuleSettings(plot.plot, plot.plot.markerRules[0], {
			lockTau: 'fixed',
			lockTheta: 'fixed',
			fixedTau: 24,
			fixedTheta: 6
		});
		sync(plot);
		expect(col(plot, 'r1_tau')).toEqual([24, 24]);
		expect(col(plot, 'r1_r2')).toEqual([NaN, NaN]);
		expect(col(plot, 'r1_rmse')).toEqual([NaN, NaN]);
		expect(ruleOutputValues(null)).toEqual({ tau: NaN, phi: NaN, r2: NaN, rmse: NaN, n: NaN });
	});

	it('a hidden series still emits (its markers are drawn)', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		plot.plot.data[1].draw = false;
		sync(plot);
		expect(col(plot, 'r1_phi')[1]).toBeCloseTo(6.18, 3);
	});

	it('a DETACHED series fills its rule cells from its own block (fromRule)', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		sync(plot);
		const ids = { ...plot.metricOut };
		// Detach series 1 by editing its threshold on the instance (Decision 5a).
		detachRecorded(plot.plot.data[1].ruleInstances[0], (b) => (b.centileThreshold = 80));
		const own = plot.plot.data[1].phaseMarkers.find((m) => m.fromRule === 'r1');
		expect(own).toBeTruthy();
		expect(plot.plot.data[1].ruleInstances).toHaveLength(0);
		sync(plot);
		expect(plot.metricOut).toEqual(ids);
		const expected = ruleOutputValues(own);
		expect(expected.tau).not.toBeCloseTo(24.627, 3);
		for (const s of SUFFIXES) {
			expect(col(plot, `r1_${s}`)[1], s).toEqual(expected[s]);
		}
		// Series 0 still follows the rule.
		expect(col(plot, 'r1_phi')[0]).toBeCloseTo(7.357, 3);
		// A rule edit moves series 0 only.
		setRuleSettings(plot.plot, plot.plot.markerRules[0], { templateHrsBefore: 4 });
		sync(plot);
		expect(col(plot, 'r1_tau')[1]).toEqual(expected.tau);
		expect(col(plot, 'r1_tau')[0]).toEqual(
			plot.plot.data[0].ruleInstances[0].harmonicCheck.strongest.peakPeriod
		);
	});

	it('the def reads no warnings periodogram (statsFor never touches onsetWarnings)', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		const inst = plot.plot.data[0].ruleInstances[0];
		let read = 0;
		Object.defineProperty(inst, 'onsetWarnings', {
			get() {
				read++;
				return [];
			}
		});
		plotMetricStats(plot);
		expect(read).toBe(0);
	});
});

describe('rename and delete keep column ids (history)', () => {
	it('rename relabels ports and renames columns WITHOUT re-minting, as one undo step', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		sync(plot);
		const ids = { ...plot.metricOut };
		const depth = history.undoStack.length;

		expect(setRuleSettings(plot.plot, plot.plot.markerRules[0], { name: 'Onsets' })).toBe(true);
		sync(plot);
		expect(history.undoStack.length).toBe(depth + 1);
		expect(plot.metricOut).toEqual(ids);
		for (const s of SUFFIXES) {
			expect(getColumnById(ids[`r1_${s}`]).name).toBe(`Onsets_${s}_${plot.id}`);
		}
		expect(plotMetricLabel(plot, 'r1_tau')).toBe('Onsets τ (h)');
		const node = graph().nodes.find((n) => n.id === `plot_${plot.id}`);
		expect(node.ports.outputs.find((p) => p.name === `col_${ids.r1_tau}`).display).toBe(
			'Onsets τ (h)'
		);

		history.undo();
		sync(plot);
		expect(plot.plot.markerRules[0].name).toBe('Rule 1');
		expect(plot.metricOut).toEqual(ids);
		expect(getColumnById(ids.r1_phi).name).toBe(`Rule_1_phi_${plot.id}`);
		history.redo();
		expect(getColumnById(ids.r1_phi).name).toBe(`Onsets_phi_${plot.id}`);
	});

	it('delete then undo restores the SAME column ids and the downstream wire', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		addRuleRecorded(plot.plot, ONSET);
		sync(plot);
		const ids = { ...plot.metricOut };
		const tauCol = ids.r1_tau;
		const tau = [...col(plot, 'r1_tau')];
		// A Describe Data node reading rule 1's tau column.
		const tp = mutationService.addFreeTableProcess('DescribeData', { yIN: [tauCol], out: {} });
		const wired = () =>
			graph().connections.some(
				(c) =>
					c.fromId === `plot_${plot.id}` &&
					c.fromPort === `col_${tauCol}` &&
					c.toId.includes(String(tp.id))
			);
		expect(wired()).toBe(true);
		const depth = history.undoStack.length;

		removeRuleRecorded(plot.plot, plot.plot.markerRules[0]);
		expect(history.undoStack.length).toBe(depth + 1);
		expect(plot.plot.markerRules.map((r) => r.id)).toEqual(['r2']);
		for (const s of SUFFIXES) expect(getColumnById(ids[`r1_${s}`]), s).toBeFalsy();
		expect(Object.keys(plot.metricOut)).toEqual(SUFFIXES.map((s) => `r2_${s}`));
		sync(plot); // the effect finds nothing stale left to delete
		expect(wired()).toBe(false);

		history.undo();
		sync(plot);
		expect(plot.plot.markerRules.map((r) => r.id)).toEqual(['r1', 'r2']);
		expect(plot.metricOut).toEqual(ids);
		for (const s of SUFFIXES) expect(getColumnById(ids[`r1_${s}`]), s).toBeTruthy();
		expect(col(plot, 'r1_tau')).toEqual(tau);
		expect(tp.args.yIN).toEqual([tauCol]);
		expect(wired()).toBe(true);

		// Redo deletes again; undo again restores again (ids stable across the round trip).
		history.redo();
		expect(getColumnById(tauCol)).toBeFalsy();
		history.undo();
		expect(getColumnById(tauCol)).toBeTruthy();
		expect(plot.metricOut.r1_tau).toBe(tauCol);
	});
});

describe('stored values', () => {
	it('a plot ref resolves one series of a plot metric column', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		sync(plot);
		core.storedValues.x = { source: 't', ref: { plotId: plot.id, outKey: 'r1_phi', index: 1 } };
		expect(getStoredValue('x')).toBeCloseTo(6.18, 3);
		core.storedValues.y = { source: 't', ref: { plotId: plot.id, outKey: 'r9_phi', index: 0 } };
		expect(getStoredValue('y')).toBeNaN();
		core.storedValues.z = {
			source: 't',
			ref: { plotId: plot.id, outKey: 'r1_phi', index: 7 },
			staticValue: 3
		};
		expect(getStoredValue('z')).toBe(3);
	});

	it('"Make rule" re-points the block\'s legacy stored values at the rule, in the same undo step', () => {
		const plot = restActogram();
		const d = plot.plot.data[1];
		const block = PhaseMarkerClass.fromJSON({ ...ONSET, name: 'marker_7' }, d);
		d.phaseMarkers = [block];
		const legacy = (v) => ({ source: 'Actogram phase marker (marker_7)', staticValue: v });
		core.storedValues = {
			tau_marker_7: legacy(24.6),
			phi_marker_7: legacy(6.2),
			marker_rmse_marker_7: legacy(0.6),
			tau_other: legacy(1)
		};
		const depth = history.undoStack.length;
		promoteRecorded(plot.plot.data[1].phaseMarkers[0]);
		expect(history.undoStack.length).toBe(depth + 1);
		const rule = plot.plot.markerRules[0];
		expect(core.storedValues.tau_marker_7.ref).toEqual({
			plotId: plot.id,
			outKey: `${rule.id}_tau`,
			index: 1
		});
		expect(core.storedValues.marker_rmse_marker_7.ref.outKey).toBe(`${rule.id}_rmse`);
		expect(core.storedValues.tau_other.ref).toBeUndefined();
		sync(plot);
		expect(getStoredValue('phi_marker_7')).toBeCloseTo(col(plot, `${rule.id}_phi`)[1], 9);

		history.undo();
		expect(plot.plot.markerRules).toHaveLength(0);
		expect(core.storedValues.tau_marker_7).toEqual(legacy(24.6));
	});
});

describe('the actogram def', () => {
	it('is registered with keysFor, labelFor, columnNameFor and a manifest pattern', () => {
		const def = PLOT_METRIC_DEFS.actogram;
		expect(typeof def.keysFor).toBe('function');
		expect(def.keys).toBeUndefined();
		expect(def.manifest.map((o) => o.name)).toEqual(SUFFIXES.map((s) => `r*_${s}`));
	});
});
