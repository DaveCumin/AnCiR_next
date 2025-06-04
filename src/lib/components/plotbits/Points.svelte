<script>
	let { x, y, xscale, yscale, radius, fillCol, style } = $props();

	let tempx = $derived.by(() => {
		let out = x.getData() ?? [];
		out = out.map((val) => xscale(val));
		return out;
	});
	let tempy = $derived.by(() => {
		let out = y.getData() ?? [];
		out = out.map((val) => yscale(val));
		return out;
	});
</script>

{#each tempx as x, i}
	<circle {style} cx={x} cy={tempy[i]} r={radius} fill={fillCol} />
{/each}
