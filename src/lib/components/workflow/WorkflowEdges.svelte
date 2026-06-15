<script>
	// @ts-nocheck
	// Wire rendering ported from flowtest's NodeCanvas: a cubic bezier path with
	// dx = max(40, |tx - sx| / 2) on each side, a thicker invisible hit area for
	// future selection support, and an animated travelling dot that fires whenever
	// the edge set re-derives.
	let {
		edges = [],
		width = 0,
		height = 0,
		highlightedIds = null,
		provisionalEdge = null,
		selectedEdgeKey = null,
		onEdgeClick = null
	} = $props();

	function edgeKey(edge) {
		return `${edge.fromId}|${edge.fromPort}|${edge.toId}|${edge.toPort}|${edge.type}`;
	}

	function bezier(sx, sy, tx, ty) {
		const dx = Math.max(40, Math.abs(tx - sx) / 2);
		return `M ${sx},${sy} C ${sx + dx},${sy} ${tx - dx},${ty} ${tx},${ty}`;
	}

	function edgeOpacity(edge) {
		if (highlightedIds === null) return 1;
		return highlightedIds.has(edge.fromId) && highlightedIds.has(edge.toId) ? 1 : 0.12;
	}
</script>

<svg
	class="canvas-edges"
	style="position: absolute; top: 0; left: 0; pointer-events: none; overflow: visible;"
	{width}
	{height}
	aria-hidden="true"
>
	{#each edges as edge (edgeKey(edge))}
		{#if edge.from && edge.to}
			{@const d = bezier(edge.from.x, edge.from.y, edge.to.x, edge.to.y)}
			{@const k = edgeKey(edge)}
			{@const isSelected = selectedEdgeKey === k}
			<g style="opacity:{edgeOpacity(edge)};">
				<path
					class="edge-hit"
					{d}
					onclick={(e) => {
						e.stopPropagation();
						onEdgeClick?.(edge);
					}}
				/>
				<path class="edge-line" class:selected={isSelected} {d} />
				<circle
					class="edge-flow-dot"
					r="4"
					style:offset-path={`path('${d}')`}
					style:animation-delay={`${(edge.fromId * 137 + edge.toId * 53) % 600}ms`}
				/>
			</g>
		{/if}
	{/each}
	{#if provisionalEdge?.from && provisionalEdge?.to}
		<path
			class="edge-temp"
			d={bezier(
				provisionalEdge.from.x,
				provisionalEdge.from.y,
				provisionalEdge.to.x,
				provisionalEdge.to.y
			)}
		/>
	{/if}
</svg>

<style>
	.edge-hit {
		pointer-events: stroke;
		cursor: pointer;
		stroke: transparent;
		stroke-width: 14;
		fill: none;
	}

	.edge-line {
		stroke: var(--color-lightness-55, #888);
		stroke-width: 2;
		fill: none;
		pointer-events: none;
		transition:
			stroke 0.12s ease,
			stroke-width 0.12s ease;
	}

	.edge-line.selected {
		stroke: var(--color-accent, #4d9fe3);
		stroke-width: 3;
		filter: drop-shadow(0 0 4px rgba(77, 159, 227, 0.5));
	}

	.edge-flow-dot {
		fill: var(--color-accent, #4d9fe3);
		filter: drop-shadow(0 0 4px var(--color-accent, #4d9fe3));
		stroke: none;
		opacity: 0;
		animation: flowDot 1.5s linear forwards;
	}

	@keyframes flowDot {
		0% {
			offset-distance: 0%;
			opacity: 0;
		}
		5% {
			offset-distance: 5%;
			opacity: 1;
		}
		95% {
			opacity: 1;
		}
		100% {
			offset-distance: 100%;
			opacity: 0;
		}
	}

	.edge-temp {
		stroke: var(--color-accent, #4d9fe3);
		stroke-width: 2;
		stroke-dasharray: 4 4;
		fill: none;
		pointer-events: none;
	}
</style>
