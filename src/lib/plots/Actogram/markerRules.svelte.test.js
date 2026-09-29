// @ts-nocheck
/**
 * Actogram MARKER RULES, Phase A (plan docs/plans/2026-09-30-actogram-marker-rules-and-outputs.md).
 *
 * Driven over the real shipped rest-activity demo (plot 0: two series, 7 days, hourly), so
 * the numbers are the ones a user sees. Pinned against the plan's section 8 measurement of
 * a per-series onset block (N 3, M 3, 50 %): series 1 tau 24.143 h, phi 7.357 h; series 2
 * tau 24.627 h, phi 6.180 h. A rule with the same settings must reproduce them on both.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { PhaseMarkerClass } from './PhaseMarker.svelte';
import {
	MarkerRule,
	RuleInstance,
	reconcileRuleInstances,
	instanceSummary,
	uniqueRuleName,
	seedFixedValue
} from './markerRules.svelte.js';
import {
	addRuleRecorded,
	setRuleSettings,
	removeRuleRecorded,
	detachRecorded,
	reattachRecorded,
	promoteRecorded
} from './markerRuleActions.js';

const ROOT = process.cwd();
const REST = join(ROOT, 'static', 'sessions', 'demos', 'demo-workflow-rest-activity.json');

const ONSET = { type: 'onset', templateHrsBefore: 3, templateHrsAfter: 3, centileThreshold: 50 };

function loadSession(file) {
	const session = JSON.parse(readFileSync(file, 'utf8'));
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.storedValues = {};
	core.rawData = new Map(Object.entries(session.rawData ?? {}).map(([k, v]) => [+k, v]));
	for (const cd of session.data ?? []) pushObj(Column.fromJSON(cd));
	return session;
}

/** The rest-activity actogram as a live plot in core.plots (so the op layer finds it). */
function restActogram(mutateJson = null) {
	const session = loadSession(REST);
	const pj = session.plots.find((p) => p.type === 'actogram');
	if (mutateJson) mutateJson(pj.plot);
	const plot = Plot.fromJSON(pj);
	core.plots.push(plot);
	return plot;
}

const snap = (inner) => JSON.parse(JSON.stringify(inner));
const inst = (plot, s, ruleId = 'r1') =>
	plot.plot.data[s].ruleInstances.find((i) => i.ruleId === ruleId);
const stats = (m) => {
	const s = instanceSummary(m);
	return { tau: s.tau, phi: s.phi, r2: s.r2, rmse: s.rmse, n: s.n };
};

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
});
beforeEach(() => {
	history.init();
	history.clear();
});

describe('projection', () => {
	it('projects every rule onto every series, R x N instances, in rule order', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		addRuleRecorded(plot.plot, { ...ONSET, type: 'offset' });
		const inner = plot.plot;
		expect(inner.markerRules.map((r) => r.id)).toEqual(['r1', 'r2']);
		expect(inner.markerRules.map((r) => r.name)).toEqual(['Rule 1', 'Rule 2']);
		for (const d of inner.data) {
			expect(d.ruleInstances.map((i) => i.ruleId)).toEqual(['r1', 'r2']);
			for (const i of d.ruleInstances) expect(i).toBeInstanceOf(RuleInstance);
		}
		expect(inner.data.flatMap((d) => d.ruleInstances)).toHaveLength(4);
	});

	it('reproduces the per-series onset block numbers on BOTH series (plan 8 pins)', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		const a = stats(inst(plot, 0));
		const b = stats(inst(plot, 1));
		expect(a.tau).toBeCloseTo(24.143, 3);
		expect(a.phi).toBeCloseTo(7.357, 3);
		expect(b.tau).toBeCloseTo(24.627, 3);
		expect(b.phi).toBeCloseTo(6.18, 3);
		expect(a.n).toBe(6);
		expect(b.n).toBe(6);
		// And an own block with the same settings on series 0 agrees exactly.
		const own = PhaseMarkerClass.fromJSON({ ...ONSET }, plot.plot.data[0]);
		expect(stats(own)).toEqual(a);
	});

	it('a rule SETTING edit keeps every instance object and recomputes only that rule', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		addRuleRecorded(plot.plot, ONSET);
		const before = plot.plot.data.map((d) => [...d.ruleInstances]);
		const r2Before = inst(plot, 0, 'r2').linearRegression;
		const tauBefore = [inst(plot, 0).fitPoints.xs.length, inst(plot, 1).fitPoints.xs.length];

		expect(setRuleSettings(plot.plot, plot.plot.markerRules[0], { centileThreshold: 80 })).toBe(
			true
		);

		plot.plot.data.forEach((d, s) => expect(d.ruleInstances).toEqual(before[s]));
		plot.plot.data.forEach((d, s) =>
			d.ruleInstances.forEach((x, k) => expect(x).toBe(before[s][k]))
		);
		// r1 recomputed on both series (the threshold moved the detections), r2 untouched.
		expect(inst(plot, 0, 'r2').linearRegression).toBe(r2Before);
		expect(inst(plot, 0).templateMatches).not.toBe(undefined);
		expect(inst(plot, 0).cfg.centileThreshold).toBe(80);
		expect(inst(plot, 1).cfg.centileThreshold).toBe(80);
		expect([instanceSummary(inst(plot, 0)).tau, instanceSummary(inst(plot, 1)).tau]).not.toEqual([
			24.143, 24.627
		]);
		expect(tauBefore).toEqual([6, 6]);
	});

	it('a new series gets an instance of every rule (addData reconciles)', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		plot.plot.addData({ x: { refId: 0 }, y: { refId: 1 } });
		expect(plot.plot.data[2].ruleInstances.map((i) => i.ruleId)).toEqual(['r1']);
	});
});

