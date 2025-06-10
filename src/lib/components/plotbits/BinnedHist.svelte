<script>
	import { binData } from '$lib/components/plotbits/helpers/wrangleData.js';

	let { x, y, binSize = 5, binStart = 0, xscale, yscale, colour, yoffset, xoffset } = $props();

	let line = $derived.by(() => {
		let width = xscale.range()[1];
		let height = yscale.range()[0];
		//get the binned
		const binned = binData(x, y, binSize, binStart);

		let out = `${width},${height} 0,${height} `; // start at the width,0 and make a baseline
		//cycle through the points
		for (let b = 0; b < binned.bins.length - 1; b++) {
			out +=
				`${xscale(binned.bins[b])},${yscale(binned.y_out[b])} ` +
				`${xscale(binned.bins[b + 1])},${yscale(binned.y_out[b])} `;
		}
		//add the last ones to complete the shape.
		out += `${xscale(binned.bins[binned.bins.length - 1])},${yscale(binned.y_out[binned.bins.length - 1])} `;
		if (binned.bins[binned.bins.length - 1] + binSize < xscale.domain()[1]) {
			out +=
				`${xscale(binned.bins[binned.bins.length - 1] + binSize)},${yscale(binned.y_out[binned.bins.length - 1])} ` +
				`${xscale(binned.bins[binned.bins.length - 1] + binSize)},${height} `;
		} else {
			out += `${width},${yscale(binned.y_out[binned.bins.length - 1])} `;
		}
		out += `${width},${height} `;

		return out;
	});
</script>

<polyline
	points={line}
	fill={colour}
	stroke={colour}
	style={`transform: translate(	${xoffset}px,
									${yoffset}px);`}
/>
