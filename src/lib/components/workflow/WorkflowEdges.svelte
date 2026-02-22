<script>
	// @ts-nocheck
	let { edges = [], width = 0, height = 0 } = $props();

	const edgeColors = {
		'data-process': '#aaaaaa',
		'data-plot': '#4db87a',
		'data-tp': '#aaaaaa',
		'tp-data': '#e08030'
	};

	function cubicBezierPath(x1, y1, x2, y2) {
		const cx = Math.abs(x2 - x1) * 0.5;
		return `M ${x1} ${y1} C ${x1 + cx} ${y1}, ${x2 - cx} ${y2}, ${x2} ${y2}`;
	}
</script>

<svg
	style="position: absolute; top: 0; left: 0; pointer-events: none; overflow: visible;"
	{width}
	{height}
>
	{#each edges as edge (`${edge.fromId}_${edge.toId}_${edge.type}`)}
		{#if edge.from && edge.to}
			<path
				d={cubicBezierPath(edge.from.x, edge.from.y, edge.to.x, edge.to.y)}
				stroke={edgeColors[edge.type] ?? '#aaaaaa'}
				stroke-width="1.5"
				fill="none"
				opacity="0.7"
			/>
		{/if}
	{/each}
</svg>
