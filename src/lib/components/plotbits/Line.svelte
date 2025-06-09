<script>
	let { x, y, xscale, yscale, strokeCol, strokeWidth, yoffset, xoffset } = $props();

	let line = $derived.by(() => {
		let tempx = x.getData() ?? [];
		let tempy = y.getData() ?? [];
		let xlims = xscale.domain();
		let ylims = yscale.domain();
		let buffer = Math.max(
			1,
			Math.abs(xlims[1] - xlims[0]) / 10,
			Math.abs(ylims[1] - ylims[0]) / 10
		);
		let out = '';
		for (let p = 0; p < tempx.length; p++) {
			if (
				tempx[p] >= Math.min(xlims[0], xlims[1]) - buffer &&
				tempx[p] <= Math.max(xlims[0], xlims[1]) + buffer &&
				tempy[p] >= Math.min(ylims[0], ylims[1]) - buffer &&
				tempy[p] <= Math.max(ylims[0], ylims[1]) + buffer
			) {
				out += xscale(tempx[p]) + ',' + yscale(tempy[p]) + ' ';
			}
		}

		return out;
	});
</script>

<polyline
	points={line}
	fill="none"
	stroke={strokeCol}
	stroke-width={strokeWidth}
	style={`transform: translate(	${xoffset}px,
									${yoffset}px);`}
/>

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
