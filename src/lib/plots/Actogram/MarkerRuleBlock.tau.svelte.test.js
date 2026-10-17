// @ts-nocheck
/**
 * The rule summary's τ is the τ the rule's OUTPUT PORT reports (Decision 2b: the
 * harmonic-check pick, `harmonicCheck.strongest.peakPeriod`), labelled as the port labels it
 * ("τ (h)"), with the line's fitted slope shown beside it under its own label. When the
 * harmonic check picks τ/2 or 2τ the two differ, and the row is flagged by a glyph (not by
 * colour alone) whose tooltip says which value the port reports.
 *
 * Data: the rest-activity demo (two series, 7 days hourly). A rule with τ FIXED at 47 h has
 * a line slope of 47 h and a harmonic pick of 23.5 h (τ/2); at 12.3 h the pick is 24.6 h
 * (2τ); see harmonicCheck.pin.svelte.test.js. The plain onset rule's pick is its own slope.
 *
 * Cost: the table reads the SAME cached $derived the port reads, so rendering it after the
 * port has been read runs no periodogram at all, and a slope-neutral edit runs none either.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync } from 'svelte';

const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock('$lib/utils/periodogram.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		runPeriodogramCalculation: (...args) => {
			calls.n++;
			return real.runPeriodogramCalculation(...args);
		}
	};
});

import { core, appConsts, appState, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { ruleOutputValues, plotMetricLabel } from '$lib/plots/plotMetricDefs.js';
import MarkerRuleBlock from './MarkerRuleBlock.svelte';
import Actogram from './Actogram.svelte';
import { addRuleRecorded, setRuleSettings, detachRecorded } from './markerRuleActions.js';

Element.prototype.animate ??= () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });

const REST = join(process.cwd(), 'static', 'sessions', 'demos', 'demo-workflow-rest-activity.json');

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

/** A rest-activity actogram with one onset rule, optionally with τ fixed. */
function ruleActogram(fixedTau = null) {
	const plot = restActogram();
	addRuleRecorded(plot.plot, { type: 'onset', templateHrsBefore: 3, templateHrsAfter: 3 });
	const rule = plot.plot.markerRules[0];
	if (fixedTau != null) setRuleSettings(plot.plot, rule, { lockTau: 'fixed', fixedTau });
	return { plot, rule };
}

/** Each summary row's cells, keyed by their data-stat attribute. */
function rowsOf(container) {
	return [...container.querySelectorAll('.rule-summary li')].map((li) => {
		const cell = (k) => li.querySelector(`[data-stat="${k}"]`);
		return {
			li,
			cell,
			label: (k) => cell(k)?.querySelector('.stat-label')?.textContent.trim(),
			// The number alone: the disagreement glyph sits beside it, not in it.
			value: (k) => {
				const v = cell(k)?.querySelector('.stat-value')?.cloneNode(true);
				v?.querySelector('.disagree-flag')?.remove();
				return v?.textContent.trim();
			}
		};
	});
}