describe('day selection: the rule range AND each series ticks (Decision 1a)', () => {
	it('the rule range scopes the fit on every series, and phi is reported at its first day', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		const all = [stats(inst(plot, 0)), stats(inst(plot, 1))];
		setRuleSettings(plot.plot, plot.plot.markerRules[0], { lineMinDay: 2, lineMaxDay: 5 });
		for (const s of [0, 1]) {
			const m = inst(plot, s);
			// Fitted rows are 1-indexed unwrapped days; every one lies in 2..5.
			expect(m.fitPoints.xs.length).toBeGreaterThan(0);
			expect(m.fitPoints.xs.length).toBeLessThan(all[s].n);
			m.selectedMask.forEach((v, i) => expect(v).toBe(i + 1 >= 2 && i + 1 <= 5));
			expect(m.estimatedPhase.refDay).toBe(2);
			expect(stats(m).tau).not.toBeCloseTo(all[s].tau, 6);
		}
	});

	it('an own block keeps today meaning: its range clips the drawing only', () => {
		const plot = restActogram();
		const own = PhaseMarkerClass.fromJSON(
			{ ...ONSET, lineMinDay: 2, lineMaxDay: 5 },
			plot.plot.data[0]
		);
		const plain = PhaseMarkerClass.fromJSON({ ...ONSET }, plot.plot.data[0]);
		expect(own.fitPoints.xs).toEqual(plain.fitPoints.xs);
		expect(own.linearRegression.slope).toBe(plain.linearRegression.slope);
	});

	it('unticking one day on one series changes only that series', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		const before1 = stats(inst(plot, 1));
		const before0 = stats(inst(plot, 0));
		const store = inst(plot, 0).writableStore();
		const next = [...store.selectedPeriods];
		while (next.length <= 3) next.push(true);
		next[3] = false;
		store.selectedPeriods = next;
		expect(stats(inst(plot, 0)).n).toBe(before0.n - 1);
		expect(stats(inst(plot, 0)).tau).not.toBe(before0.tau);
		expect(stats(inst(plot, 1))).toEqual(before1);
		// It is series DATA: ruleData on series 0 only, and no history entry.
		expect(plot.plot.data[0].ruleData.r1.selectedPeriods[3]).toBe(false);
		expect(plot.plot.data[1].ruleData.r1).toBeUndefined();
	});

	it('a day outside the range stays out even when ticked, and a tick outside it is kept', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, { ...ONSET, lineMinDay: 3 });
		const m = inst(plot, 0);
		expect(m.selectedMask[0]).toBe(false);
		expect(m.selectedMask[1]).toBe(false);
		expect(m.store.selectedPeriods[0] ?? true).toBe(true);
	});
});

