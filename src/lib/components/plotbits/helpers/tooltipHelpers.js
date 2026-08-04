// Shared utilities for plotbit tooltips (Points, Line, Hist, etc.)
//
// The tooltip system uses a CustomEvent('tooltip', {detail, bubbles:true})
// that parent plot components listen for via ontooltip={handler}. Each
// plotbit dispatches this event from its hover handlers; helpers here
// handle formatting, value lookup across sibling series, and positioning.

import { onDestroy } from 'svelte';
import { formatDateTime } from '$lib/utils/time/displayTime.js';

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
	} catch (e) {
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
	const xStr = xFormatter ? xFormatter(xValue) : safeFormat(xValue, dp, xtype);
	let content = `<span style="opacity:0.7">${xLabel}:</span> ${xStr}`;
	for (const s of series) {
		if (s.yValue == null || (typeof s.yValue === 'number' && isNaN(s.yValue))) continue;
		const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${s.colour};margin-right:4px;vertical-align:middle;"></span>`;
		const label = s.label || 'Data';
		const yStr = safeFormat(s.yValue, dp);
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
