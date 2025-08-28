<script>
	let { x, y, xscale, yscale, colour, yoffset, xoffset } = $props();

	let theline = $derived.by(() => {
		let width = xscale.range()[1];
		let height = yscale.range()[0]; // This is eachplotheight
		let baseline = height; // Use the bottom of the plot area as baseline

		//This is to update at some point
		let barWidth = x.length > 1 ? Math.min(...x.slice(1).map((xi, i) => xi - x[i])) : 1;

		let out = '';

		// Create individual bars for each data point
		for (let i = 0; i < x.length; i++) {
			let leftEdge = x[i] - barWidth / 2;
			let rightEdge = x[i] + barWidth / 2;

			// Start new bar at baseline
			if (i > 0) out += ' '; // separator for multiple polygons

			out += `${xscale(leftEdge)},${baseline} `; // bottom left
			out += `${xscale(leftEdge)},${yscale(y[i])} `; // top left
			out += `${xscale(rightEdge)},${yscale(y[i])} `; // top right
			out += `${xscale(rightEdge)},${baseline}`; // bottom right
		}

		return out;
	});
</script>

<polyline points={theline} fill={colour} transform="translate({xoffset || 0}, {yoffset || 0})" />
