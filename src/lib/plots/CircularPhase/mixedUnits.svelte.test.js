// @ts-nocheck
/**
 * A Circular phase plot mixing a TIMED series (time wired) with an UNTIMED one recorded in
 * degrees or radians.
 *
 * With any time wired the plot works in clock hours (displayPeriod stays in hours, because a
 * timed series' angle is its time of day). The untimed series' values used to be read as hours
 * too, whatever `unit` said: 90 degrees was drawn at 90 h, which wraps to 18 h on a 24 h clock,
 * instead of 6 h. They are now converted from `unit` into hours before they are placed, binned,
 * wedged and hovered, and the mean vector follows. The unit select stays visible in that mixed
 * case (an untimed series still needs it) and hides only when every series is timed. Bin widths
 * stay in hours (the v82.6 decision).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { core, appState } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { pUpperFromF } from '$lib/utils/fdist.js';
import { watsonWilliams, toRadiansColumn } from '$lib/utils/circular.js';
import CircularPhase, { CircularPhaseClass } from './CircularPhase.svelte';

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
	appState.currentControlTab = 'properties';
});
afterEach(() => cleanup());

function mkCol(type, values) {
	const c = new Column({ type, data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

const t0 = Date.UTC(2026, 0, 1);
const timed = () => ({
	x: { refId: mkCol('time', [t0, t0 + 3.6e6, t0 + 7.2e6, t0 + 10.8e6]) },
	y: { refId: mkCol('number', [1, 2, 3, 2]) }
});
const untimed = (values) => ({ y: { refId: mkCol('number', values) } });

const DEG = [80, 85, 90, 95, 100]; // 6 h on a 24 h clock, give or take 20 min
const HOURS = DEG.map((d) => (d / 360) * 24);
const RAD = DEG.map((d) => (d * Math.PI) / 180);

function makePlot(unit, ...series) {
	const wrapper = { id: 1, type: 'circularphase', name: 'c', width: 400, height: 400, plot: null };
	const p = new CircularPhaseClass(wrapper, null);
	wrapper.plot = p;
	for (const s of series) p.addData(s);
	p.unit = unit;
	return p;
}

/**
 * The `d` of every series' points path, the wedges and the mean vectors, as drawn, with the
 * coordinates rounded to 1e-6 px (a degree and an hour reach the same angle by different
 * floating-point routes).
 */
function drawn(p) {
	const { container } = render(CircularPhase, { props: { theData: p.parentBox, which: 'plot' } });
	flushSync();
	const out = [...container.querySelectorAll('path')].map((e) =>
		e.getAttribute('d').replace(/-?\d+\.\d+/g, (n) => String(Math.round(Number(n) * 1e6) / 1e6))
	);
	cleanup();
	return out;
}

describe('Circular phase plot: timed and untimed series together', () => {
	for (const [unit, values] of [
		['degrees', DEG],
		['radians', RAD]
	]) {
		describe(`untimed series in ${unit}`, () => {
			it('converts the untimed values to clock hours for placement', () => {
				const p = makePlot(unit, timed(), untimed(values));
				const u = p.data[1];
				expect(p.displayUnit).toBe('hours');
				expect(p.displayPeriod).toBe(24);
				u.placeValues.forEach((v, i) => expect(v).toBeCloseTo(HOURS[i], 10));
				// The values themselves are untouched (tooltips show them as recorded).
				expect(u.rawValues).toEqual(values);
			});

			it('puts the mean vector at 6 h, with the same R, z and p as the values in their unit', () => {
				const mixed = makePlot(unit, timed(), untimed(values)).data[1].stats;
				const alone = makePlot(unit, untimed(values)).data[0].stats;
				expect(mixed.meanValue).toBeCloseTo(6, 10);
				expect(mixed.R).toBeCloseTo(alone.R, 12);
				expect(mixed.z).toBeCloseTo(alone.z, 12);
				expect(mixed.pValue).toBeCloseTo(alone.pValue, 12);
				expect(mixed.n).toBe(values.length);
			});

			for (const placement of ['stack', 'bin', 'rim']) {
				it(`draws points, wedges and vectors where the same phases in hours go (${placement})`, () => {
					const asUnit = makePlot(unit, timed(), untimed(values));
					const asHours = makePlot('hours', timed(), untimed(HOURS));
					for (const p of [asUnit, asHours]) {
						p.placement = placement;
						p.binWidth = 1; // hours in a mixed plot (v82.6), whatever `unit` is
						p.showWedges = true;
						p.wedgeBinWidth = 2;
					}
					const a = drawn(asUnit);
					const b = drawn(asHours);
					expect(a.length).toBeGreaterThan(3);
					expect(a).toEqual(b);
				});
			}
		});
	}

	it('Watson-Williams compares the untimed groups in their own unit', () => {
		const p = makePlot('degrees', timed(), untimed(DEG), untimed(DEG.map((d) => d + 90)));
		p.showWatsonWilliams = true;
		const expected = watsonWilliams(
			[
				toRadiansColumn(DEG, 'degrees'),
				toRadiansColumn(
					DEG.map((d) => d + 90),
					'degrees'
				)
			],
			pUpperFromF
		);
		expect(p.ww.valid).toBe(true);
		expect(p.ww.F).toBeCloseTo(expected.F, 10);
		expect(p.ww.pValue).toBeCloseTo(expected.pValue, 10);
	});

	it('leaves an untimed-only plot in its own unit', () => {
		const p = makePlot('degrees', untimed(DEG));
		expect(p.displayUnit).toBe('degrees');
		expect(p.data[0].placeValues).toEqual(DEG);
		expect(p.data[0].stats.meanValue).toBeCloseTo(90, 10);
	});
});

describe('Circular phase "Values are in" select', () => {
	function unitSelect(p) {
		const r = render(CircularPhase, { props: { theData: p, which: 'controls' } });
		const select = [...r.container.querySelectorAll('label.control-input')]
			.find((l) => l.querySelector('.ci-label')?.textContent.trim() === 'Values are in')
			?.querySelector('select');
		return { ...r, select };
	}

	it('shows in a mixed plot, saying untimed series are converted', () => {
		const { select, container } = unitSelect(makePlot('degrees', timed(), untimed(DEG)));
		expect(select).toBeTruthy();
		expect(select.value).toBe('degrees');
		expect(container.textContent).toMatch(/series without a time are read in the unit\s+below/i);
	});

	it('hides when every series is timed (nothing is read in it)', () => {
		const { select, container } = unitSelect(makePlot('degrees', timed(), timed()));
		expect(select).toBeUndefined();
		expect(container.textContent).toMatch(/angle is always clock hours/i);
	});

	it('shows with no time wired', () => {
		expect(unitSelect(makePlot('degrees', untimed(DEG))).select).toBeTruthy();
	});
});
