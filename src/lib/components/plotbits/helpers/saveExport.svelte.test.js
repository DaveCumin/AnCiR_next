// The export pipeline behind the Save dialog: one plot, several plots combined, and
// several plots as individual files, each with an optional title band and panel labels.
/* global $state, $effect */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import { core } from '$lib/core/core.svelte';
import {
	normalisePlotIds,
	withPlotSize,
	panelLabel,
	romanNumeral,
	PANEL_LABEL_STYLES,
	preparePlotExport,
	prepareCombinedExport,
	buildExport,
	panelLetter,
	loadExportOptions,
	saveExportOptions,
	EXPORT_OPTION_DEFAULTS,
	EXPORT_OPTIONS_KEY,
	exportFilename,
	saveExport
} from './save.svelte.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
let hosts = [];

/** A live plot svg, id `plotN`, plus its core.plots entry. */
function mountPlot(id, { name = 'Plot ' + id, x = 0, y = 0, w = 200, h = 100, style = null } = {}) {
	const host = document.createElement('div');
	host.innerHTML = `<svg xmlns="${SVG_NS}" id="plot${id}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><circle r="5" /></svg>`;
	document.body.appendChild(host);
	hosts.push(host);
	core.plots.push({ id, name, x, y, width: w, height: h, style });
	return host.querySelector('svg');
}

beforeEach(() => {
	hosts = [];
});
afterEach(() => {
	for (const h of hosts) h.remove();
	core.plots.length = 0;
	try {
		localStorage.removeItem(EXPORT_OPTIONS_KEY);
	} catch {
		/* storage may be unavailable */
	}
});

describe('normalisePlotIds', () => {
	it('accepts a plotN string, a number, or a mixed array, and dedupes', () => {
		expect(normalisePlotIds('plot5')).toEqual([5]);
		expect(normalisePlotIds(5)).toEqual([5]);
		expect(normalisePlotIds(['plot5', 6, '6', 'junk', null])).toEqual([5, 6]);
		expect(normalisePlotIds(undefined)).toEqual([]);
	});
});

describe('panelLetter', () => {
	it('runs a, b, c and keeps going past z', () => {
		expect(panelLetter(0)).toBe('a');
		expect(panelLetter(2)).toBe('c');
		expect(panelLetter(26)).toBe('a1');
	});
});

describe('panelLabel', () => {
	it('labels the first three panels in each style', () => {
		const first = (style) => [0, 1, 2].map((i) => panelLabel(i, style));
		expect(first('upper')).toEqual(['A', 'B', 'C']);
		expect(first('lower')).toEqual(['a', 'b', 'c']);
		expect(first('number')).toEqual(['1', '2', '3']);
		expect(first('roman')).toEqual(['i', 'ii', 'iii']);
		expect(PANEL_LABEL_STYLES.map((s) => s.id)).toEqual(['upper', 'lower', 'number', 'roman']);
	});

	it('defaults to lowercase letters, also for an unknown style', () => {
		expect(panelLabel(0)).toBe('a');
		expect(panelLabel(27, 'bogus')).toBe('b1');
		expect(panelLabel(27, 'upper')).toBe('B1');
	});

	it('gets the subtractive roman numerals right', () => {
		expect(panelLabel(3, 'roman')).toBe('iv');
		expect(panelLabel(8, 'roman')).toBe('ix');
		expect(panelLabel(13, 'roman')).toBe('xiv');
		expect(panelLabel(28, 'roman')).toBe('xxix');
		expect(panelLabel(29, 'roman')).toBe('xxx');
		expect(romanNumeral(1994)).toBe('mcmxciv');
		expect(panelLabel(39, 'number')).toBe('40');
	});
});

describe('preparePlotExport', () => {
	it('draws the plot name as the title by default and shifts the figure down', () => {
		mountPlot(5, { name: 'Wheel running' });
		const out = preparePlotExport(5, { includeTitle: true });
		const text = out.svg.querySelector('text.export-title');
		expect(text.textContent).toBe('Wheel running');
		expect(out.height).toBeGreaterThan(100);
		expect(out.svg.querySelector('g.export-content circle')).not.toBeNull();
		expect(out.name).toBe('Wheel running');
	});

	it('draws no title when the option is off', () => {
		mountPlot(5, { name: 'Wheel running' });
		const out = preparePlotExport(5, { includeTitle: false });
		expect(out.svg.querySelector('text.export-title')).toBeNull();
		expect(out.height).toBe(100);
	});

	it('sizes the title from the figure style', () => {
		mountPlot(5, { style: { fontFamily: 'serif', fontSize: 'l' } });
		mountPlot(6, { style: { fontFamily: 'sans', fontSize: 's' } });
		const large = preparePlotExport(5).svg.querySelector('text.export-title');
		const small = preparePlotExport(6).svg.querySelector('text.export-title');
		expect(parseFloat(large.getAttribute('font-size'))).toBeGreaterThan(
			parseFloat(small.getAttribute('font-size'))
		);
		expect(large.getAttribute('font-family')).toContain('Georgia');
	});

	it('never touches the live svg', () => {
		const live = mountPlot(5);
		preparePlotExport(5, { includeTitle: true });
		expect(live.querySelector('text.export-title')).toBeNull();
		expect(live.getAttribute('height')).toBe('100');
	});

	it('returns null for a plot that is not on screen', () => {
		expect(preparePlotExport(999)).toBeNull();
	});
});

