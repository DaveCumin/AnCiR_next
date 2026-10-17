// @ts-nocheck
/**
 * The overlay host contract (overlays plan 2026-10-15, T2): a MINIMAL fake host that meets
 * the contract in overlayHost.js and nothing more, so a hidden read of some other host field
 * shows up as a failure here instead of a silent fallback on the next plot type. Also: form
 * coercion to what a host allows, the shared host helpers, and the two shared components
 * (OverlayLayers, OverlaysTab) driven by that fake host.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { scaleLinear } from 'd3-scale';
import { core } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Scatterplotclass } from '$lib/plots/Scatterplot/Scatterplot.svelte';
import { OverlayClass } from './Overlay.svelte';
import Overlay from './Overlay.svelte';
import OverlayLayers from './OverlayLayers.svelte';
import OverlaysTab from './OverlaysTab.svelte';
import { ALL_OVERLAY_FORMS } from './overlaySpec.js';
import {
	assertOverlayHost,
	overlayExtentOf,
	overlayLegendItems,
	overlaysFromJSON,
	overlaysToJSON,
	overlayDownloadColumns
} from './overlayHost.js';

const H_ONLY = { line: ['horizontal'], band: ['horizontal'], legend: false, xTime: false };
const LINES_ONLY = { line: ['horizontal', 'vertical'], band: [], legend: true, xTime: false };

/** A host class with the given capabilities: the contract, and only the contract. */
function hostClass(caps) {
	return class FakeHost {
		static overlayCapabilities = caps;
		overlays = [];
		padding = { left: 10, top: 5 };
		overlayXScale = scaleLinear().domain([0, 100]).range([0, 200]);
		overlayYScale = scaleLinear().domain([0, 10]).range([100, 0]);
		addOverlay(kind, form) {
			const o = new OverlayClass(this, { kind, form });
			this.overlays.push(o);
			return o;
		}
		removeOverlay(id) {
			const i = this.overlays.findIndex((o) => o.id === id);
			if (i >= 0) this.overlays.splice(i, 1);
		}
		overlayContext() {
			return { xDomainMin: 0, xDomainMax: 100, xAnchorMin: 20, xIsTime: false };
		}
		overlaySeriesColour() {
			return '#123456';
		}
	};
}
const HOnlyHost = hostClass(H_ONLY);
const AllHost = hostClass(ALL_OVERLAY_FORMS);
const LinesOnlyHost = hostClass(LINES_ONLY);