function tooltipOn(el) {
	el.dispatchEvent(new MouseEvent('mouseenter', { clientX: 10, clientY: 10 }));
	const tip = document.querySelector('.app-tooltip')?.textContent ?? '';
	el.dispatchEvent(new MouseEvent('mouseleave'));
	return tip;
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

describe('rule summary: τ is the port value, the line slope is its own row', () => {
	it('labels τ as the port does and shows the harmonic pick and the slope separately', () => {
		const { plot, rule } = ruleActogram();
		const r = render(MarkerRuleBlock, { props: { inner: plot.plot, rule } });
		const rows = rowsOf(r.container);
		expect(rows).toHaveLength(2);
		// The port's label ends in the same "τ (h)" the table uses.
		expect(plotMetricLabel(plot, `${rule.id}_tau`)).toBe(`${rule.name} τ (h)`);
		plot.plot.data.forEach((d, s) => {
			const inst = d.ruleInstances[0];
			const row = rows[s];
			expect(row.label('tau')).toBe('τ (h)');
			expect(row.value('tau')).toBe(ruleOutputValues(inst).tau.toFixed(2));
			expect(row.label('slope')).toBe('line slope (h)');
			expect(row.value('slope')).toBe(inst.linearRegression.slope.toFixed(2));
			// The pick is τ itself here: no flag.
			expect(inst.harmonicCheck.strongest.label).toBe('τ');
			expect(row.li.classList.contains('tau-disagree')).toBe(false);
			expect(row.li.querySelector('.disagree-flag')).toBeNull();
		});
	});

	it.each([
		[47, '23.50', '47.00', 'τ/2'],
		[12.3, '24.60', '12.30', '2τ']
	])(
		'τ fixed at %s h: τ shows the port pick, the slope row is flagged',
		(fixed, tau, slope, pick) => {
			const { plot, rule } = ruleActogram(fixed);
			const r = render(MarkerRuleBlock, { props: { inner: plot.plot, rule } });
			const rows = rowsOf(r.container);
			plot.plot.data.forEach((d, s) => {
				const inst = d.ruleInstances[0];
				expect(inst.harmonicCheck.strongest.label).toBe(pick);
				const row = rows[s];
				expect(row.value('tau')).toBe(tau);
				expect(row.value('tau')).toBe(ruleOutputValues(inst).tau.toFixed(2));
				expect(row.value('slope')).toBe(slope);
				// Flagged visibly: a class AND a glyph with an accessible name, not colour alone.
				expect(row.li.classList.contains('tau-disagree')).toBe(true);
				const flag = row.cell('slope').querySelector('.disagree-flag');
				expect(flag).toBeTruthy();
				expect(flag.textContent.trim()).not.toBe('');
				expect(flag.getAttribute('aria-label')).toMatch(/disagree/i);
				// The tooltip names both numbers and says which one the port reports.
				const tip = tooltipOn(row.cell('slope'));
				expect(tip).toContain(slope);
				expect(tip).toContain(tau);
				expect(tip).toMatch(/disagree/);
				expect(tip).toMatch(/τ output reports the harmonic check/);
			});
		}
	);

	it('a detached series row shows its detached block the same way', () => {
		const { plot, rule } = ruleActogram(47);
		detachRecorded(plot.plot.data[1].ruleInstances[0]);
		const block = plot.plot.data[1].phaseMarkers.find((m) => m.fromRule === rule.id);
		expect(block).toBeTruthy();
		const r = render(MarkerRuleBlock, { props: { inner: plot.plot, rule } });
		const row = rowsOf(r.container)[1];
		expect(row.li.textContent).toContain('detached');
		expect(row.value('tau')).toBe(ruleOutputValues(block).tau.toFixed(2));
		expect(row.value('tau')).toBe('23.50');
		expect(row.value('slope')).toBe('47.00');
		expect(row.li.classList.contains('tau-disagree')).toBe(true);
	});
});

describe('rule summary: cost of the τ column', () => {
	it('adds no periodogram run after the port has read the check, and none on a slope-neutral edit', () => {
		const { plot, rule } = ruleActogram();
		// The port's read (what the actogram's metric effect does every time).
		for (const d of plot.plot.data) void ruleOutputValues(d.ruleInstances[0]).tau;
		calls.n = 0;
		render(MarkerRuleBlock, { props: { inner: plot.plot, rule } });
		flushSync();
		expect(calls.n).toBe(0);
		setRuleSettings(plot.plot, rule, { lineWidth: 3 });
		flushSync();
		expect(calls.n).toBe(0);
	});
});

describe('per-series instance readout', () => {
	it('labels the harmonic pick τ (h) and shows the line slope, flagged when they disagree', async () => {
		const { plot } = ruleActogram(47);
		appState.currentControlTab = 'overlays';
		const r = render(Actogram, { props: { theData: plot.plot, which: 'controls' } });
		const inst0 = r.container.querySelectorAll('[data-rule-instance="r1"]')[0];
		const details = inst0.querySelector('details.instance-details');
		expect(details.querySelector('summary').textContent).toMatch(/τ check/);
		details.open = true;
		await fireEvent(details, new Event('toggle'));
		flushSync();
		const readout = details.querySelector('.tau-readout');
		expect(readout).toBeTruthy();
		const text = readout.textContent.replace(/\s+/g, ' ');
		expect(text).not.toMatch(/Est τ/);
		expect(text).toContain('τ (h) 23.50');
		expect(text).toContain('line slope (h) 47.00');
		const flag = readout.querySelector('.disagree-flag');
		expect(flag).toBeTruthy();
		expect(tooltipOn(readout.querySelector('.tau-disagree'))).toMatch(
			/τ output reports the harmonic check/
		);
	});

	it('labels the phase φ (h) like its port, keeping the reference day visible', () => {
		const { plot } = ruleActogram(47);
		appState.currentControlTab = 'overlays';
		const r = render(Actogram, { props: { theData: plot.plot, which: 'controls' } });
		const inst0 = r.container.querySelectorAll('[data-rule-instance="r1"]')[0];
		const text = inst0.textContent.replace(/\s+/g, ' ');
		expect(text).not.toMatch(/Est φ/);
		expect(text).not.toMatch(/φ \(day \d+\)/);
		expect(text).toMatch(/φ \(h\) at day \d+: -?\d+\.\d{2}/);
	});
});
