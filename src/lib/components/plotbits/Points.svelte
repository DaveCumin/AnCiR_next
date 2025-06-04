<script>
	let { x, y, xscale, yscale, radius, fillCol, style, usecanvas = false } = $props();

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

	$effect(() => {
		if (usecanvas) {
			context = canvas.getContext('2d');
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.fillStyle = fillCol;
			draw();
		}
	});

	function draw() {
		context.clearRect(0, 0, canvas.width, canvas.height);
		scaledData.tempx.forEach((p, i) => {
			context.beginPath();
			context.arc(scaledData.tempx[i], scaledData.tempy[i], radius, 0, 2 * Math.PI);
			context.fill();
		});
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
	{#each scaledData.tempx as x, i}
		<circle {style} cx={x} cy={scaledData.tempy[i]} r={radius} fill={fillCol} />
	{/each}
{/if}
