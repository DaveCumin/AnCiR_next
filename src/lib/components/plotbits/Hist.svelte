<script>
	let { x, y, xscale, yscale, colour, yoffset, xoffset } = $props();

	let theline = $derived.by(() => {
		let width = xscale.range()[1];
		let height = yscale.range()[0];

		//now make the path
		let out = `${width},${height} 0,${height} `; // start at the width,0 and make a baseline
		out += `${xscale(x[0])},${height} `; // skip to the first point

		//If the yscale is a single value, don't draw anything
		if (yscale.domain()[0] == yscale.domain()[1]) {
			return out;
		}

		//cycle through the points
		for (let b = 0; b < x.length - 1; b++) {
			out += `${xscale(x[b])},${yscale(y[b])} ` + `${xscale(x[b + 1])},${yscale(y[b])} `;
		}
		//add the last ones to complete the shape.
		out += `${xscale(x[x.length - 1])},${yscale(y[x.length - 1])} `;
		if (x[x.length - 1] + 1 < xscale.domain()[1]) {
			out +=
				`${xscale(x[x.length - 1] + 1)},${yscale(y[x.length - 1])} ` +
				`${xscale(x[x.length - 1] + 1)},${height} `;
		} else {
			out += `${width},${yscale(y[x.length - 1])} `;
		}
		out += `${width},${height} `;

		return out;
	});
</script>

<polyline
	points={theline}
	fill={colour}
	style={`transform: translate(	${xoffset ? xoffset : 0}px,
									${yoffset ? yoffset : 0}px);`}
/>