describe('detach, reattach, promote', () => {
	it('detach makes an own block that computes EXACTLY what its instance did', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, { ...ONSET, lineMinDay: 2, lineMaxDay: 6 });
		// Lock tau Fixed through the rule, so the fixed-value encoding is exercised too.
		setRuleSettings(plot.plot, plot.plot.markerRules[0], {
			lockTau: 'fixed',
			fixedTau: seedFixedValue(plot.plot, plot.plot.markerRules[0], 'tau')
		});
		const expected = stats(inst(plot, 1));
		detachRecorded(inst(plot, 1));
		const d1 = plot.plot.data[1];
		expect(d1.ruleInstances).toHaveLength(0);
		expect(d1.detachedRules).toEqual(['r1']);
		const block = d1.phaseMarkers[0];
		expect(block.fromRule).toBe('r1');
		expect(block.fitWithinRange).toBe(true);
		expect(block.lockTau).toBe('fixed');
		expect(stats(block)).toEqual(expected);
		// Series 0 is still on the rule.
		expect(inst(plot, 0)).toBeInstanceOf(RuleInstance);
	});

	it('after a detach, the other series still follows a rule edit and the detached one does not', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		detachRecorded(inst(plot, 1));
		const detachedStats = stats(plot.plot.data[1].phaseMarkers[0]);
		const s0 = stats(inst(plot, 0));
		setRuleSettings(plot.plot, plot.plot.markerRules[0], { templateHrsBefore: 5 });
		expect(stats(inst(plot, 0))).not.toEqual(s0);
		expect(stats(plot.plot.data[1].phaseMarkers[0])).toEqual(detachedStats);
	});

	it('correcting a detected onset on an instance detaches that series (Decision 5a)', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		const m = inst(plot, 0);
		const row = m.markers.findIndex((v) => Number.isFinite(v));
		detachRecorded(m, (b) => b.editMarker(row, 5));
		const d0 = plot.plot.data[0];
		expect(d0.ruleInstances).toHaveLength(0);
		expect(d0.phaseMarkers[0].fromRule).toBe('r1');
		expect(d0.phaseMarkers[0].type).toBe('manual');
		expect(history.undoStack).toHaveLength(2); // add rule, detach+edit
		expect(inst(plot, 1)).toBeInstanceOf(RuleInstance);
	});

	it('reattach restores the instance and the per-day choices, discarding the block', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		const store = inst(plot, 1).writableStore();
		store.selectedPeriods = [true, false, true, true, true, true, true];
		const expected = stats(inst(plot, 1));
		detachRecorded(inst(plot, 1));
		const block = plot.plot.data[1].phaseMarkers[0];
		// A settings change on the detached block, which the reattach discards.
		block.templateHrsBefore = 6;
		expect(reattachRecorded(block)).toBe(true);
		const d1 = plot.plot.data[1];
		expect(d1.phaseMarkers).toHaveLength(0);
		expect(d1.detachedRules).toEqual([]);
		expect(inst(plot, 1).store.selectedPeriods[1]).toBe(false);
		expect(stats(inst(plot, 1))).toEqual(expected);
	});

	it('promote turns an own block into a rule: identical numbers on its series, instances elsewhere', () => {
		const plot = restActogram((inner) => {
			inner.data[0].phaseMarkers = [{ ...ONSET, name: 'Onsets', colour: '#123456' }];
		});
		const block = plot.plot.data[0].phaseMarkers[0];
		const expected = stats(block);
		promoteRecorded(block);
		const inner = plot.plot;
		expect(inner.markerRules).toHaveLength(1);
		const rule = inner.markerRules[0];
		expect(rule.name).toBe('Onsets');
		expect(rule.colour).toBe('#123456');
		expect(inner.data[0].phaseMarkers).toHaveLength(0);
		expect(stats(inst(plot, 0, rule.id))).toEqual(expected);
		expect(inst(plot, 1, rule.id)).toBeInstanceOf(RuleInstance);
		expect(history.undoStack).toHaveLength(1);
	});
});

