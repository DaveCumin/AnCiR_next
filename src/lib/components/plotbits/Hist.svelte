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
	import { histPoints } from '$lib/components/plotbits/helpers/histPoints.js';

	let {
		xStart, // Array of start x positions for each bar
		xEnd, // Array of end x positions for each bar
		y, // Array of heights for each bar
		xscale, // D3 scale for x-axis
		yscale, // D3 scale for y-axis
		colour, // Fill color for bars
		// Optional outline/opacity styling for the bars. The defaults produce no
		// style attribute at all, which is what every current caller relies on.
		opacity = 1, // Fill opacity (1 = fully opaque, omitted from the style string)
		stroke = null, // Outline colour; null/'' means no outline
		strokeWidth = 0, // Outline width in px; 0 means no outline
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
		siblings = null,
		// Write a compact point string (3-decimal coordinates, touching bars merged). Same
		// drawing, a fraction of the size: for callers with many thousands of bars.
		compact = false
	} = $props();

	// Validate input arrays have same length (on every change, not just the first render).
	$effect(() => {
		const a = xStart?.length;
		if (a !== xEnd?.length || a !== y?.length) {
			console.warn('Hist component: xStart, xEnd, and y arrays must have the same length');
		}
	});

	// Each prop is read ONCE per derive: inside a component every prop read is a getter (and a
	// signal read when the parent passed an expression), so reading them per bar dominated the
	// cost of many-series actograms (review ROB-9). histPoints only ever sees plain values.
	// `compact` (dense callers such as the actogram): a smaller point string that draws the same
	// (see histPoints); an outline keeps every bar corner.
	let outlined = $derived(!!stroke && strokeWidth > 0);
	let theline = $derived(histPoints(xStart, xEnd, y, xscale, yscale, { compact, outlined }));

	// Build style string for additional styling options
	let styleString = $derived.by(() => {
		let styles = [];
		if (opacity !== 1) styles.push(`fill-opacity: ${opacity}`);
		if (stroke) styles.push(`stroke: ${stroke}`);
		if (strokeWidth > 0) styles.push(`stroke-width: ${strokeWidth}px`);
		return styles.length > 0 ? styles.join('; ') : '';
	});

	function handleHover(e) {
		if (!tooltip) return;

		const mouseX = e.offsetX;

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

		const { x: xPos, y: yPos } = computeTooltipPosition(e.clientX, e.clientY);
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
