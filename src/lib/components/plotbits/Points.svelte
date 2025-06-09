<script>
	let {
		x,
		y,
		xscale,
		yscale,
		radius,
		fillCol,
		style,
		yoffset,
		xoffset,
		usecanvas = false,
		container
	} = $props();

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
			out += `M${scaledData.tempx[p]} ${scaledData.tempy[p]} m-${radius} 0 a${radius} ${radius} 0 1 0 ${2 * radius} 0 a${radius} ${radius} 0 1 0 -${2 * radius} 0`;
		}

		return out;
	});

	$effect(() => {
		if (usecanvas) {
			context = container.getContext('2d');
			if (context) {
				context.fillStyle = fillCol;
				draw();
			}
		}
	});

	function draw() {
		scaledData.tempx.forEach((p, i) => {
			context.beginPath();
			context.arc(
				scaledData.tempx[i] + xoffset,
				scaledData.tempy[i] + yoffset,
				radius,
				0,
				2 * Math.PI
			);
			context.fill();
		});
	}
</script>

{#if !usecanvas}
	<path
		d={points}
		fill={fillCol}
		stroke="none"
		style={`transform: translate(	${xoffset}px,
													${yoffset}px);`}
	/>
{/if}