describe('history: one undo step per action, back to the exact prior JSON', () => {
	it('add, setting edit, detach, reattach, promote, delete: each one step, each undoes exactly', () => {
		const plot = restActogram((inner) => {
			inner.data[1].phaseMarkers = [{ ...ONSET, name: 'own' }];
		});
		const steps = [];
		const record = (label, fn) => {
			const before = snap(plot.plot);
			const n = history.undoStack.length;
			fn();
			expect(history.undoStack.length, label).toBe(n + 1);
			steps.push({ label, before });
		};
		record('add', () => addRuleRecorded(plot.plot, ONSET));
		record('edit', () =>
			setRuleSettings(plot.plot, plot.plot.markerRules[0], { templateHrsAfter: 4 })
		);
		record('detach', () => detachRecorded(inst(plot, 0)));
		record('reattach', () => reattachRecorded(plot.plot.data[0].phaseMarkers[0]));
		record('promote', () =>
			promoteRecorded(plot.plot.data[1].phaseMarkers.find((m) => m.name === 'own'))
		);
		record('delete', () => removeRuleRecorded(plot.plot, plot.plot.markerRules[0]));
		for (const { label, before } of steps.reverse()) {
			history.undo();
			expect(snap(plot.plot), label).toEqual(before);
		}
	});

	it('a rule setting edit is applied IN PLACE: the inner object survives the edit and its undo', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		const inner = plot.plot;
		const i0 = inst(plot, 0);
		setRuleSettings(inner, inner.markerRules[0], { centileThreshold: 70 });
		history.undo();
		expect(plot.plot).toBe(inner);
		expect(inst(plot, 0)).toBe(i0);
		expect(inner.markerRules[0].centileThreshold).toBe(50);
		history.redo();
		expect(inner.markerRules[0].centileThreshold).toBe(70);
	});

	it('the setMarkerRule op refuses a taken name and never patches the id', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, { ...ONSET, name: 'A' });
		addRuleRecorded(plot.plot, { ...ONSET, name: 'B' });
		const [a] = plot.plot.markerRules;
		expect(setRuleSettings(plot.plot, a, { name: 'B' })).toBe(false);
		expect(setRuleSettings(plot.plot, a, { id: 'r9' })).toBe(false);
		expect(a.id).toBe('r1');
		expect(a.name).toBe('A');
	});
});

