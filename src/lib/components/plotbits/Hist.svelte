<script>
	let { x, y, xscale, yscale, colour, yoffset, xoffset } = $props();

	let theline = $derived.by(() => {
		let height = yscale.range()[0]; // This is eachplotheight
		let baseline = height; // Use the bottom of the plot area as baseline

		//This is to update at some point
		let barWidth = x.length > 1 ? Math.min(...x.slice(1).map((xi, i) => xi - x[i])) : 1;

		let out = '';

		if (x.length === 2 && y.length === 2 && y[0] === y[1]) {
			// Single bar case - treat x as [startX, endX] and y[0] as height
			let leftEdge = x[0];
			let rightEdge = x[1];
			let barHeight = y[0];

			out += `${xscale(leftEdge)},${baseline} `; // bottom left
			out += `${xscale(leftEdge)},${yscale(barHeight)} `; // top left
			out += `${xscale(rightEdge)},${yscale(barHeight)} `; // top right
			out += `${xscale(rightEdge)},${baseline}`; // bottom right
		} else {
			// Create individual bars for each data point
			for (let i = 0; i < x.length; i++) {
				let leftEdge = x[i];
				let rightEdge = x[i] + barWidth;

				// Start new bar at baseline
				if (i > 0) out += ' '; // separator for multiple polygons

				out += `${xscale(leftEdge)},${baseline} `; // bottom left
				out += `${xscale(leftEdge)},${yscale(y[i])} `; // top left
				out += `${xscale(rightEdge)},${yscale(y[i])} `; // top right
				out += `${xscale(rightEdge)},${baseline}`; // bottom right
			}
		}

		return out;
	});
</script>

<polyline points={theline} fill={colour} transform="translate({xoffset || 0}, {yoffset || 0})" />