describe('prepareCombinedExport', () => {
	it('keeps the canvas layout and gives every panel its own title', () => {
		mountPlot(1, { name: 'Left', x: 0, y: 0 });
		mountPlot(2, { name: 'Right', x: 300, y: 0 });
		const out = prepareCombinedExport([1, 2], { includeTitle: true, panelLabels: false });
		const panels = out.svg.querySelectorAll(':scope > svg');
		expect(panels.length).toBe(2);
		const titles = [...out.svg.querySelectorAll('text.export-title')].map((t) => t.textContent);
		expect(titles).toEqual(['Left', 'Right']);
		expect(parseFloat(panels[1].getAttribute('x'))).toBe(300);
		expect(out.width).toBe(500);
	});

	it('labels panels a, b, c when asked, and can do so without titles', () => {
		mountPlot(1, { x: 0, y: 0 });
		mountPlot(2, { x: 300, y: 0 });
		mountPlot(3, { x: 0, y: 200 });
		const out = prepareCombinedExport([1, 2, 3], { includeTitle: false, panelLabels: true });
		const labels = [...out.svg.querySelectorAll('tspan.export-panel-label')].map(
			(t) => t.textContent
		);
		expect(labels).toEqual(['a', 'b', 'c']);
		expect(out.svg.querySelectorAll('text.export-title').length).toBe(3);
		// No plot name anywhere: labels only.
		for (const t of out.svg.querySelectorAll('text.export-title')) {
			expect(t.textContent.trim()).toHaveLength(1);
		}
	});

	it('labels panels in the chosen style', () => {
		mountPlot(1, { x: 0, y: 0 });
		mountPlot(2, { x: 300, y: 0 });
		mountPlot(3, { x: 600, y: 0 });
		mountPlot(4, { x: 900, y: 0 });
		const labelsIn = (style) =>
			[
				...prepareCombinedExport([1, 2, 3, 4], {
					includeTitle: false,
					panelLabels: true,
					labelStyle: style
				}).svg.querySelectorAll('tspan.export-panel-label')
			].map((t) => t.textContent);
		expect(labelsIn('upper')).toEqual(['A', 'B', 'C', 'D']);
		expect(labelsIn('number')).toEqual(['1', '2', '3', '4']);
		expect(labelsIn('roman')).toEqual(['i', 'ii', 'iii', 'iv']);
		// And through buildExport with the option name the dialog uses.
		const [job] = buildExport([1, 2, 3, 4], {
			combined: true,
			panelLabels: true,
			labelStyle: 'roman',
			includeTitle: false
		});
		expect(job.svgString).toContain('>iv<');
	});

	it('pushes lower rows down so a title band never covers the panel beneath it', () => {
		mountPlot(1, { x: 0, y: 0 });
		mountPlot(2, { x: 300, y: 0 });
		mountPlot(3, { x: 0, y: 100 }); // flush under panel 1
		const plain = prepareCombinedExport([1, 2, 3], { includeTitle: false });
		const titled = prepareCombinedExport([1, 2, 3], { includeTitle: true });
		const yOf = (out, i) =>
			parseFloat(out.svg.querySelectorAll(':scope > svg')[i].getAttribute('y'));
		const band = titled.height - plain.height;
		// Two rows, so the figure grew by two bands; the first row moved by nothing, the
		// second by exactly one band, and the panels in a row share an offset.
		const oneBand =
			parseFloat(titled.svg.querySelectorAll(':scope > svg')[0].getAttribute('height')) - 100;
		expect(band).toBe(2 * oneBand);
		expect(yOf(titled, 0)).toBe(0);
		expect(yOf(titled, 1)).toBe(0);
		expect(yOf(titled, 2)).toBe(100 + oneBand);
	});

	it('returns nothing when none of the plots are on screen', () => {
		expect(prepareCombinedExport([7, 8], {})).toBeNull();
	});
});

