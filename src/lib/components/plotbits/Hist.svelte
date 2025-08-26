<script>
	let { x, y, xscale, yscale, colour, yoffset, xoffset } = $props();

	let theline = $derived.by(() => {
		let width = xscale.range()[1];
		let height = yscale.range()[0]; // This is eachplotheight
		let baseline = height; // Use the bottom of the plot area as baseline

		//now make the path
		let out = `${xscale(x[0])},${baseline} `; // start at the baseline (bottom)
		out += `${xscale(x[0])},${yscale(y[0])} `; // go to the first data point

		//cycle through the points
		for (let b = 0; b < x.length - 1; b++) {
			out += `${xscale(x[b])},${yscale(y[b])} ` + `${xscale(x[b + 1])},${yscale(y[b])} `;
		}
		//add the last ones to complete the shape.
		out += `${xscale(x[x.length - 1])},${yscale(y[x.length - 1])} `;
		if (x[x.length - 1] + 1 < xscale.domain()[1]) {
			out +=
				`${xscale(x[x.length - 1] + 1)},${yscale(y[x.length - 1])} ` +
				`${xscale(x[x.length - 1] + 1)},${baseline} `;
		} else {
			out += `${width},${yscale(y[x.length - 1])} `;
		}
		out += `${width},${baseline} `;

		return out;
	});
</script>

<polyline points={theline} fill={colour} transform="translate({xoffset || 0}, {yoffset || 0})" />