function mkCol(values, type = 'number') {
	const c = new Column({ type, data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('assertOverlayHost', () => {
	it('accepts the minimal fake host and the real Scatterplot', () => {
		expect(assertOverlayHost(new HOnlyHost())).toBe(true);
		const box = { id: 1, width: 400, height: 300 };
		const scatter = new Scatterplotclass(box, null);
		scatter.addData({ x: { refId: mkCol([0, 1, 2]) }, y: { refId: mkCol([3, 4, 5]) } });
		expect(assertOverlayHost(scatter)).toBe(true);
	});

	it('names every missing member', () => {
		expect(() => assertOverlayHost({ overlays: [] })).toThrow(
			'Not an overlay host; missing: static overlayCapabilities, addOverlay(), removeOverlay(), ' +
				'overlayContext(), overlaySeriesColour(), overlayXScale, overlayYScale, padding.left/top'
		);
		const host = new HOnlyHost();
		host.overlayContext = () => ({ xDomainMin: 0, xDomainMax: 1 });
		expect(() => assertOverlayHost(host)).toThrow(
			'missing: overlayContext().xAnchorMin, overlayContext().xIsTime'
		);
	});

	it('an optional member, when present, must have the right type', () => {
		const host = new HOnlyHost();
		host.overlayXTransform = 1;
		host.overlayRangeHint = 'no';
		expect(() => assertOverlayHost(host)).toThrow(
			'missing: overlayXTransform() (optional, but must be a function when present), ' +
				'overlayRangeHint() (optional, but must be a function when present)'
		);
		const Noted = hostClass({ ...H_ONLY, xNote: 42 });
		expect(() => assertOverlayHost(new Noted())).toThrow(
			'missing: overlayCapabilities.xNote (optional, but must be a string when present)'
		);
		const Fine = hostClass({ ...H_ONLY, xNote: 'periods' });
		const fine = new Fine();
		fine.overlayXTransform = (p) => 1 / p;
		expect(assertOverlayHost(fine)).toBe(true);
	});
});

describe('OverlayClass on a host that restricts forms', () => {
	it("a new line starts in the host's first form (horizontal), not the global default", () => {
		const host = new HOnlyHost();
		expect(host.addOverlay('line').form).toBe('horizontal');
		expect(host.addOverlay('band').form).toBe('horizontal');
		expect(new OverlayClass(new AllHost(), { kind: 'line' }).form).toBe('vertical');
	});

	it('a saved form the host does not allow is coerced to its first form of the kind', () => {
		const host = new HOnlyHost();
		const line = OverlayClass.fromJSON(host, {
			kind: 'line',
			form: 'vertical',
			channels: { at: { columns: [], typed: [4] } }
		});
		expect(line.form).toBe('horizontal');
		// `at` exists in both forms, so the typed value survives the coercion.
		expect(line.values('at')).toEqual([4]);
		const band = OverlayClass.fromJSON(host, { kind: 'band', form: 'ribbon' });
		expect(band.form).toBe('horizontal');
		expect(Object.keys(band.channels)).toEqual(['lower', 'upper']);
	});

	it('setForm ignores a form the host does not allow', () => {
		const band = new HOnlyHost().addOverlay('band');
		band.setForm('vertical');
		expect(band.form).toBe('horizontal');
		expect(Object.keys(band.channels)).toEqual(['lower', 'upper']);
	});

	it('reads the ribbon default fill from overlaySeriesColour()', () => {
		expect(new AllHost().addOverlay('band', 'ribbon').fill).toBe('#12345633');
	});

	it('repeating bands draw from overlayContext(), anchored at xAnchorMin', () => {
		const band = new AllHost().addOverlay('band', 'repeating');
		band.repeatEveryHours = 24;
		band.nightDurationHours = 6;
		expect(band.geometry({}).segments).toEqual([
			{ x0: 0, x1: 2 }, // the cycle continued back from the anchor (20 - 24 = -4)
			{ x0: 20, x1: 26 },
			{ x0: 44, x1: 50 },
			{ x0: 68, x1: 74 },
			{ x0: 92, x1: 98 }
		]);
	});

	it('maps x channels (never y) through overlayXValueFor(column)', () => {
		const host = new AllHost();
		const seen = [];
		host.overlayXValueFor = (col) => {
			seen.push(col.refId);
			return (v) => v * 10;
		};
		const id = mkCol([1, 2]);
		const v = host.addOverlay('line', 'vertical');
		v.setWire('at', id);
		const h = host.addOverlay('line', 'horizontal');
		h.setWire('at', id);
		expect(v.values('at')).toEqual([10, 20]);
		expect(h.values('at')).toEqual([1, 2]);
		// Asked once per column read, not once per value.
		expect(seen).toEqual([id]);
	});
});

describe('Scatterplot as a host: overlayXValueFor', () => {
	it('maps an hours column onto a time axis from the reference origin, and is null on a number x', () => {
		const t0 = Date.UTC(2024, 0, 1);
		const box = { id: 1, width: 400, height: 300 };
		const timeScatter = new Scatterplotclass(box, null);
		timeScatter.addData({
			x: { refId: mkCol([t0, t0 + 3600000], 'time') },
			y: { refId: mkCol([1, 2]) }
		});
		const hours = new Column({ refId: mkCol([0, 1.5]) });
		expect(timeScatter.overlayXValueFor(hours)(1.5)).toBe(t0 + 1.5 * 3600000);

		const numScatter = new Scatterplotclass(box, null);
		numScatter.addData({ x: { refId: mkCol([0, 1]) }, y: { refId: mkCol([1, 2]) } });
		expect(numScatter.overlayXValueFor(hours)).toBeNull();
	});
});

describe('host helpers', () => {
	it('overlayExtentOf merges enabled overlays per axis, null when none contributes', () => {
		const host = new AllHost();
		host.addOverlay('line', 'vertical').setTyped('at', [5, 40]);
		host.addOverlay('band', 'horizontal').setTyped('lower', [2]);
		host.overlays[1].setTyped('upper', [3]);
		const off = host.addOverlay('line', 'vertical');
		off.setTyped('at', [500]);
		off.enabled = false;
		expect(overlayExtentOf(host.overlays, 'x')).toEqual([5, 40]);
		expect(overlayExtentOf(host.overlays, 'y')).toEqual([2, 3]);
		expect(overlayExtentOf([], 'x')).toBeNull();
	});

	it('overlayLegendItems: enabled and labelled only, in order', () => {
		const host = new AllHost();
		const a = host.addOverlay('line', 'horizontal');
		a.label = 'a';
		host.addOverlay('line', 'horizontal'); // unlabelled
		const c = host.addOverlay('band', 'horizontal');
		c.label = 'c';
		const d = host.addOverlay('line', 'vertical');
		d.label = 'd';
		d.enabled = false;
		expect(overlayLegendItems(host.overlays).map((i) => i.label)).toEqual(['a', 'c']);
	});

	it('overlayDownloadColumns: one column per resolved channel, x through isoX', () => {
		const host = new AllHost();
		const v = host.addOverlay('line', 'vertical');
		v.name = 'V';
		v.setTyped('at', [1, 2]);
		const b = host.addOverlay('band', 'horizontal');
		b.name = 'B';
		b.setTyped('lower', [3]);
		b.setTyped('upper', [4]);
		const { headers, columns } = overlayDownloadColumns(
			host.overlays,
			host.overlayContext(),
			(x) => `t${x}`
		);
		expect(headers).toEqual(['V_at', 'B_lower', 'B_upper']);
		expect(columns).toEqual([['t1', 't2'], [3], [4]]);
	});

	it('overlaysFromJSON drops a kind the host does not allow, with a warning', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const host = new LinesOnlyHost();
		overlaysFromJSON(host, {
			overlays: [
				{ kind: 'band', name: 'Shade', form: 'horizontal' },
				{ kind: 'line', form: 'vertical', name: 'Keep' }
			],
			nightBands: [{ mode: 'repeating' }]
		});
		expect(host.overlays.map((o) => o.name)).toEqual(['Keep']);
		expect(warn).toHaveBeenCalledWith(
			'Overlay "Shade" (band) dropped: this plot does not support band overlays.'
		);
	});

	it('overlaysFromJSON migrates legacy night bands only when asked, behind the overlays', () => {
		const json = {
			overlays: [{ kind: 'line', form: 'vertical', name: 'L' }],
			nightBands: [{ name: 'Night', mode: 'repeating' }]
		};
		const plain = new AllHost();
		overlaysFromJSON(plain, json);
		expect(plain.overlays.map((o) => o.name)).toEqual(['L']);
		const legacy = new AllHost();
		overlaysFromJSON(legacy, json, { legacyNightBands: true });
		expect(legacy.overlays.map((o) => [o.name, o.form])).toEqual([
			['L', 'vertical'],
			['Night', 'repeating']
		]);
		expect(overlaysToJSON(legacy.overlays).map((o) => o.name)).toEqual(['L', 'Night']);
	});
});

describe('shared components on the fake host', () => {
	it('OverlayLayers draws with the host scales and padding, bands and lines in their own layers', () => {
		const host = new HOnlyHost();
		host.addOverlay('line').setTyped('at', [5]);
		const band = host.addOverlay('band');
		band.setTyped('lower', [2]);
		band.setTyped('upper', [4]);

		const lines = render(OverlayLayers, { props: { inner: host, layer: 'lines' } }).container;
		const rule = lines.querySelector('g.overlay-lines-layer line.overlay-rule');
		// y = top padding + yScale(5) = 5 + 50; spans the x range from the left padding.
		expect(Number(rule.getAttribute('y1'))).toBeCloseTo(55);
		expect(Number(rule.getAttribute('x1'))).toBeCloseTo(10);
		expect(Number(rule.getAttribute('x2'))).toBeCloseTo(210);
		expect(lines.querySelector('rect.band-rect')).toBeNull();

		const bands = render(OverlayLayers, { props: { inner: host, layer: 'bands' } }).container;
		const rect = bands.querySelector('g.overlay-bands-layer rect.band-rect');
		expect(Number(rect.getAttribute('y'))).toBeCloseTo(5 + 60);
		expect(Number(rect.getAttribute('height'))).toBeCloseTo(20);
		expect(bands.querySelector('line.overlay-rule')).toBeNull();
	});

	it('OverlaysTab offers a button only for a kind the host allows, titled with its forms', () => {
		const lineOnly = render(OverlaysTab, { props: { inner: new LinesOnlyHost() } }).container;
		const buttons = [...lineOnly.querySelectorAll('.block-add button')];
		expect(buttons.map((b) => b.textContent.trim())).toEqual(['+ Add line']);
		expect(buttons[0].getAttribute('title')).toBe('Add a reference line (horizontal or vertical)');
	});

	it('the Scatterplot Overlays tab keeps its v81.13 buttons and titles', () => {
		const scatter = new Scatterplotclass({ id: 1, width: 400, height: 300 }, null);
		const { container } = render(OverlaysTab, { props: { inner: scatter } });
		expect(
			[...container.querySelectorAll('.block-add button')].map((b) => [
				b.textContent.trim(),
				b.getAttribute('title')
			])
		).toEqual([
			['+ Add line', 'Add a reference line (vertical or horizontal)'],
			['+ Add band', 'Add a shaded band (ribbon, horizontal, vertical or repeating)']
		]);
	});

	it('a block lists only the forms the host allows, and hides Label without a legend', () => {
		const host = new HOnlyHost();
		const band = host.addOverlay('band');
		const { container } = render(Overlay, {
			props: { overlay: band, inner: host, which: 'controls' }
		});
		const options = [...container.querySelectorAll('select.overlay-form option')];
		expect(options.map((o) => o.value)).toEqual(['horizontal']);
		expect(container.querySelector('input[placeholder="shown in legend when set"]')).toBeNull();

		cleanup();
		const all = new AllHost();
		const ribbon = all.addOverlay('band');
		const full = render(Overlay, {
			props: { overlay: ribbon, inner: all, which: 'controls' }
		}).container;
		expect([...full.querySelectorAll('select.overlay-form option')].map((o) => o.value)).toEqual([
			'ribbon',
			'horizontal',
			'vertical',
			'repeating'
		]);
		expect(full.querySelector('input[placeholder="shown in legend when set"]')).not.toBeNull();
	});
});
