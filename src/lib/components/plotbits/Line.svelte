<script>
	let { x, y, xscale, yscale, strokeCol, strokeWidth, yoffset, xoffset } = $props();

	let xlims = $derived(xscale.domain());
	let ylims = $derived(yscale.domain());

	let width = $derived(xscale.range()[1]);
	let height = $derived(yscale.range()[0]);

	let clipKey = $derived(`${xoffset},${yoffset},${width},${height}`);

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
		for (let i = x.length - 2; i >= 0; i--) {
			if (x[i] <= Math.max(xlims[0], xlims[1])) {
				return i + 1;
			}
		}
		return x.length - 1;
	});

	let line = $derived.by(() => {
		let out = '';
		for (let p = beforeIdx; p <= afterIdx; p++) {
			out += xscale(x[p]) + ',' + yscale(y[p]) + ' ';
		}

		return out;
	});
</script>

<clipPath id={clipKey}>
	<rect x={xoffset} y={yoffset} {width} {height} />
</clipPath>

<g clip-path={`url(#${clipKey})`}>
	<polyline
		points={line}
		fill="none"
		stroke={strokeCol}
		stroke-width={strokeWidth}
		style={`transform: translate(	${xoffset}px,
									${yoffset}px);`}
	/>
</g>

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
