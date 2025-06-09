<script>
	let { x, y, xscale, yscale, radius, fillCol, yoffset, xoffset } = $props();

	let points = $derived.by(() => {
		let out = '';

		//Create the polyline
		let tempx = x.getData() ?? [];
		let tempy = y.getData() ?? [];
		let xlims = xscale.domain();
		let ylims = yscale.domain();
		let buffer = Math.max(
			1,
			Math.abs(xlims[1] - xlims[0]) / 10,
			Math.abs(ylims[1] - ylims[0]) / 10
		);
		for (let p = 0; p < tempx.length; p++) {
			if (
				tempx[p] >= Math.min(xlims[0], xlims[1]) - buffer &&
				tempx[p] <= Math.max(xlims[0], xlims[1]) + buffer &&
				tempy[p] >= Math.min(ylims[0], ylims[1]) - buffer &&
				tempy[p] <= Math.max(ylims[0], ylims[1]) + buffer
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
