<script>
	//TODO: add a way to display a tooltip on hover
	let { x, y, xscale, yscale, radius, fillCol, yoffset, xoffset } = $props();

	let beforeIdx = $derived.by(() => {
		//find the x point before the limit
		let xlims = xscale.domain();
		for (let i = 1; i < x.length; i++) {
			if (x[i] >= Math.min(xlims[0], xlims[1])) {
				return i - 1;
			}
		}
		return 0;
	});

	let afterIdx = $derived.by(() => {
		//find the x point after the limit
		let xlims = xscale.domain();
		for (let i = x.length - 2; i >= 0; i--) {
			if (x[i] <= Math.max(xlims[0], xlims[1])) {
				return i + 1;
			}
		}
		return x.length - 1;
	});

	//MAKE THE POINTS PATH
	let points = $derived.by(() => {
		let out = '';
		for (let p = beforeIdx; p <= afterIdx; p++) {
			//only include the point if it's within the y limits
			if (y[p] >= yscale.domain()[0] && y[p] <= yscale.domain()[1]) {
				out += `M${xscale(x[p])} ${yscale(y[p])} m-${radius} 0 a${radius} ${radius} 0 1 0 ${2 * radius} 0 a${radius} ${radius} 0 1 0 -${2 * radius} 0 `;
			}
		}

		return out;
	});

	function handleHover(e) {
		//cycle through the points and find the closest one to the mouse
		let closestIdx = -1;
		let closestDist = Infinity;
		for (let p = beforeIdx; p <= afterIdx; p++) {
			const dist = Math.sqrt(
				Math.pow(e.offsetX - xscale(x[p]), 2) + Math.pow(e.offsetY - yscale(y[p]), 2)
			);
			if (dist < closestDist) {
				closestDist = dist;
				closestIdx = p - 1;
			}
		}
		if (closestIdx >= 0) {
			console.log(`Hovered point: ${closestIdx} at (${x[closestIdx]}, ${y[closestIdx]})`);
		}
	}
</script>

<path
	d={points}
	fill={fillCol}
	stroke="none"
	style={`transform: translate( ${xoffset}px, ${yoffset}px );`}
	onmousemove={(e) => {
		handleHover(e);
	}}
/>
