<script module>
	// Helper function to convert x positions to xStart/xEnd arrays for histogram

	export function createHistogramBins(xData, binSize) {
		if (!xData || xData.length === 0) return { xStart: [], xEnd: [] };

		const xStart = [];
		const xEnd = [];

		for (let i = 0; i < xData.length; i++) {
			xStart.push(xData[i]);
			xEnd.push(xData[i] + binSize);
		}

		return { xStart, xEnd };
	}
</script>

<script>
	import {
		buildAggregatedContent,
		computeTooltipPosition,
		dispatchTooltip,
		hideTooltip,
		findBinValue
	} from '$lib/components/plotbits/helpers/tooltipHelpers.js';

	let {
		xStart, // Array of start x positions for each bar
		xEnd, // Array of end x positions for each bar
		y, // Array of heights for each bar
		xscale, // D3 scale for x-axis
		yscale, // D3 scale for y-axis
		colour, // Fill color for bars
		yoffset = 0, // Y translation offset
		xoffset = 0, // X translation offset
		// Tooltip props (same shape as Points/Line)
		tooltip = false,
		xtype = 'number',
		xLabel = 'x',
		yLabel = 'y',
		dataLabel = '',
		dataColour = '',
		// Optional custom x formatter (e.g. for time axes that need app-specific formatting)
		xFormatter = null,
		// Added to the mouse-derived x before sibling lookup; lets Actogram map
		// hrs-into-day-row to absolute hours by passing dayIndex * periodHrs.
		xDataOffset = 0,
		// Height (px) of the transparent hitbox that catches hover across the whole row.
		// When 0/null, hover events only fire over drawn bars (the polyline fill).
		hitboxHeight = 0,
		// When provided, tooltip aggregates y values across sibling series at the hovered x.
		// Shape: [{label, colour, findYAt(x)}]
		siblings = null
	} = $props();

	// Validate input arrays have same length
	if (xStart?.length !== xEnd?.length || xStart?.length !== y?.length) {
		console.warn('Hist component: xStart, xEnd, and y arrays must have the same length');
	}

	let theline = $derived.by(() => {
		if (!xStart || !xEnd || !y || !xscale || !yscale) {
			return '';
		}

		let height = yscale.range()[0]; // Bottom of the plot area

		let out = '';

		// Process each bar
		for (let i = 0; i < Math.min(xStart.length, xEnd.length, y.length); i++) {
			let leftEdge = xStart[i];
			let rightEdge = xEnd[i];

			// Add separator between polygons (required for multiple bars)
			if (i > 0) out += ' ';

			// Create bar as a polygon: bottom-left, top-left, top-right, bottom-right
			out += `${xscale(leftEdge)},${height} `; // bottom left
			out += `${xscale(leftEdge)},${yscale(y[i])} `; // top left
			out += `${xscale(rightEdge)},${yscale(y[i])} `; // top right
			out += `${xscale(rightEdge)},${height}`; // bottom right
		}

		return out;
	});

	// Build style string for additional styling options
	let styleString = $derived(() => {
		let styles = [];
		if (opacity !== 1) styles.push(`fill-opacity: ${opacity}`);
		if (stroke) styles.push(`stroke: ${stroke}`);
		if (strokeWidth > 0) styles.push(`stroke-width: ${strokeWidth}px`);
		return styles.length > 0 ? styles.join('; ') : '';
	});

	function handleHover(e) {
		if (!tooltip) return;

		const mouseX = e.offsetX;
		const mouseY = e.offsetY;

		// Map pixel x to data x (in this row's coordinate system), then add any
		// caller-provided offset to arrive at the true "absolute" x used for lookups.
		const rawDataX = xscale.invert(mouseX - xoffset);
		const dataX = rawDataX + xDataOffset;

		const series = siblings
			? siblings.map((s) => ({
					label: s.label,
					colour: s.colour,
					yValue: s.findYAt ? s.findYAt(dataX) : null
				}))
			: [
					{
						label: dataLabel,
						colour: dataColour || colour,
						yValue: findBinValue(xStart, xEnd, y, rawDataX),
						yLabel
					}
				];

		const content = buildAggregatedContent({
			xLabel: xLabel || 'x',
			xValue: dataX,
			xtype,
			xFormatter,
			series
		});

		const srcRect = e.srcElement.getBoundingClientRect();
		const { x: xPos, y: yPos } = computeTooltipPosition(mouseX, mouseY, srcRect);
		dispatchTooltip(e.target, { visible: true, x: xPos, y: yPos, content });
	}

	function handleMouseLeave(e) {
		if (!tooltip) return;
		hideTooltip(e.target);
	}

	let useHitbox = $derived(tooltip && hitboxHeight > 0);
	let hitboxWidth = $derived(xscale?.range ? xscale.range()[1] : 0);
</script>

<polyline
	points={theline}
	fill={colour}
	style={styleString}
	transform="translate({xoffset}, {yoffset})"
	onmousemove={tooltip && !useHitbox ? handleHover : undefined}
	onmouseleave={tooltip && !useHitbox ? handleMouseLeave : undefined}
/>
{#if useHitbox}
	<rect
		x={xoffset}
		y={yoffset}
		width={hitboxWidth}
		height={hitboxHeight}
		fill="transparent"
		pointer-events="all"
		onmousemove={handleHover}
		onmouseleave={handleMouseLeave}
	/>
{/if}
