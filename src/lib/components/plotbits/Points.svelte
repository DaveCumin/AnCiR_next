<script>
	let { x, y, xscale, yscale, radius, fillCol, yoffset, xoffset } = $props();

	let context;

	let scaledData = $derived.by(() => {
		let tempx = x.getData() ?? [];
		let tempy = y.getData() ?? [];

		//normalise according to the scale
		tempx = tempx.map((val) => xscale(val));
		tempy = tempy.map((val) => yscale(val));

		return { tempx, tempy };
	});
	let points = $derived.by(() => {
		let out = '';

		//Create the polyline
		for (let p = 0; p < scaledData.tempx.length; p++) {
			out += `M${scaledData.tempx[p]} ${scaledData.tempy[p]} m-${radius} 0 a${radius} ${radius} 0 1 0 ${2 * radius} 0 a${radius} ${radius} 0 1 0 -${2 * radius} 0`;
		}

		return out;
	});
</script>

<path
	d={points}
	fill={fillCol}
	stroke="none"
	style={`transform: translate(	${xoffset}px,
													${yoffset}px);`}
/>