describe('persistence', () => {
	it('round-trips rules, rule data, detachments and fromRule, and rebuilds the instances', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, { ...ONSET, lineMinDay: 2, colour: '#aa0000' });
		addRuleRecorded(plot.plot, { ...ONSET, type: 'offset' });
		inst(plot, 0).writableStore().selectedPeriods = [true, true, false];
		detachRecorded(inst(plot, 1, 'r2'));
		const json = snap(plot.plot);
		expect(json.markerRules.map((r) => r.id)).toEqual(['r1', 'r2']);
		expect(json.nextRuleId).toBe(3);
		expect(json.data[0].ruleData.r1.selectedPeriods).toEqual([true, true, false]);
		expect(json.data[1].detachedRules).toEqual(['r2']);
		expect(json.data[1].phaseMarkers[0].fromRule).toBe('r2');

		const entry = appConsts.plotMap.get('actogram');
		const again = entry.data.fromJSON(plot, json);
		expect(snap(again)).toEqual(json);
		expect(again.data[0].ruleInstances.map((i) => i.ruleId)).toEqual(['r1', 'r2']);
		expect(again.data[1].ruleInstances.map((i) => i.ruleId)).toEqual(['r1']);
		expect(stats(again.data[0].ruleInstances[0])).toEqual(stats(inst(plot, 0)));
	});

	it('a deleted rule id is never reused, even after a save with no rules left', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		detachRecorded(inst(plot, 0));
		removeRuleRecorded(plot.plot, plot.plot.markerRules[0]);
		const json = snap(plot.plot);
		expect(json.markerRules).toBeUndefined();
		expect(json.nextRuleId).toBe(2);
		const again = appConsts.plotMap.get('actogram').data.fromJSON(plot, json);
		expect(again.nextRuleId).toBe(2);
		// Even with nextRuleId stripped, the dead id on the detached block is respected.
		delete json.nextRuleId;
		const repaired = appConsts.plotMap.get('actogram').data.fromJSON(plot, json);
		expect(repaired.nextRuleId).toBe(2);
		expect(uniqueRuleName(repaired, 'Rule 2')).toBe('Rule 2');
	});

	it('wrong shapes load safely: bad rules dropped, bad rule data ignored', () => {
		const plot = restActogram();
		const json = snap(plot.plot);
		json.markerRules = [
			null,
			7,
			{ id: 'nope' },
			{ id: 'r1', type: 'bogus', templateHrsBefore: 'x' },
			{ id: 'r1' }
		];
		json.data[0].ruleData = { r1: { selectedPeriods: 'no', manualMarkers: [1, 'a', NaN] }, zz: {} };
		json.data[0].detachedRules = ['r1', 5, 'bad'];
		json.data[1].ruleData = [1, 2];
		const again = appConsts.plotMap.get('actogram').data.fromJSON(plot, json);
		expect(again.markerRules.map((r) => r.id)).toEqual(['r1']);
		expect(again.markerRules[0].type).toBe('onset');
		expect(again.markerRules[0].templateHrsBefore).toBe(3);
		expect(again.data[0].ruleData).toEqual({ r1: { selectedPeriods: [], manualMarkers: [1] } });
		expect(again.data[0].detachedRules).toEqual(['r1']);
		expect(again.data[1].ruleData).toEqual({});
		expect(again.data[0].ruleInstances).toHaveLength(0);
		expect(again.data[1].ruleInstances).toHaveLength(1);
	});

	it('every shipped actogram session loads unchanged: no rule keys, no instances', () => {
		const dir = join(ROOT, 'static', 'sessions');
		const files = [];
		const walk = (d) => {
			for (const f of readdirSync(d, { withFileTypes: true })) {
				const p = join(d, f.name);
				if (f.isDirectory()) walk(p);
				else if (f.name.endsWith('.json')) files.push(p);
			}
		};
		walk(dir);
		let n = 0;
		for (const file of files) {
			const raw = JSON.parse(readFileSync(file, 'utf8'));
			for (const pj of raw.plots ?? []) {
				if (pj.type !== 'actogram') continue;
				loadSession(file);
				const plot = Plot.fromJSON(pj);
				const json = snap(plot.plot);
				expect(json.markerRules).toBeUndefined();
				expect(json.nextRuleId).toBeUndefined();
				for (const d of json.data) {
					expect(d.ruleData).toBeUndefined();
					expect(d.detachedRules).toBeUndefined();
					for (const m of d.phaseMarkers) {
						expect(m.fromRule).toBeUndefined();
						expect(m.fitWithinRange).toBeUndefined();
					}
				}
				for (const d of plot.plot.data) expect(d.ruleInstances).toEqual([]);
				n++;
			}
		}
		expect(n).toBeGreaterThanOrEqual(15);
	});
});

describe('the model on its own', () => {
	it('MarkerRule round-trips and guards its fields', () => {
		const r = new MarkerRule({ id: 'r3', name: 'X', fixedTau: -1, lineMinDay: 0, colour: '' });
		expect(r.fixedTau).toBeNull();
		expect(r.lineMinDay).toBeNull();
		expect(r.colour).toBeNull();
		expect(MarkerRule.fromJSON(r.toJSON()).toJSON()).toEqual(r.toJSON());
	});

	it('reconcile keeps instances whose rule object is unchanged and drops removed rules', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		addRuleRecorded(plot.plot, ONSET);
		const d = plot.plot.data[0];
		const arr = d.ruleInstances;
		reconcileRuleInstances(plot.plot);
		expect(d.ruleInstances).toBe(arr);
		plot.plot.markerRules = plot.plot.markerRules.slice(1);
		reconcileRuleInstances(plot.plot);
		expect(d.ruleInstances.map((i) => i.ruleId)).toEqual(['r2']);
		expect(d.ruleInstances[0]).toBe(arr[1]);
	});

	it('an instance refuses a direct settings write (it must detach first)', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, ONSET);
		expect(() => {
			inst(plot, 0).cfg.templateHrsBefore = 9;
		}).toThrow();
	});
});
