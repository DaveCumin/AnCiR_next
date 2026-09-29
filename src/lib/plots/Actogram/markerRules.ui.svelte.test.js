// @ts-nocheck
/**
 * Marker rules through the REAL components and the facet projection (plan 2026-09-30
 * actogram marker rules, Phase A tests "Facet" and "Legend", and the drag on an instance).
 *
 *   - Dragging a rule instance's line on the plot is a settings change on that series only:
 *     it detaches that series, as ONE undo step, and the other series keeps the rule.
 *   - A faceted generator's rule is projected onto every panel; a rule SETTING edit is a
 *     leaf MIRROR on the panels (same instance objects), a detach is a REBUILD of that
 *     panel only, and a drag on panel 2's instance detaches generator series 2 and no other.
 *   - Legend: a fixed-colour rule is ONE entry; a series-colour rule is one per series.
 *   - The Data tab shows the rule section with its "applies to all N series" note, and each
 *     series shows the rule instance with editable per-day ticks.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { core, appConsts, appState, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { panelsFor, projectPanel } from '$lib/core/facetPanels.svelte.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import PhaseMarker from './PhaseMarker.svelte';
import Actogram from './Actogram.svelte';
import { RuleInstance } from './markerRules.svelte.js';
import { addRuleRecorded, setRuleSettings, detachRecorded } from './markerRuleActions.js';

// The Data tab's series blocks slide in; happy-dom has no Web Animations.
Element.prototype.animate ??= () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });

const ROOT = process.cwd();
const FREE = join(ROOT, 'static', 'sessions', 'demos', 'demo-workflow-free-running.json');
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

/** The free-running demo's actogram with its one series twice (optionally faceted). */
function twoSeriesActogram({ facet = false } = {}) {
	const session = loadSession(FREE);
	const pj = session.plots.find((p) => p.type === 'actogram');
	const s0 = structuredClone(pj.plot.data[0]);
	const s1 = structuredClone(pj.plot.data[0]);
	for (const s of [s0, s1]) {
		delete s.x.id;
		delete s.y.id;
		s.phaseMarkers = [];
	}
	s1.colour = '#cc3311';
	pj.plot.data = [s0, s1];
	pj.facet = facet;
	pj.width = 600;
	pj.height = 500;
	const plot = Plot.fromJSON(pj);
	core.plots.push(plot);
	return plot;
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
	return render(PhaseMarker, { props: { marker, which: 'plot' } }, { container: host });
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

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
});
beforeEach(() => {
	history.init();
	history.clear();
});
afterEach(() => cleanup());

describe('dragging a rule instance line', () => {
	it('detaches THAT series with the dragged line, as one undo step; the other keeps the rule', () => {
		const plot = twoSeriesActogram();
		addRuleRecorded(plot.plot, ONSET);
		const i1 = plot.plot.data[1].ruleInstances[0];
		const other = plot.plot.data[0].ruleInstances[0];
		const otherReg = { ...other.linearRegression };
		const before2 = { ...i1.linearRegression };
		const { container } = renderInSvg(i1);
		const from = pointOnLine(i1, 7);
		drag(container, from, { x: from.x + 40, y: from.y }, 6);

		expect(history.undoStack).toHaveLength(2); // add rule, drag+detach
		const d1 = plot.plot.data[1];
		expect(d1.ruleInstances).toHaveLength(0);
		expect(d1.detachedRules).toEqual(['r1']);
		const block = d1.phaseMarkers[0];
		expect(block.fromRule).toBe('r1');
		expect(block.lockTheta).toBe('fixed');
		expect(block.lockTau).toBe('fit');
		expect(block.linearRegression.intercept).not.toBeCloseTo(before2.intercept, 6);
		// The rule itself never moved, and series 1 still follows it.
		expect(plot.plot.markerRules[0].lockTheta).toBe('fit');
		const again = plot.plot.data[0].ruleInstances[0];
		expect(again.linearRegression.intercept).toBeCloseTo(otherReg.intercept, 9);
		history.undo();
		expect(plot.plot.data[1].ruleInstances).toHaveLength(1);
		expect(plot.plot.data[1].phaseMarkers).toHaveLength(0);
	});
});

