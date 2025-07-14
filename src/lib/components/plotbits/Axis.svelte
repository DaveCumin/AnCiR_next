<script>
	// @ts-nocheck
	import { select, selectAll } from 'd3-selection';
	import { axisBottom, axisLeft, axisTop, axisRight } from 'd3-axis';

	import { timeFormat } from 'd3-time-format';
	import { scaleTime } from 'd3-scale';

	let {
		height, //height of the plot
		width, //width of the plot
		yoffset, //any offset y
		xoffset, //any offset x
		position, //where the axis should be (x or y etc)
		scale, //the d3s scale to use
		nticks, //number of ticks
		gridlines = true //whether to show gridlines or not
	} = $props();

	let axisGroup;

	let ticklength = 6;
	let tickspace = 4;
	let tickfontsize = 15;

	$effect(() => {
		height;
		width;
		yoffset;
		xoffset;
		// DO THE SCALES
		let axis;
		if (position == 'bottom') {
			axis = axisBottom(scale).ticks(nticks).tickSize(ticklength).tickPadding(tickspace);
			select(axisGroup)
				.call(axis)
				.style('font-size', `${tickfontsize}px`)
				.style('transform', `translate(${xoffset}px, ${height + yoffset}px)`);
		}
		if (position == 'top') {
			axis = axisTop(scale).ticks(nticks).tickSize(ticklength).tickPadding(tickspace);
			select(axisGroup)
				.call(axis)
				.style('font-size', `${tickfontsize}px`)
				.style('transform', `translate(${xoffset}px, ${yoffset}px)`);
		}
		if (position == 'left') {
			axis = axisLeft(scale).ticks(nticks).tickSize(ticklength).tickPadding(tickspace);
			select(axisGroup)
				.call(axis)
				.style('font-size', `${tickfontsize}px`)
				.style('transform', `translate(${xoffset}px, ${yoffset}px)`);
		}
		if (position == 'right') {
			axis = axisRight(scale).ticks(nticks).tickSize(ticklength).tickPadding(tickspace);
			select(axisGroup)
				.call(axis)
				.style('font-size', `${tickfontsize}px`)
				.style('transform', `translate(${width + xoffset}px, ${yoffset}px)`);
		}
		//DO GRIdLINES
		if (gridlines) {
			if (position == 'bottom') {
				select(axisGroup)
					.selectAll('.tick')
					.append('line')
					.attr('class', 'gridline')
					.attr('y1', 0)
					.attr('y2', -height);
			} else if (position == 'top') {
				select(axisGroup)
					.selectAll('.tick')
					.append('line')
					.attr('class', 'gridline')
					.attr('y1', 0)
					.attr('y2', height);
			} else if (position == 'left') {
				select(axisGroup)
					.selectAll('.tick')
					.append('line')
					.attr('class', 'gridline')
					.attr('x1', 0)
					.attr('x2', width);
			} else if (position == 'right') {
				select(axisGroup)
					.selectAll('.tick')
					.append('line')
					.attr('class', 'gridline')
					.attr('x1', 0)
					.attr('x2', -width);
			}
			selectAll('.gridline')
				.style('stroke', 'grey')
				.style('stroke-width', '1px')
				.style('stroke-dasharray', '4')
				.style('stroke-opacity', '0.8');
		}
	});
</script>

{#key (position, height, width, yoffset, xoffset, scale, nticks, gridlines)}
	<g bind:this={axisGroup} class={'axis-' + position} />
{/key}
