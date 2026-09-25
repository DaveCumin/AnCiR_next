// Shared utilities for plotbit tooltips (Points, Line, Hist, etc.)
//
// The tooltip system uses a CustomEvent('tooltip', {detail, bubbles:true})
// that parent plot components listen for via ontooltip={handler}. Each
// plotbit dispatches this event from its hover handlers; helpers here
// handle formatting, value lookup across sibling series, and positioning.

import { onDestroy } from 'svelte';
import { formatDateTime } from '$lib/utils/time/displayTime.js';

/**
 * Escape a value for interpolation into tooltip HTML.
 *
 * Tooltip content is an HTML string rendered with `{@html}` (PlotTooltip.svelte),
 * and the values interpolated into it are NOT developer copy: series labels come
 * from imported CSV column headers and from label fields the user types into, and
 * sessions are shared as files between researchers. So a header of
 * `<img src=x onerror=…>` used to execute in the reader's session on hover.
 *
 * `&` must be replaced FIRST, or the ampersands this function itself introduces
 * would be escaped again and a literal `&lt;` typed by the user would decode back
 * to `<`. The apostrophe is included because these values also land inside
 * double-quoted attributes, and a single-quoted attribute is one refactor away.
 */
export function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * The colour shapes a series colour is allowed to take.
 *
 * Deliberately STRICTER than `looksLikeColour` in plots/appearanceIdentity.js and
 * plots/styleConfig.js, which accept a bare `rgb(` PREFIX: `rgb(0,0,0);position:fixed`
 * passes those and reaches here. A style attribute is a second injection surface —
 * a semicolon ends the declaration without needing a quote at all — so the value is
 * matched WHOLE rather than by prefix.
 */
const COLOUR_RE =
	/^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(?:rgb|hsl)a?\([0-9a-z.,%/+\-\s]*\)|[a-z]+)$/i;

/**
 * A series colour that is safe to interpolate into `style="background:…"`.
 *
 * Anything unrecognised becomes `currentColor`: a swatch in the wrong colour is a
 * cosmetic loss on a value the app never produces, and refusing to paint at all
 * would hide the series row entirely.
 */
export function safeColour(value, fallback = 'currentColor') {
	const s = typeof value === 'string' ? value.trim() : '';
	return COLOUR_RE.test(s) ? s : fallback;
}

/**
 * Format a value for display.
 * - type='time' renders via the app-wide displayTimezone (default UTC)
 * - numbers are rendered with `dp` decimal places
 * - anything else is returned as-is
 */
export function safeFormat(value, dp = 3, type = 'number') {
	if (type === 'time') {
		return formatDateTime(value);
	}
	try {
		return value.toFixed(dp);
	} catch {
		return value;
	}
}

/**
 * Find the y value whose x is closest to targetX in a parallel (x[], y[]) series.
 * Returns null if no valid point is within `maxDistance`, or if input is empty.
 */
export function findNearestY(xArr, yArr, targetX, maxDistance = Infinity) {
	if (!xArr?.length || !yArr?.length) return null;
	let bestIdx = -1;
	let bestDist = maxDistance;
	const n = Math.min(xArr.length, yArr.length);
	for (let i = 0; i < n; i++) {
		const xi = xArr[i];
		const yi = yArr[i];
		if (xi == null || yi == null || isNaN(xi) || isNaN(yi)) continue;
		const d = Math.abs(xi - targetX);
		if (d < bestDist) {
			bestDist = d;
			bestIdx = i;
		}
	}
	return bestIdx >= 0 ? yArr[bestIdx] : null;
}

/**
 * Find the bar value whose [xStart, xEnd) interval contains targetX.
 * Returns null if no bin contains the target.
 */
export function findBinValue(xStart, xEnd, yArr, targetX) {
	if (!xStart?.length || !xEnd?.length || !yArr?.length) return null;
	const n = Math.min(xStart.length, xEnd.length, yArr.length);
	for (let i = 0; i < n; i++) {
		if (targetX >= xStart[i] && targetX < xEnd[i]) {
			const y = yArr[i];
			if (y == null || isNaN(y)) return null;
			return y;
		}
	}
	return null;
}

/**
 * Build the HTML content for an aggregated tooltip that lists one x-axis
 * value and the y value for each series at that x.
 *
 * @param {object} opts
 * @param {string} [opts.xLabel='x']
 * @param {*}      opts.xValue
 * @param {string} [opts.xtype='number']  - 'time' or 'number'
 * @param {(x:*)=>string} [opts.xFormatter] - overrides xtype/dp if provided
 * @param {Array<{label:string, colour:string, yValue:*, yLabel?:string}>} opts.series
 * @param {number} [opts.dp=3]
 */
