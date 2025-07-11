<script>
	// @ts-nocheck
	import { select, selectAll } from 'd3-selection';
	import { axisBottom, axisLeft, axisTop, axisRight } from 'd3-axis';

	let {
		height, //height of the plot
		width, //width of the plot
		yoffset, //any offset y
		xoffset, //any offset x
		position, //where the axis should be (x or y etc)
		scale, //the d3s scale to use
		nticks, //number of ticks
		colour, //colour of the lines and values
		gridlines = true //whether to show gridlines or not
	} = $props();

	let ticklength = 6;
	let tickspace = 15;
	let tickfontsize = 15;
</script>

<g class="axis" style="transform:translate({xoffset}px, {yoffset}px);">
	{#each scale.ticks(nticks) as t}
		<!-- Do the gridlines -->
		{#if gridlines}
			<g class="gridlines">
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
			</g>
		{/if}

		<!-- Do the ticks -->
		{#if position == 'bottom'}
			<line
				class="tick"
				x1={scale(t)}
				x2={scale(t)}
				y1={height}
				y2={height + ticklength}
				style="stroke: black;stroke-width: 1px;"
			/>
			<text
				class="ticklabel"
				x={scale(t)}
				y={height + ticklength + tickspace}
				text-anchor="middle"
				font-size={tickfontsize}>{t}</text
			>
		{:else if position == 'top'}
			<line
				class="tick"
				x1={scale(t)}
				x2={scale(t)}
				y1={0}
				y2={0 - ticklength}
				style="stroke: black;stroke-width: 1px;"
			/>
			<text
				class="ticklabel"
				x={scale(t)}
				y={0 - ticklength - tickspace / 2}
				text-anchor="middle"
				font-size={tickfontsize}>{t}</text
			>
		{:else if position == 'left'}
			<line
				class="tick"
				x1={0}
				x2={0 - ticklength}
				y1={scale(t)}
				y2={scale(t)}
				style="stroke: black;stroke-width: 1px;"
			/>
			<text
				class="ticklabel"
				x={0 - ticklength * 2}
				y={scale(t)}
				text-anchor="end"
				dominant-baseline="middle"
				font-size={tickfontsize}>{t}</text
			>
		{:else if position == 'right'}
			<line
				class="tick"
				x1={width}
				x2={width + ticklength}
				y1={scale(t)}
				y2={scale(t)}
				style="stroke: black;stroke-width: 1px;"
			/>
			<text
				class="ticklabel"
				x={width + ticklength * 2}
				y={scale(t)}
				text-anchor="start"
				dominant-baseline="middle"
				font-size={tickfontsize}>{t}</text
			>
		{/if}
	{/each}

	<!-- Do the line -->
	{#if position == 'bottom'}
		<line
			class="axisline"
			x1={0}
			x2={width}
			y1={height}
			y2={height}
			style="stroke: black;stroke-width: 1px;"
		/>
	{:else if position == 'top'}
		<line
			class="axisline"
			x1={0}
			x2={width}
			y1={0}
			y2={0}
			style="stroke: black;stroke-width: 1px;"
		/>
	{:else if position == 'left'}
		<line
			class="axisline"
			x1={0}
			x2={0}
			y1={0}
			y2={height}
			style="stroke: black;stroke-width: 1px;"
		/>
	{:else if position == 'right'}
		<line
			class="axisline"
			x1={width}
			x2={width}
			y1={0}
			y2={height}
			style="stroke: black;stroke-width: 1px;"
		/>
	{/if}
</g>