describe('buildExport', () => {
	it('produces one job for a single plot, and per-plot jobs for individual files', () => {
		mountPlot(1, { name: 'A' });
		mountPlot(2, { name: 'B' });
		expect(buildExport([1], { combined: true }).map((j) => j.filename)).toEqual(['A']);
		expect(buildExport([1, 2], { combined: false }).map((j) => j.filename)).toEqual(['A', 'B']);
		const combined = buildExport([1, 2], { combined: true });
		expect(combined).toHaveLength(1);
		expect(combined[0].svg.querySelectorAll(':scope > svg')).toHaveLength(2);
	});

	it('serialises to a standalone svg string carrying the title', () => {
		mountPlot(1, { name: 'Serial' });
		const [job] = buildExport([1], { includeTitle: true, format: 'svg' });
		expect(job.svgString).toContain('<svg');
		expect(job.svgString).toContain('Serial');
		expect(job.svgString).toContain('export-title');
	});
});

describe('export at an overridden size', () => {
	/**
	 * A plot whose live svg follows its width/height reactively, the way every real plot
	 * component does (the svg's width/height attributes are $derived from the plot box,
	 * or from the canvas node's `renderBox` when one is set; see plots/viewBox.js).
	 * Written as a root effect so the test needs no component; flushSync runs it.
	 */
	function mountReactivePlot(id, w, h, extra = {}) {
		const live = mountPlot(id, { w, h });
		const plot = $state({
			id,
			name: 'Reactive',
			x: 0,
			y: 0,
			width: w,
			height: h,
			style: null,
			...extra
		});
		core.plots.splice(
			core.plots.findIndex((p) => p.id === id),
			1,
			plot
		);
		let renders = 0;
		const stop = $effect.root(() => {
			$effect(() => {
				renders++;
				const w = plot.plot?.renderBox?.w ?? plot.width;
				const h = plot.plot?.renderBox?.h ?? plot.height;
				live.setAttribute('width', String(w));
				live.setAttribute('height', String(h));
				live.setAttribute('viewBox', `0 0 ${w} ${h}`);
			});
		});
		flushSync();
		hosts.push({ remove: stop });
		return { live, plot, renders: () => renders };
	}

	it('withPlotSize renders at the size, hands the result back, and restores the plot', () => {
		const { live, plot } = mountReactivePlot(1, 200, 100);
		const seen = withPlotSize(plot, { width: 400, height: 300 }, () => ({
			w: live.getAttribute('width'),
			h: live.getAttribute('height')
		}));
		expect(seen).toEqual({ w: '400', h: '300' });
		expect(plot.width).toBe(200);
		expect(plot.height).toBe(100);
		expect(live.getAttribute('width')).toBe('200');
	});

	it('withPlotSize restores the plot even when the capture throws', () => {
		const { plot } = mountReactivePlot(1, 200, 100);
		expect(() =>
			withPlotSize(plot, { width: 400, height: 300 }, () => {
				throw new Error('boom');
			})
		).toThrow('boom');
		expect(plot.width).toBe(200);
		expect(plot.height).toBe(100);
	});

	it('withPlotSize captures a size written just before, even if not yet rendered', () => {
		const { live, plot } = mountReactivePlot(1, 200, 100);
		plot.width = 640;
		plot.height = 320;
		// Not flushed: the svg still shows the old size.
		expect(live.getAttribute('width')).toBe('200');
		const seen = withPlotSize(plot, { width: 640, height: 320 }, () => live.getAttribute('width'));
		expect(seen).toBe('640');
		expect(plot.width).toBe(640);
	});

	it('withPlotSize does not re-render when the size already matches', () => {
		const { plot, renders } = mountReactivePlot(1, 200, 100);
		const before = renders();
		withPlotSize(plot, { width: 200, height: 100 }, () => {});
		expect(renders()).toBe(before);
	});

	it('withPlotSize overrides a canvas renderBox so the figure is drawn at figure size', () => {
		const box = { w: 120, h: 60 };
		const { plot } = mountReactivePlot(1, 200, 100, { plot: { renderBox: box } });
		let inside;
		withPlotSize(plot, { width: 400, height: 300 }, () => {
			inside = { ...plot.plot.renderBox };
		});
		expect(inside).toEqual({ w: 400, h: 300 });
		expect(plot.plot.renderBox).toEqual(box);
	});

	it('preparePlotExport exports at the requested size and leaves the live plot alone', () => {
		const { live, plot } = mountReactivePlot(1, 200, 100);
		const out = preparePlotExport(1, { includeTitle: false, size: { width: 640, height: 320 } });
		expect(out.width).toBe(640);
		expect(out.height).toBe(320);
		expect(out.svg.getAttribute('width')).toBe('640');
		expect(live.getAttribute('width')).toBe('200');
		expect(plot.width).toBe(200);
	});

	it('preparePlotExport draws at the figure size when the live svg is a canvas thumbnail', () => {
		// On the workflow canvas the live svg is drawn at the node's box, not the figure's.
		const { live, plot } = mountReactivePlot(1, 500, 250, {
			plot: { renderBox: { w: 120, h: 60 } }
		});
		expect(live.getAttribute('width')).toBe('120');
		const out = preparePlotExport(1, { includeTitle: false });
		expect(live.getAttribute('width')).toBe('120');
		expect(out.width).toBe(500);
		expect(out.height).toBe(250);
		expect(plot.plot.renderBox).toEqual({ w: 120, h: 60 });
	});

	it('buildExport applies per-plot sizes for individual files and a dpi override', () => {
		mountReactivePlot(1, 200, 100);
		mountReactivePlot(2, 200, 100);
		const jobs = buildExport([1, 2], {
			combined: false,
			includeTitle: false,
			dpi: 150,
			sizes: { 1: { width: 300, height: 150 } }
		});
		expect(jobs.map((j) => [j.width, j.height])).toEqual([
			[300, 150],
			[200, 100]
		]);
		expect(jobs[0].scale).toBeCloseTo(150 / 96, 6);
		expect(jobs[1].scale).toBeCloseTo(150 / 96, 6);
		// Without an override the style's dpi speaks, and a bad override is ignored.
		expect(buildExport([1], { includeTitle: false })[0].scale).toBe(1);
		expect(buildExport([1], { includeTitle: false, dpi: -5 })[0].scale).toBe(1);
	});

	it('buildExport ignores sizes for a combined figure (the canvas layout is the layout)', () => {
		mountReactivePlot(1, 200, 100);
		mountReactivePlot(2, 200, 100, { x: 300 });
		const [job] = buildExport([1, 2], {
			combined: true,
			includeTitle: false,
			sizes: { 1: { width: 900, height: 900 } }
		});
		expect(job.width).toBe(500);
	});
});

