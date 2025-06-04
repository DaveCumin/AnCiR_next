<script>
	// @ts-nocheck
	import { select, selectAll } from 'd3-selection';
	import { axisBottom, axisLeft, axisTop, axisRight } from 'd3-axis';

	let {
		height = $bindable(), //height of the plot
		width = $bindable(), //width of the plot
		yoffset = $bindable(0), //any offset y
		xoffset = $bindable(0), //any offset x
		position = $bindable(), //where the axis should be (x or y etc)
		scale = $bindable(), //the d3s scale to use
		nticks = $bindable(4), //number of ticks
		colour = $bindable('black'), //colour of the lines and values
		gridlines = $bindable(true) //whether to show gridlines or not //TODO: make this work
	} = $props();

	let transform;
	let g;

	$effect(() => {
		select(g).selectAll('*').remove();

		scale = scale.nice();

		let axis;
		switch (position) {
			case 'bottom':
				axis = axisBottom(scale).tickSizeOuter(0).ticks(nticks);
				transform = `translate(${xoffset}px, ${height + yoffset}px)`;
				break;

			case 'top':
				axis = axisTop(scale).tickSizeOuter(0).ticks(nticks);
				transform = `translate(${xoffset}px, ${yoffset}px)`;
				break;

			case 'left':
				axis = axisLeft(scale).tickSizeOuter(0).ticks(nticks);
				transform = `translate(${xoffset}px, ${yoffset}px)`;
				break;

			case 'right':
				axis = axisRight(scale).tickSizeOuter(0).ticks(nticks);
				transform = `translate(${xoffset + width}px, ${yoffset}px)`;
				break;
		}
		select(g).call(axis).selectAll('path').style('stroke', colour);
		select(g).call(axis).selectAll('text').style('fill', colour).style('font-size', 15);
		select(g).call(axis).style('transform', transform);
	});
</script>

<g class="axis" bind:this={g} />

{#if gridlines}
	<g class="gridlines" style="transform:translate({xoffset}px, {yoffset}px);">
		{#each scale.ticks(nticks) as t}
			{#if position == 'bottom' || position == 'top'}
				<line
					class="gridline"
					x1={scale(t)}
					x2={scale(t)}
					y1={0}
					y2={height}
					style="stroke: black;stroke-width: 1px;stroke-dasharray: 4;stroke-opacity: 0.3;"
				/>
			{:else}
				<line
					class="gridline"
					x1={0}
					x2={width}
					y1={scale(t)}
					y2={scale(t)}
					style="stroke: black;stroke-width: 1px;stroke-dasharray: 4;stroke-opacity: 0.3;"
				/>
			{/if}
		{/each}
	</g>
{/if}
