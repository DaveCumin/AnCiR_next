// Shared utilities for plotbit tooltips (Points, Line, Hist, etc.)
//
// The tooltip system uses a CustomEvent('tooltip', {detail, bubbles:true})
// that parent plot components listen for via ontooltip={handler}. Each
// plotbit dispatches this event from its hover handlers; helpers here
// handle formatting, value lookup across sibling series, and positioning.

/**
 * Format a value for display.
 * - type='time' renders via Date.toLocaleString (assumes value is ms or parseable)
 * - numbers are rendered with `dp` decimal places
 * - anything else is returned as-is
 */
export function safeFormat(value, dp = 3, type = 'number') {
	if (type === 'time') {
		try {
			return new Date(value).toLocaleString();
		} catch (e) {
			return value;
		}
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
 * Compute tooltip-div placement in container-local coords, avoiding overflow
 * on the right edge. srcRect should be the bounding client rect of the
 * hovered SVG (so its width is the plot width).
 */
export function computeTooltipPosition(mouseX, mouseY, srcRect, tooltipWidth = 180) {
	const xPos =
		mouseX + tooltipWidth > srcRect.width ? mouseX - (tooltipWidth + 10) : mouseX + 10;
	const yPos = mouseY < 20 ? mouseY + 40 : mouseY + 10;
	return { x: xPos, y: yPos };
}

/** Dispatch a tooltip-visible CustomEvent that bubbles up to the plot container. */
export function dispatchTooltip(target, detail) {
	target.dispatchEvent(new CustomEvent('tooltip', { detail, bubbles: true }));
}

/** Dispatch a tooltip-hidden CustomEvent. */
export function hideTooltip(target) {
	dispatchTooltip(target, { visible: false });
}
