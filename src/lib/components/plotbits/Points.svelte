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
			//Only include the points within the limits
			if (
				tempx[p] >= Math.min(xlims[0], xlims[1]) &&
				tempx[p] <= Math.max(xlims[0], xlims[1]) &&
				tempy[p] >= Math.min(ylims[0], ylims[1]) &&
				tempy[p] <= Math.max(ylims[0], ylims[1])
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
