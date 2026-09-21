import { flushSync } from 'svelte';
import { core } from '$lib/core/core.svelte';
import { addNotification } from '$lib/core/notifications.svelte.js';
import { mutationService } from '$lib/core/mutationService.js';
import { prepareExport, setPhysicalSize } from '$lib/plots/exportStyle.js';
import { exportScale, resolveStyle } from '$lib/plots/figureStyle.js';

/**
 * Convert headers and rows to a CSV string and trigger a download.
 * @param {number} plotId - The plot id (core.plots[].id), not the array index
 */
export function saveDataAsCSV(plotId) {
	const plot = core.plots.find((p) => p.id === plotId);
	if (!plot || !plot.plot) return;

	const plotData = plot.plot;
	if (typeof plotData.getDownloadData !== 'function') return;

	const { headers, rows } = plotData.getDownloadData();
	if (!headers || !rows || rows.length === 0) return;

	const csvContent = [
		headers.map(escapeCSV).join(','),
		...rows.map((row) => row.map(escapeCSV).join(','))
	].join('\n');

	const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = (plot.name || 'plot_data').replace(/[/\\:*?"<>|]/g, '_') + '.csv';
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

/**
 * Open a DataView plot on the canvas showing the data from the given plot.
 * @param {number} plotId - The id of the source plot (core.plots[].id), not the array index
 */
export function showDataAsTable(plotId) {
	const sourcePlot = core.plots.find((p) => p.id === plotId);
	if (!sourcePlot?.plot || typeof sourcePlot.plot.getDownloadData !== 'function') return;

	mutationService.addPlot({
		name: 'Data: ' + (sourcePlot.name || 'Plot'),
		type: 'dataview',
		x: sourcePlot.x + 20,
		y: sourcePlot.y + 20,
		width: Math.max(sourcePlot.width, 400),
		height: 300,
		plot: { sourcePlotId: sourcePlot.id }
	});
}

/**
 * Open a DataView plot on the canvas with static header/row data (e.g. table process stats).
 * @param {string} name - The plot title
 * @param {string[]} headers
 * @param {any[][]} rows
 * @param {(() => {headers: string[], rows: any[][]}) | null} [statsGetter] - optional live getter for reactive updates
 */
export function showStaticDataAsTable(
	name,
	headers,
	rows,
	statsGetter = null,
	sourceNodeId = null
) {
	if (!headers?.length || !rows?.length) return;
	// Place the table next to its source node so it appears where the user clicked. Previously it
	// spawned at a hard-coded (80,80) — usually off-screen or behind the canvas/notes — so the
	// button looked like it did nothing. Falls back to (80,80) only when the node has no layout yet.
	let x = 80;
	let y = 80;
	const layout = sourceNodeId ? core.nodeLayout?.[sourceNodeId] : null;
	if (layout) {
		x = (layout.x ?? 0) + 360;
		y = (layout.y ?? 0) + 40;
	}
	const newPlot = mutationService.addPlot({
		name,
		type: 'dataview',
		x,
		y,
		sourceNodeId,
		width: Math.max(400, headers.length * 90),
		height: Math.min(500, 100 + rows.length * 33),
		plot: { sourceType: 'static', staticHeaders: headers, staticRows: rows }
	});
	// statsGetter is intentionally non-serialised (functions don't survive snapshots);
	// attach post-creation so the live reactive stats path still works.
	if (newPlot && statsGetter) newPlot.plot.statsGetter = statsGetter;
	return newPlot;
}

/**
 * Trigger a CSV download from static header/row data (e.g. table process stats).
 * @param {string} name - The base filename (without extension)
 * @param {string[]} headers
 * @param {any[][]} rows
 */
export function saveStaticDataAsCSV(name, headers, rows) {
	if (!headers?.length || !rows?.length) return;
	const csvContent = [
		headers.map(escapeCSV).join(','),
		...rows.map((row) => row.map(escapeCSV).join(','))
	].join('\n');
	const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = name.replace(/[/\\:*?"<>|]/g, '_') + '.csv';
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

function escapeCSV(value) {
	if (value == null) return '';
	const str = String(value);
	if (str.includes(',') || str.includes('"') || str.includes('\n')) {
		return '"' + str.replace(/"/g, '""') + '"';
	}
	return str;
}

// ---------------------------------------------------------------------------
// Image export
//
// One pipeline feeds the Save dialog's preview AND the download: `buildExport` turns
// plot ids + options into export jobs (a detached svg each, with its final size and
// filename), and `saveExport` serialises those to files. The preview shows exactly the
// svg that will be written, so what you see is what you get.
//
// Nothing here touches the live plot or the session: the title band and panel
// labels exist only in the exported copy, and the options live in localStorage.
// ---------------------------------------------------------------------------

/** localStorage key for the last-used Save dialog options. */
export const EXPORT_OPTIONS_KEY = 'ancir.plotExportOptions';

/** The dpi a PNG may be asked for. Below 30 nothing is legible; above 1200 is a memory bomb. */
export const DPI_MIN = 30;
export const DPI_MAX = 1200;
/** Quick picks in the dialog: screen, web, print, line art. */
export const DPI_PRESETS = Object.freeze([72, 150, 300, 600]);

/** True for a dpi the export will honour. */
export function isValidDpi(dpi) {
	return typeof dpi === 'number' && Number.isFinite(dpi) && dpi >= DPI_MIN && dpi <= DPI_MAX;
}

/**
 * What the Save dialog starts with on a fresh browser.
 *
 * `dpi` here is only a FALLBACK: the dialog prefills from the plot's own figure style
 * (`style.exportDpi`), which is where the export resolution lives, and writes the chosen
 * value back there on Save. The remembered copy serves a plot with no style.
 * Dimensions are deliberately NOT an option: they belong to the plot, never to the browser.
 */
export const EXPORT_OPTION_DEFAULTS = Object.freeze({
	format: 'png',
	includeTitle: true,
	panelLabels: false,
	combined: true,
	labelStyle: 'lower',
	dpi: 300,
	lockAspect: true
});

/** Keep only well-typed values; anything else falls back to the default. */
function sanitiseOptions(raw) {
	const out = { ...EXPORT_OPTION_DEFAULTS };
	if (!raw || typeof raw !== 'object') return out;
	if (raw.format === 'png' || raw.format === 'svg') out.format = raw.format;
	for (const key of ['includeTitle', 'panelLabels', 'combined', 'lockAspect']) {
		if (typeof raw[key] === 'boolean') out[key] = raw[key];
	}
	if (isValidDpi(raw.dpi)) out.dpi = Math.round(raw.dpi);
	if (PANEL_LABEL_STYLES.some((st) => st.id === raw.labelStyle)) out.labelStyle = raw.labelStyle;
	return out;
}

/** The last-used options, or the defaults. Storage may be missing or blocked. */
export function loadExportOptions() {
	try {
		const raw = localStorage.getItem(EXPORT_OPTIONS_KEY);
		return raw ? sanitiseOptions(JSON.parse(raw)) : { ...EXPORT_OPTION_DEFAULTS };
	} catch {
		return { ...EXPORT_OPTION_DEFAULTS };
	}
}

/** Remember the options for next time. Best effort; a blocked store is not an error. */
export function saveExportOptions(options) {
	try {
		localStorage.setItem(EXPORT_OPTIONS_KEY, JSON.stringify(sanitiseOptions(options)));
	} catch {
		/* private window, quota, or storage disabled */
	}
}

/**
 * Plot ids from whatever a caller passes: a `plotN` string, a number, or an array of
 * either. Callers historically mixed all three, and `'plot5'[0]` is `'p'`.
 *
 * @returns {number[]} unique ids in the order given
 */
export function normalisePlotIds(Id) {
	const list = Array.isArray(Id) ? Id : [Id];
	const out = [];
	for (const v of list) {
		if (v == null) continue;
		const n = typeof v === 'number' ? v : Number(String(v).replace(/^plot/, ''));
		if (Number.isFinite(n) && !out.includes(n)) out.push(n);
	}
	return out;
}

/** Panel letter for the i-th panel: a..z, then a1..z1, and so on. */
export function panelLetter(i) {
	const letter = String.fromCharCode(97 + (i % 26));
	const round = Math.floor(i / 26);
	return round ? letter + round : letter;
}

/** The ways a panel can be labelled, in the order the dialog offers them. */
export const PANEL_LABEL_STYLES = Object.freeze([
	{ id: 'upper', sample: 'A, B, C', glyph: 'A' },
	{ id: 'lower', sample: 'a, b, c', glyph: 'a' },
	{ id: 'number', sample: '1, 2, 3', glyph: '1' },
	{ id: 'roman', sample: 'i, ii, iii', glyph: 'i' }
]);

/** Lowercase roman numeral for n >= 1 (1 → i, 4 → iv, 29 → xxix). */
export function romanNumeral(n) {
	const table = [
		[1000, 'm'],
		[900, 'cm'],
		[500, 'd'],
		[400, 'cd'],
		[100, 'c'],
		[90, 'xc'],
		[50, 'l'],
		[40, 'xl'],
		[10, 'x'],
		[9, 'ix'],
		[5, 'v'],
		[4, 'iv'],
		[1, 'i']
	];
	let out = '';
	let rest = Math.floor(n);
	for (const [value, glyph] of table) {
		while (rest >= value) {
			out += glyph;
			rest -= value;
		}
	}
	return out;
}

/**
 * The label for the i-th panel (0-based) in a style: 'upper' (A, B, C), 'lower'
 * (a, b, c; the default, and what every earlier export used), 'number' (1, 2, 3) or
 * 'roman' (i, ii, iii). An unknown style falls back to lowercase letters.
 */
export function panelLabel(index, style = 'lower') {
	const i = Math.max(0, Math.floor(index));
	switch (style) {
		case 'upper':
			return panelLetter(i).toUpperCase();
		case 'number':
			return String(i + 1);
		case 'roman':
			return romanNumeral(i + 1);
		default:
			return panelLetter(i);
	}
}

/** A filename-safe version of a plot name. */
export function exportFilename(name) {
	const clean = String(name ?? '')
		.replace(/[/\\:*?"<>|]/g, '_')
		.trim();
	return clean || 'plot';
}

/** The live svg's size: explicit attributes, then the viewBox, then the box. */
function svgSize(svg) {
	let width = parseFloat(svg.getAttribute('width'));
	let height = parseFloat(svg.getAttribute('height'));
	if (!width || !height) {
		const viewBox = svg.getAttribute('viewBox');
		if (viewBox) {
			const parts = viewBox.split(/[\s,]+/);
			width = parseFloat(parts[2]);
			height = parseFloat(parts[3]);
		}
	}
	if (!width || !height) {
		const rect = svg.getBoundingClientRect?.();
		width = rect?.width || 0;
		height = rect?.height || 0;
	}
	return { width, height };
}

/** The title band spec for a plot, or null when nothing is to be drawn. */
function titleSpec(plot, includeTitle, label) {
	if (!includeTitle && !label) return null;
	const resolved = resolveStyle(plot?.style);
	return {
		text: includeTitle ? (plot?.name ?? '') : '',
		label,
		fontFamily: resolved.fontFamily,
		fontSize: resolved.sizes.title
	};
}

/** A finite, positive size, or null. */
function validSize(size) {
	const w = size?.width;
	const h = size?.height;
	return w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h)
		? { width: w, height: h }
		: null;
}

/**
 * Run `fn` while the plot is drawn at `size`, then put the plot back.
 *
 * HOW A PLOT IS RE-RENDERED AT ANOTHER SIZE
 *
 * A plot's svg is drawn by its own component from `plot.width` / `plot.height` (every
 * renderer derives its viewWidth/viewHeight from the plot box), so the only way to get
 * that renderer's real layout at a new size (axes re-fitted, legend re-placed, text at
 * figure size rather than a scaled bitmap) is to change the box and let it render. This
 * does exactly that, synchronously: set the box, `flushSync()` so the DOM is updated
 * NOW, capture, restore, `flushSync()` again. All of it happens inside one JavaScript
 * task, so the browser never paints the intermediate state and the on-canvas plot does
 * not flash. Rendering off-screen was the alternative and is not available: a plot
 * component binds its svg to the plot object (`document.getElementById('plot' + id)`
 * is how the plot finds itself), so a second instance would fight the first.
 *
 * On the workflow canvas the live svg is a thumbnail drawn at the node's box
 * (`renderBox`, see plots/viewBox.js) with scaled type; that is overridden too, so the
 * export is the figure at figure size, not the node.
 *
 * The writes are plain property writes, not history ops: nothing is recorded, and the
 * plot ends exactly as it began. Not tracked either: callers run from timers and click
 * handlers, never inside an effect.
 *
 * @template T
 * @param {{width?: number, height?: number, plot?: {renderBox?: object|null}}|null} plot
 * @param {{width: number, height: number}|null} size
 * @param {() => T} fn
 * @returns {T}
 */
export function withPlotSize(plot, size, fn) {
	const target = validSize(size);
	if (!plot || !target) return fn();
	// Settle anything already pending: a caller that has just written the plot's size
	// (the dialog's Save applies its ops and exports in the same task) must capture the
	// svg drawn at that size, not the one still on screen from before the write.
	flushSync();
	const inner = plot.plot;
	const hasBox = inner && typeof inner === 'object' && 'renderBox' in inner;
	const box = hasBox ? inner.renderBox : null;
	const sameSize = plot.width === target.width && plot.height === target.height;
	const sameBox = !box || (box.w === target.width && box.h === target.height);
	if (sameSize && sameBox) return fn();
	const before = { width: plot.width, height: plot.height };
	try {
		plot.width = target.width;
		plot.height = target.height;
		if (box) inner.renderBox = { w: target.width, h: target.height };
		flushSync();
		return fn();
	} finally {
		plot.width = before.width;
		plot.height = before.height;
		if (box) inner.renderBox = box;
		flushSync();
	}
}

/**
 * An export-ready copy of ONE plot's svg.
 *
 * Drawn at `size` when given, else at the plot's own width/height (which is also what
 * the on-canvas thumbnail is NOT drawn at; see withPlotSize). A plot with no box, as
 * in the MCP mount, exports its live svg as is.
 *
 * @param {number} plotId
 * @param {{includeTitle?: boolean, label?: string, physical?: boolean,
 *          size?: {width: number, height: number}|null}} [opts]
 * @returns {{svg: SVGElement, width: number, height: number, style: object|null,
 *            name: string, plotId: number, x: number, y: number}|null}
 *          null when the plot is not on screen (a table, or a plot in another view)
 */
export function preparePlotExport(
	plotId,
	{ includeTitle = true, label = '', physical = false, size = null } = {}
) {
	if (!document.getElementById('plot' + plotId)) return null;
	const plot = core.plots.find((p) => p.id === plotId) ?? null;
	const style = plot?.style ?? null;
	const target = validSize(size) ?? validSize(plot);
	const prepared = withPlotSize(plot, target, () => {
		const live = document.getElementById('plot' + plotId);
		if (!live) return null;
		const { width, height } = svgSize(live);
		return prepareExport(live, {
			width,
			height,
			backgroundColour: resolveStyle(style).backgroundColour,
			physical,
			title: titleSpec(plot, includeTitle, label)
		});
	});
	if (!prepared) return null;
	return {
		svg: prepared.svg,
		width: prepared.width,
		height: prepared.height,
		style,
		name: plot?.name ?? 'plot' + plotId,
		plotId,
		x: typeof plot?.x === 'number' ? plot.x : 0,
		y: typeof plot?.y === 'number' ? plot.y : 0
	};
}

/**
 * Row index for each panel, from its canvas position. Panels are in one row while
 * they overlap vertically with the row so far; a panel that starts at or below the
 * row's bottom opens the next row. Used to push rows down by the title band, so
 * a band never covers the panel beneath it and side-by-side panels stay aligned.
 *
 * @param {{y: number, height: number}[]} panels
 * @returns {number[]} row index per panel, in the panels' order
 */
export function panelRows(panels) {
	const order = panels.map((p, i) => i).sort((a, b) => panels[a].y - panels[b].y);
	const rows = new Array(panels.length).fill(0);
	let row = -1;
	let rowBottom = -Infinity;
	for (const i of order) {
		const p = panels[i];
		if (p.y >= rowBottom - 0.5) {
			row++;
			rowBottom = p.y + p.height;
		} else {
			rowBottom = Math.max(rowBottom, p.y + p.height);
		}
		rows[i] = row;
	}
	return rows;
}

/**
 * Several plots as ONE figure, laid out as they are on the canvas.
 *
 * Each panel goes in as a nested `<svg x y>`: it keeps its own defs, clip paths
 * and background, and nothing has to be re-keyed. Panel ids are already unique per
 * plot (`qqclip5`, `actogram-clip-5`) so nested documents do not collide.
 *
 * @param {number[]} plotIds
 * @param {{includeTitle?: boolean, panelLabels?: boolean, labelStyle?: string,
 *          physical?: boolean}} [opts]
 */
export function prepareCombinedExport(
	plotIds,
	{ includeTitle = true, panelLabels = false, labelStyle = 'lower', physical = false } = {}
) {
	const panels = [];
	for (const id of plotIds) {
		const panel = preparePlotExport(id, {
			includeTitle,
			label: panelLabels ? panelLabel(panels.length, labelStyle) : ''
		});
		if (panel) panels.push(panel);
	}
	if (!panels.length) return null;

	// The title band grew each panel; the raw (un-banded) height is what the canvas
	// laid out, so rows are found on that and then shifted by one band per row. The plot
	// box is that height (the panel was drawn at it; see preparePlotExport), and the live
	// svg is the fallback for a plot with no box.
	const liveHeights = panels.map(
		(p) =>
			validSize(core.plots.find((q) => q.id === p.plotId))?.height ??
			svgSize(document.getElementById('plot' + p.plotId)).height
	);
	const bands = panels.map((p, i) => p.height - liveHeights[i]);
	const band = Math.max(0, ...bands);
	const rows = panelRows(panels.map((p, i) => ({ y: p.y, height: liveHeights[i] })));

	const minX = Math.min(...panels.map((p) => p.x));
	const minY = Math.min(...panels.map((p) => p.y));
	const placed = panels.map((p, i) => ({
		panel: p,
		x: p.x - minX,
		y: p.y - minY + rows[i] * band
	}));
	const width = Math.max(...placed.map((q) => q.x + q.panel.width));
	const height = Math.max(...placed.map((q) => q.y + q.panel.height));

	const ns = 'http://www.w3.org/2000/svg';
	const outer = document.createElementNS(ns, 'svg');
	outer.setAttribute('xmlns', ns);
	outer.setAttribute('width', String(width));
	outer.setAttribute('height', String(height));
	outer.setAttribute('viewBox', `0 0 ${width} ${height}`);

	// The first panel's style speaks for the figure: its background fills the gaps
	// between panels (a white figure should not have transparent holes), and its DPI
	// sets the raster scale.
	const style = panels[0].style;
	const background = resolveStyle(style).backgroundColour;
	if (background && background !== 'transparent') {
		const rect = document.createElementNS(ns, 'rect');
		rect.setAttribute('width', String(width));
		rect.setAttribute('height', String(height));
		rect.setAttribute('fill', background);
		outer.appendChild(rect);
	}

	for (const { panel, x, y } of placed) {
		const nested = panel.svg;
		nested.removeAttribute('id');
		nested.removeAttribute('style');
		nested.setAttribute('x', String(x));
		nested.setAttribute('y', String(y));
		nested.setAttribute('width', String(panel.width));
		nested.setAttribute('height', String(panel.height));
		nested.setAttribute('viewBox', `0 0 ${panel.width} ${panel.height}`);
		outer.appendChild(nested);
	}
	if (physical) setPhysicalSize(outer, width, height);

	const names = panels.map((p) => p.name).join(' + ');
	return {
		svg: outer,
		width,
		height,
		style,
		name: names.length > 80 ? `${panels[0].name} + ${panels.length - 1} more` : names,
		panels
	};
}

/** A serialised, standalone svg document. */
export function serialiseSvg(svg) {
	const s = new XMLSerializer().serializeToString(svg);
	return s.startsWith('<?xml') ? s : '<?xml version="1.0" encoding="UTF-8"?>\n' + s;
}

/**
 * Export jobs for a set of plots under the dialog's options.
 *
 * Two of the options are overrides the dialog uses BEFORE it has written anything to
 * the plots (the preview) and that the MCP path never passes:
 * - `dpi`: the raster scale for every job, instead of each plot's `style.exportDpi`.
 *   Ignored unless valid (see isValidDpi).
 * - `sizes`: `{[plotId]: {width, height}}`, the size to draw a plot at for single or
 *   individual export. Ignored for a combined figure, whose layout is the canvas.
 *
 * @param {number[]|string|number} Id plot ids in any of the accepted shapes
 * @param {{format?: 'png'|'svg', includeTitle?: boolean, panelLabels?: boolean,
 *          labelStyle?: string, combined?: boolean, dpi?: number|null,
 *          sizes?: Record<string|number, {width: number, height: number}>}} [options]
 * @returns {{svg: SVGElement, svgString: string, width: number, height: number,
 *            scale: number, filename: string, format: string}[]}
 */
export function buildExport(Id, options = {}) {
	const opts = { ...EXPORT_OPTION_DEFAULTS, ...options, dpi: options.dpi ?? null };
	const ids = normalisePlotIds(Id);
	const physical = opts.format === 'svg';
	const sizes = opts.sizes && typeof opts.sizes === 'object' ? opts.sizes : {};
	const prepared = [];
	if (ids.length > 1 && opts.combined) {
		const combined = prepareCombinedExport(ids, {
			includeTitle: opts.includeTitle,
			panelLabels: opts.panelLabels,
			labelStyle: opts.labelStyle,
			physical
		});
		if (combined) prepared.push(combined);
	} else {
		for (const id of ids) {
			const one = preparePlotExport(id, {
				includeTitle: opts.includeTitle,
				physical,
				size: sizes[id] ?? null
			});
			if (one) prepared.push(one);
		}
	}
	const scaleOverride = isValidDpi(opts.dpi) ? opts.dpi / 96 : null;
	return prepared.map((p) => ({
		svg: p.svg,
		svgString: serialiseSvg(p.svg),
		width: p.width,
		height: p.height,
		scale: scaleOverride ?? exportScale(p.style),
		filename: exportFilename(p.name),
		format: opts.format
	}));
}

/** A data: URL for an svg string, usable as an <img> src. */
export function svgDataUrl(svgString) {
	return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
}

/**
 * Rasterise an svg string to a PNG data URL at `scale` times its px size.
 *
 * The svg is a vector source, so drawing it at the larger size rasterises it at that
 * resolution rather than upscaling a bitmap; that is what makes "85 mm at 300 dpi"
 * mean what it says. Rejects where there is no canvas (tests, very old browsers).
 *
 * @returns {Promise<string>}
 */
export function rasterisePng(svgString, width, height, scale = 1) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			try {
				const canvas = document.createElement('canvas');
				canvas.width = Math.round(width * scale);
				canvas.height = Math.round(height * scale);
				const context = canvas.getContext('2d');
				if (!context) throw new Error('no 2d context');
				context.imageSmoothingEnabled = true;
				context.imageSmoothingQuality = 'high';
				context.drawImage(img, 0, 0, canvas.width, canvas.height);
				resolve(canvas.toDataURL('image/png'));
			} catch (e) {
				reject(e);
			}
		};
		img.onerror = () => reject(new Error('svg failed to load as an image'));
		img.src = svgDataUrl(svgString);
	});
}

/** Trigger a browser download for a URL. */
function downloadUrl(url, filename) {
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
}

/**
 * Write every job to a file.
 *
 * @param {number[]|string|number} Id
 * @param {object} [options] see buildExport
 * @returns {Promise<number>} how many files were written
 */
export async function saveExport(Id, options = {}) {
	const jobs = buildExport(Id, options);
	if (!jobs.length) {
		addNotification('Nothing to save: the selected plots are not on screen.');
		return 0;
	}
	let n = 0;
	for (const job of jobs) {
		if (job.format === 'svg') {
			const blob = new Blob([job.svgString], { type: 'image/svg+xml;charset=utf-8' });
			const url = URL.createObjectURL(blob);
			downloadUrl(url, job.filename + '.svg');
			URL.revokeObjectURL(url);
			n++;
			continue;
		}
		try {
			const png = await rasterisePng(job.svgString, job.width, job.height, job.scale);
			downloadUrl(png, job.filename + '.png');
			n++;
		} catch (e) {
			console.error('PNG export failed:', e);
			addNotification('Error: could not render ' + job.filename + ' as PNG');
		}
	}
	return n;
}

/**
 * Save one plot. Kept for the caller that predates the dialog (the MCP rasteriser,
 * mcp/src/render/mount.js), whose output should not change under it: no title unless
 * asked for.
 * @param {string|number} svgId `plotN` or the id
 * @param {'png'|'svg'} [filetype]
 * @param {object} [options] see buildExport
 */
export function convertToImage(svgId, filetype = 'png', options = {}) {
	return saveExport(svgId, { includeTitle: false, ...options, format: filetype, combined: false });
}

/** Save each plot to its own file. */
export function saveMultipleAsIndividuals(svgIds, filetype = 'png', options = {}) {
	return saveExport(svgIds, { ...options, format: filetype, combined: false });
}

/** Save the plots as one figure laid out as on the canvas. */
export function saveMultipleAsImage(svgIds, filetype = 'png', options = {}) {
	return saveExport(svgIds, { ...options, format: filetype, combined: true });
}
