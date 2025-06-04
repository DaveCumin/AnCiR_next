<script>
	let { x, y, xscale, yscale, strokeCol, strokeWidth, style, usecanvas = false } = $props();

	let canvas;
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
		console.log('me');
		let out = '';

		//Create the polyline
		for (let p = 0; p < scaledData.tempx.length; p++) {
			out += scaledData.tempx[p] + ',' + scaledData.tempy[p] + ' ';
		}

		return out;
	});

	$effect(() => {
		if (usecanvas) {
			context = canvas.getContext('2d');
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.strokeStyle = strokeCol;
			context.lineWidth = strokeWidth;
			console.log(context);
			draw();
		}
	});

	function draw() {
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.beginPath();

		scaledData.tempx.forEach((x, i) => {
			if (i === 0) {
				context.moveTo(x, scaledData.tempy[i]);
			} else {
				context.lineTo(x, scaledData.tempy[i]);
			}
		});
		context.stroke();
	}
</script>

{#if usecanvas}
	<canvas
		bind:this={canvas}
		width={xscale.range()[1]}
		height={yscale.range()[0]}
		style={'position:absolute;' + style}
	/>
{:else}
	<polyline fill="none" stroke={strokeCol} stroke-width={strokeWidth} {points} {style} />
{/if}

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
