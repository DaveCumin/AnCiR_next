<script>
	let { projection: P, value, length, colour, headSize = 9 } = $props();
	let ok = $derived(Number.isFinite(value) && Number.isFinite(length));
</script>

{#if ok}
	{@const [x, y] = P.toXY(value, length)}
	{@const th = P.angle(value)}
	{@const dx = Math.sin(th)}
	{@const dy = -Math.cos(th)}
	{@const px = -dy}
	{@const py = dx}
	<g class="mean-vector">
		<line
			x1={P.cx}
			y1={P.cy}
			x2={x}
			y2={y}
			stroke={colour}
			stroke-width="2.6"
			stroke-linecap="round"
		/>
		<path
			d={`M ${x} ${y} L ${x - headSize * dx + headSize * 0.55 * px} ${y - headSize * dy + headSize * 0.55 * py} L ${x - headSize * dx - headSize * 0.55 * px} ${y - headSize * dy - headSize * 0.55 * py} Z`}
			fill={colour}
		/>
		<circle cx={P.cx} cy={P.cy} r="2.4" fill={colour} />
	</g>
{/if}
