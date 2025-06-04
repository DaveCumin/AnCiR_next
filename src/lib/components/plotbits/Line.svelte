<script>
	let { x, y, xscale, yscale, strokeCol, strokeWidth, style } = $props();

	let points = $derived.by(() => {
		let out = '';
		let tempx = x.getData() ?? [];
		let tempy = y.getData() ?? [];

		//normalise according to the scale
		tempx = tempx.map((val) => xscale(val));
		tempy = tempy.map((val) => yscale(val));

		//Create the polyline
		for (let p = 0; p < tempx.length; p++) {
			out += tempx[p] + ',' + tempy[p] + ' ';
		}

		return out;
	});
</script>

<polyline fill="none" stroke={strokeCol} stroke-width={strokeWidth} {points} {style} />

<!--
//THIS WORKS BUT IS MUCH SLOWER TO RENDER
//TODO: consider debouncing (where a 'holding' image is given when changes are made, then final graph renders)
<script>
	import { line, curveBasis } from 'd3-shape';
	let { x, y, xscale, yscale, strokeCol, strokeWidth, style } = $props();

	let data = $derived(
		x.getData().map((xVal, i) => ({
			x: xscale(xVal),
			y: yscale(y.getData()[i]),
			id: i // Unique key for data binding
		}))
	);

	let theLine = line()
		.x((d) => d.x)
		.y((d) => d.y);
	if (true) {
		theLine = theLine.curve(curveBasis);
	}
</script>

<path fill="none" stroke={strokeCol} stroke-width={strokeWidth} d={theLine(data)} {style} />
-->
