<script>
	let { width, height, x, y, xlims, ylims, strokeCol, strokeWidth, style } = $props();

	function normalise(values, min, max) {
		return values.map((value) => (value - min) / (max - min));
	}

	let points = $derived.by(() => {
		let out = '';
		let tempx = x ?? [];
		let tempy = y ?? [];

		//normalise to the parent width and height
		tempx = normalise(tempx, xlims[0], xlims[1]);
		tempy = normalise(tempy, ylims[0], ylims[1]);

		for (let p = 0; p < tempx.length; p++) {
			out += width * tempx[p] + ',' + (height - height * tempy[p]) + ' ';
		}

		return out;
	});
</script>

<polyline fill="none" stroke={strokeCol} stroke-width={strokeWidth} {points} {style} />
