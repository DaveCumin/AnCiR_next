<script>
	// @ts-nocheck
	let {
		edges = [],
		width = 0,
		height = 0,
		highlightedIds = null,
		provisionalEdge = null
	} = $props();

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

	function edgeOpacity(edge) {
		if (highlightedIds === null) return 0.7;
		return highlightedIds.has(edge.fromId) && highlightedIds.has(edge.toId) ? 0.9 : 0.08;
	}

	function edgeStrokeWidth(edge) {
		if (highlightedIds === null) return 1.5;
		return highlightedIds.has(edge.fromId) && highlightedIds.has(edge.toId) ? 2.5 : 1;
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
				stroke-width={edgeStrokeWidth(edge)}
				fill="none"
				opacity={edgeOpacity(edge)}
			/>
		{/if}
	{/each}
	{#if provisionalEdge?.from && provisionalEdge?.to}
		<path
			d={cubicBezierPath(
				provisionalEdge.from.x,
				provisionalEdge.from.y,
				provisionalEdge.to.x,
				provisionalEdge.to.y
			)}
			stroke="#0275ff"
			stroke-width="1.5"
			stroke-dasharray="4 3"
			fill="none"
			opacity="0.8"
		/>
	{/if}
</svg>
