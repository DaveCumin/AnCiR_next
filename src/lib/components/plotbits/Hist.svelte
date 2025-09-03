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
	let {
		xStart, // Array of start x positions for each bar
		xEnd, // Array of end x positions for each bar
		y, // Array of heights for each bar
		xscale, // D3 scale for x-axis
		yscale, // D3 scale for y-axis
		colour, // Fill color for bars
		yoffset = 0, // Y translation offset
		xoffset = 0 // X translation offset
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
</script>

<polyline
	points={theline}
	fill={colour}
	style={styleString}
	transform="translate({xoffset}, {yoffset})"
/>
