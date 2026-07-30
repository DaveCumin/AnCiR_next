// Guard: axes must not draw outer tick stubs on the domain path.
//
// d3's `tickSize(n)` sets the OUTER tick size as well as the inner one, and the
// outer size is what turns a stub in at each end of the domain path: a bottom
// axis renders `M0,6V0H446V6`, a 6px vertical at each end. Those stubs look like
// ticks but belong to the domain line, so nothing about the tick scale removes
// them. On a categorical axis (Boxplot, MeanSEM) the real ticks sit one per
// category via `manualTicks`, and the two end stubs mark no category at all.
//
// The first half of this file is the real assertion, run against d3 itself, so it
// verifies the BEHAVIOUR rather than the source text: with the configuration
// Axis.svelte uses, the emitted domain path must have no vertical segments.
//
// The second half is a source check on Axis.svelte, because the behavioural test
// cannot see whether the component actually applies that configuration. It was
// duplicated across four position branches before, which is precisely why the
// outer size went unnoticed for so long, so the check also pins the
// single-helper shape.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { axisBottom, axisLeft } from 'd3-axis';
import { scaleLinear } from 'd3-scale';
import { select } from 'd3-selection';

const HERE = dirname(fileURLToPath(import.meta.url));
const AXIS_SRC = readFileSync(join(HERE, 'Axis.svelte'), 'utf8');

/** Render an axis into a detached SVG and return its domain path `d`. */
function domainPathFor(axisFactory, configure) {
	const scale = scaleLinear().domain([0, 3]).range([0, 446]);
	const svg = select(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
	const g = svg.append('g');
	g.call(configure(axisFactory(scale).tickValues([0, 1, 2, 3])));
	return g.select('path.domain').attr('d');
}

describe('axis outer tick size', () => {
	it('the old configuration produced end stubs (this is the bug being guarded)', () => {
		// tickSize(6) sets inner AND outer, so the domain path gains a vertical at
		// each end. Asserting the bug reproduces keeps this test honest: if d3 ever
		// changed this behaviour, the guard below would pass for the wrong reason.
		const d = domainPathFor(axisBottom, (a) => a.tickSize(6).tickPadding(4));
		expect(d).toMatch(/V/);
	});

	it('tickSizeInner + tickSizeOuter(0) emits a domain line with no end stubs', () => {
		const configure = (a) => a.tickSizeInner(6).tickSizeOuter(0).tickPadding(4);
		expect(domainPathFor(axisBottom, configure)).not.toMatch(/V/);
		// The left axis is the mirror case: its stubs are horizontal, so the
		// no-stub form must have no H segment instead.
		expect(domainPathFor(axisLeft, configure)).not.toMatch(/H/);
	});

	it('inner ticks are still drawn at full length', () => {
		// Guards against "fixing" this by zeroing tickSize outright, which would
		// remove the real ticks along with the stubs.
		const configure = (a) => a.tickSizeInner(6).tickSizeOuter(0).tickPadding(4);
		const scale = scaleLinear().domain([0, 3]).range([0, 446]);
		const svg = select(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
		const g = svg.append('g');
		g.call(configure(axisBottom(scale).tickValues([0, 1, 2, 3])));
		const lines = g.selectAll('.tick line').nodes();
		expect(lines.length).toBe(4);
		expect(lines.every((l) => l.getAttribute('y2') === '6')).toBe(true);
	});
});

describe('Axis.svelte applies it', () => {
	it('never calls tickSize(), which would set the outer size too', () => {
		expect(AXIS_SRC).not.toMatch(/\.tickSize\(/);
	});

	it('sets tickSizeOuter(0)', () => {
		expect(AXIS_SRC).toMatch(/\.tickSizeOuter\(0\)/);
	});

	it('configures tick sizing in exactly one place', () => {
		// Four duplicated branches are why the outer size was missed. If a future
		// change reintroduces per-branch tick sizing, this fails and points at the
		// helper.
		const inner = AXIS_SRC.match(/\.tickSizeInner\(/g) ?? [];
		expect(inner.length).toBe(1);
	});

	it('applies the helper for all four axis positions', () => {
		const applications = AXIS_SRC.match(/axis = configureTicks\(axis\)/g) ?? [];
		expect(applications.length).toBe(4);
	});
});