export function buildAggregatedContent({
	xLabel = 'x',
	xValue,
	xtype = 'number',
	xFormatter = null,
	series = [],
	dp = 3
}) {
	// EVERY interpolated value is escaped at the point of interpolation, including the
	// formatted x/y strings: `safeFormat` returns a non-number as-is, so a text or
	// category column's value reaches the markup verbatim, and `xFormatter` is a
	// caller-supplied function whose output is no more trusted than its input.
	const xStr = xFormatter ? xFormatter(xValue) : safeFormat(xValue, dp, xtype);
	let content = `<span style="opacity:0.7">${escapeHtml(xLabel)}:</span> ${escapeHtml(xStr)}`;
	for (const s of series) {
		if (s.yValue == null || (typeof s.yValue === 'number' && isNaN(s.yValue))) continue;
		// The colour lands in a `style` attribute, a separate surface from the text
		// nodes: validate its shape first, then escape what survives, so loosening
		// the grammar later cannot on its own reintroduce an attribute escape.
		const colour = escapeHtml(safeColour(s.colour));
		const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colour};margin-right:4px;vertical-align:middle;"></span>`;
		const label = escapeHtml(s.label || 'Data');
		const yStr = escapeHtml(safeFormat(s.yValue, dp));
		content += `<br/>${dot}<strong>${label}:</strong> ${yStr}`;
	}
	return content;
}

/**
 * Compute tooltip placement in VIEWPORT (client) coordinates, flipping near the
 * right/bottom edges. Pass the pointer event's clientX/clientY. Viewport coords
 * are required because the tooltip is portalled to <body> and positioned
 * `fixed` — using SVG-local coords broke placement once the canvas was panned or
 * zoomed (a `fixed` element nested in a CSS-transformed ancestor is captured by
 * that transform).
 */
export function computeTooltipPosition(clientX, clientY, tooltipWidth = 180) {
	const vw = typeof window !== 'undefined' ? window.innerWidth : Infinity;
	const vh = typeof window !== 'undefined' ? window.innerHeight : Infinity;
	let x = clientX + 16;
	let y = clientY + 14;
	if (x + tooltipWidth > vw - 4) x = clientX - tooltipWidth - 12;
	if (x < 4) x = 4;
	if (y + 44 > vh - 4) y = clientY - 44;
	if (y < 4) y = 4;
	return { x, y };
}

/** Dispatch a tooltip-visible CustomEvent that bubbles up to the plot container. */
export function dispatchTooltip(target, detail) {
	target.dispatchEvent(new CustomEvent('tooltip', { detail, bubbles: true }));
}

/** Dispatch a tooltip-hidden CustomEvent. */
export function hideTooltip(target) {
	dispatchTooltip(target, { visible: false });
}

// --- Alt-key tracking -------------------------------------------------------
//
// ONE pair of document listeners for the whole app, installed on first use and
// deliberately never removed: that is a fixed cost, not a growing one.
//
// This used to be per call. Every plot mount added two listeners whose closures
// captured that plot's reactive state, and the binder returned no teardown
// handle, so they could not be removed even in principle. The old header
// justified it with "plot components are long-lived"; core/computeMemo.js
// documents the opposite in its own header, and exists because of it. A view
// switch destroys one whole component tree and rebuilds the other, and
// NodeComputeHost deliberately mounts every analysis node.

/** @type {Set<{onDown: () => void, onUp: () => void}>} */
const altSubscribers = new Set();
let altDown = false;
let altListenersInstalled = false;

function installAltListeners() {
	if (altListenersInstalled || typeof document === 'undefined') return;
	altListenersInstalled = true;
	document.addEventListener('keydown', (e) => {
		if (e.key !== 'Alt' || altDown) return;
		altDown = true;
		for (const s of altSubscribers) s.onDown();
	});
	document.addEventListener('keyup', (e) => {
		if (e.key !== 'Alt') return;
		altDown = false;
		for (const s of altSubscribers) s.onUp();
	});
}

/** Test seam: how many plots are currently subscribed. Must return to 0. */
export function _altSubscriberCount() {
	return altSubscribers.size;
}

/**
 * Wire up Alt-toggle behaviour for a plot's tooltip state. Holding Alt hides
 * the tooltip immediately; releasing Alt restores the last visible tooltip,
 * even without any further mouse movement.
 *
 * Usage in a plot:
 *   let tooltip = $state({ visible: false, x: 0, y: 0, content: '' });
 *   const handleTooltip = bindAltTooltipToggle(
 *     () => tooltip,
 *     (v) => { tooltip = v; }
 *   );
 *   // then: <svg ontooltip={handleTooltip} />
 *
 * Returns the ontooltip handler. The subscription is released automatically on
 * component teardown, so call sites need no cleanup of their own.
 */
export function bindAltTooltipToggle(getTooltip, setTooltip) {
	let stashed = null;

	installAltListeners();
	const subscriber = {
		onDown() {
			const t = getTooltip();
			if (t?.visible) setTooltip({ ...t, visible: false });
		},
		onUp() {
			if (stashed?.visible) setTooltip(stashed);
		}
	};
	altSubscribers.add(subscriber);
	const destroy = () => altSubscribers.delete(subscriber);

	// onDestroy only works during component initialisation, which every plot call
	// site is (top level of its <script>). A non-component caller such as a test
	// gets no automatic cleanup and uses handleTooltip.destroy() instead, rather
	// than crashing on lifecycle_outside_component.
	try {
		onDestroy(destroy);
	} catch {
		/* not in component init; the caller owns destroy() */
	}

	function handleTooltip(event) {
		const detail = event.detail;
		if (detail?.visible) {
			stashed = detail;
			if (altDown) return; // suppress dispatches while Alt is held
		} else {
			stashed = null;
		}
		setTooltip(detail);
	}
	handleTooltip.destroy = destroy;
	return handleTooltip;
}