describe('exportFilename', () => {
	it('strips characters a filesystem rejects', () => {
		expect(exportFilename('a/b:c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i');
		expect(exportFilename('   ')).toBe('plot');
	});
});

describe('export options persistence', () => {
	it('round-trips through localStorage and ignores junk', () => {
		expect(loadExportOptions()).toEqual(EXPORT_OPTION_DEFAULTS);
		saveExportOptions({
			format: 'svg',
			includeTitle: false,
			panelLabels: true,
			combined: false,
			dpi: 150,
			lockAspect: false,
			labelStyle: 'roman',
			sizes: { 1: { width: 9, height: 9 } }
		});
		expect(loadExportOptions()).toEqual({
			format: 'svg',
			includeTitle: false,
			panelLabels: true,
			combined: false,
			dpi: 150,
			lockAspect: false,
			labelStyle: 'roman'
		});
		saveExportOptions({ labelStyle: 'klingon' });
		expect(loadExportOptions().labelStyle).toBe('lower');
		// Dimensions are never remembered; a dpi outside the bounds is dropped.
		expect(loadExportOptions().sizes).toBeUndefined();
		saveExportOptions({ dpi: 5000 });
		expect(loadExportOptions().dpi).toBe(EXPORT_OPTION_DEFAULTS.dpi);
		localStorage.setItem(EXPORT_OPTIONS_KEY, '{"format":"bmp","includeTitle":"yes"}');
		expect(loadExportOptions()).toEqual(EXPORT_OPTION_DEFAULTS);
		localStorage.setItem(EXPORT_OPTIONS_KEY, 'not json');
		expect(loadExportOptions()).toEqual(EXPORT_OPTION_DEFAULTS);
	});
});

describe('saveExport', () => {
	it('downloads one svg file per job, named after the plot', async () => {
		mountPlot(1, { name: 'One' });
		mountPlot(2, { name: 'Two' });
		const clicks = [];
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
			clicks.push(this.download);
		});
		globalThis.URL.createObjectURL ??= () => 'blob:x';
		globalThis.URL.revokeObjectURL ??= () => {};
		const n = await saveExport([1, 2], { format: 'svg', combined: false, includeTitle: true });
		expect(n).toBe(2);
		expect(clicks).toEqual(['One.svg', 'Two.svg']);
		click.mockRestore();
	});
});
