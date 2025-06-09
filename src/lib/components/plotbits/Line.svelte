<script>
	let { x, y, xscale, yscale, strokeCol, strokeWidth, yoffset, xoffset, usecanvas, container } =
		$props();

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
			out += scaledData.tempx[p] + ',' + scaledData.tempy[p] + ' ';
		}

		return out;
	});

	$effect(() => {
		if (usecanvas && container) {
			context = container.getContext('2d');
			if (context) {
				context.strokeStyle = strokeCol;
				context.lineWidth = strokeWidth;
				draw();
			}
		}
	});

	function draw() {
		context.beginPath();

		scaledData.tempx.forEach((x, i) => {
			if (i === 0) {
				context.moveTo(x + xoffset, scaledData.tempy[i] + yoffset);
			} else {
				context.lineTo(x + xoffset, scaledData.tempy[i] + yoffset);
			}
		});
		context.stroke();
	}
</script>

{usecanvas}
{#if !usecanvas}
	<polyline
		fill="none"
		stroke={strokeCol}
		stroke-width={strokeWidth}
		{points}
		style={`transform: translate(	${xoffset}px,
													${yoffset}px);`}
	/>
{/if}

<!--
//THIS WORKS BUT IS MUCH SLOWER TO RENDER
<script>
	import { line, curveBasis } from 'd3-shape';

	let { x, y, xscale, yscale, strokeCol, strokeWidth, style, usecanvas = false } = $props();

	let canvas;
	let context;

	let basis = false;

	let scaledData = $derived(
		x.getData().map((xVal, i) => ({
			x: xscale(xVal),
			y: yscale(y.getData()[i]),
			id: i // Unique key for data binding
		}))
	);

	let theLine = line()
		.x((d) => d.x)
		.y((d) => d.y);
	if (basis) {
		theLine = theLine.curve(curveBasis);
	}

	$effect(() => {
		if (usecanvas) {
			context = canvas.getContext('2d');
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.strokeStyle = strokeCol;
			context.lineWidth = strokeWidth;
			draw();
		}
	});

	function draw() {
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.strokeStyle = strokeCol;
		context.lineWidth = strokeWidth;
		context.beginPath();
		theLine.context(context)(scaledData);
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

-->