describe('faceted actogram: panels project the generator rules', () => {
	it('every panel shows the rule; a setting edit MIRRORS; a detach rebuilds only its panel', () => {
		const gen = twoSeriesActogram({ facet: true });
		const panels = panelsFor(gen);
		expect(panels).toHaveLength(2);
		for (const p of panels) projectPanel(p);
		addRuleRecorded(gen.plot, ONSET);
		for (const p of panels) expect(projectPanel(p).mode).toBe('rebuild');
		for (const p of panels) {
			expect(p.plot.data[0].ruleInstances.map((i) => i.ruleId)).toEqual(['r1']);
			expect(p.plot.data[0].ruleInstances[0]).toBeInstanceOf(RuleInstance);
		}
		const kept = panels.map((p) => p.plot.data[0].ruleInstances[0]);

		setRuleSettings(gen.plot, gen.plot.markerRules[0], { centileThreshold: 60 });
		for (const [k, p] of panels.entries()) {
			const r = projectPanel(p);
			expect(r.mode).toBe('mirror');
			expect(r.paths).toEqual(['markerRules[0].centileThreshold']);
			expect(p.plot.data[0].ruleInstances[0]).toBe(kept[k]);
			expect(kept[k].cfg.centileThreshold).toBe(60);
		}

		detachRecorded(gen.plot.data[1].ruleInstances[0]);
		expect(projectPanel(panels[0]).mode).toBe('noop');
		expect(projectPanel(panels[1]).mode).toBe('rebuild');
		expect(panels[0].plot.data[0].ruleInstances).toHaveLength(1);
		expect(panels[1].plot.data[0].ruleInstances).toHaveLength(0);
		expect(panels[1].plot.data[0].phaseMarkers[0].fromRule).toBe('r1');
	});

	it('a same-length detachment change (r1 back, r2 out, one step) REBUILDS the panel', () => {
		const gen = twoSeriesActogram({ facet: true });
		const panels = panelsFor(gen);
		addRuleRecorded(gen.plot, ONSET);
		addRuleRecorded(gen.plot, { ...ONSET, type: 'offset' });
		detachRecorded(gen.plot.data[1].ruleInstances[0]);
		for (const p of panels) projectPanel(p);
		expect(panels[1].plot.data[0].ruleInstances.map((i) => i.ruleId)).toEqual(['r2']);
		// Swap which rule series 2 is detached from, keeping every array the same length.
		const d = gen.plot.data[1];
		d.detachedRules = ['r2'];
		d.phaseMarkers[0].fromRule = 'r2';
		expect(projectPanel(panels[1]).mode).toBe('rebuild');
		expect(panels[1].plot.data[0].ruleInstances.map((i) => i.ruleId)).toEqual(['r1']);
	});

	it("a drag on panel 2's instance detaches generator series 2 and no other", () => {
		const gen = twoSeriesActogram({ facet: true });
		const panels = panelsFor(gen);
		addRuleRecorded(gen.plot, ONSET);
		for (const p of panels) projectPanel(p);
		const copy = panels[1].plot.data[0].ruleInstances[0];
		const { container } = renderInSvg(copy);
		const from = pointOnLine(copy, 7);
		drag(container, from, { x: from.x + 40, y: from.y });

		expect(gen.plot.data[1].detachedRules).toEqual(['r1']);
		expect(gen.plot.data[1].phaseMarkers[0].lockTheta).toBe('fixed');
		expect(gen.plot.data[0].detachedRules).toEqual([]);
		expect(gen.plot.data[0].ruleInstances).toHaveLength(1);
		expect(history.undoStack.at(-1).forward.id).toBe(gen.id);
		// The panel's copy previewed the drag in its local override and was rewound.
		expect(copy.local).toBeNull();
	});
});

describe('legend', () => {
	it('a rule in each series colour gives one entry per series, labelled "<series>: <rule>"', () => {
		const plot = twoSeriesActogram();
		addRuleRecorded(plot.plot, { ...ONSET, name: 'Onsets' });
		const labels = plot.plot.getLegendItems.map((i) => i.label);
		const names = plot.plot.data.map((d) => `${d.displayLabel}: Onsets`);
		expect(labels.filter((l) => l.endsWith(': Onsets'))).toEqual(names);
		const colours = plot.plot.getLegendItems
			.filter((i) => i.label.endsWith(': Onsets'))
			.map((i) => i.elements[0].color);
		expect(colours).toEqual(plot.plot.data.map((d) => d.colour));
	});

	it('a FIXED-colour rule is ONE entry, after the series', () => {
		const plot = twoSeriesActogram();
		addRuleRecorded(plot.plot, { ...ONSET, name: 'Onsets', colour: '#00aa00' });
		const items = plot.plot.getLegendItems;
		const rule = items.filter((i) => i.label === 'Onsets');
		expect(rule).toHaveLength(1);
		expect(rule[0].elements.map((e) => e.type)).toEqual(['points', 'line']);
		expect(rule[0].elements[0].color).toBe('#00aa00');
		expect(items.at(-1).label).toBe('Onsets');
		expect(items.some((i) => i.label.endsWith(': Onsets'))).toBe(false);
	});
});

describe('the Data tab', () => {
	it('shows the rule section with its note, the summary table, and an instance under each series', async () => {
		const session = loadSession(REST);
		const plot = Plot.fromJSON(session.plots.find((p) => p.type === 'actogram'));
		core.plots.push(plot);
		addRuleRecorded(plot.plot, { ...ONSET, name: 'Onsets' });
		appState.currentControlTab = 'data';
		const r = render(Actogram, { props: { theData: plot.plot, which: 'controls' } });
		const text = r.container.textContent;
		expect(text).toContain('Marker rules');
		expect(text).toContain('Applies to all 2 series');
		expect(r.container.querySelectorAll('.rule-summary li')).toHaveLength(2);
		expect(r.container.querySelectorAll('[data-rule-instance="r1"]')).toHaveLength(2);
		expect(r.container.textContent).toContain('Changing a setting here detaches');

		// Unticking a day on the first series' instance writes that series' ruleData only.
		const inst0 = r.container.querySelectorAll('[data-rule-instance="r1"]')[0];
		const box = inst0.querySelector('.period-marker-row input[type="checkbox"]');
		await fireEvent.change(box, { target: { checked: false } });
		flushSync();
		expect(Object.keys(plot.plot.data[0].ruleData)).toEqual(['r1']);
		expect(plot.plot.data[1].ruleData).toEqual({});
		expect(history.undoStack).toHaveLength(1); // only the add

		// The instance's Detach button detaches that series (one step) and the note follows.
		const detach = [...inst0.querySelectorAll('button')].find((b) => b.textContent === 'Detach');
		await fireEvent.click(detach);
		flushSync();
		expect(plot.plot.data[0].detachedRules).toEqual(['r1']);
		expect(history.undoStack).toHaveLength(2);
		cleanup();
		const r2 = render(Actogram, { props: { theData: plot.plot, which: 'controls' } });
		expect(r2.container.textContent).toContain('1 of 2 series; 1 detached');
		expect(r2.container.textContent).toContain('Detached from Onsets');
		expect(r2.container.textContent).toContain('Reattach to rule');
	});
});
