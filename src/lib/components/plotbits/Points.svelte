<script>
	let { x, y, xscale, yscale, radius, fillCol, yoffset, xoffset } = $props();

	let points = $derived.by(() => {
		let out = '';

		//Create the polyline
		let tempx = x.getData() ?? [];
		let tempy = y.getData() ?? [];
		let xlims = xscale.domain();
		let ylims = yscale.domain();
		for (let p = 0; p < tempx.length; p++) {
			if (
				tempx[p] >= xlims[0] &&
				tempx[p] <= xlims[1] &&
				tempy[p] >= ylims[0] &&
				tempy[p] <= ylims[1]
			) {
				out += `M${xscale(tempx[p])} ${yscale(tempy[p])} m-${radius} 0 a${radius} ${radius} 0 1 0 ${2 * radius} 0 a${radius} ${radius} 0 1 0 -${2 * radius} 0`;
			}
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
