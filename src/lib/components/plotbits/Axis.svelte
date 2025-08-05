<script>
	// @ts-nocheck
	import { select, selectAll } from 'd3-selection';
	import { axisBottom, axisLeft, axisTop, axisRight } from 'd3-axis';

	import { timeFormat } from 'd3-time-format';
	import { scaleTime } from 'd3-scale';
	import { transition } from 'd3-transition';
	import Plot from '$lib/core/Plot.svelte';

	let {
		height, //height of the plot
		width, //width of the plot
		plotPadding = { top: 0, right: 0, bottom: 0, left: 0 },
		axisLeftWidth = 0,
		position, //where the axis should be (x or y etc)
		scale, //the d3s scale to use
		nticks, //number of ticks
		gridlines = true, //whether to show gridlines or not
		label = ''
	} = $props();

	let axisGroup;

	let ticklength = 6;
	let tickspace = 4;
	let tickfontsize = 15;
	let labelfontsize = 16;

	$effect(() => {
		height;
		width;
		axisLeftWidth;
		plotPadding;
		//Set a transition
		// const t = transition().duration(10); //Doesn't look good without a similar transition for the line/points/etc... hard to do.

		// DO THE SCALES
		let axis;
		if (position == 'bottom') {
			axis = axisBottom(scale).ticks(nticks).tickSize(ticklength).tickPadding(tickspace);
			select(axisGroup)
				.call(axis)
				.style(
					'transform',
					`translate(${plotPadding.left + axisLeftWidth}px, ${height + plotPadding.top}px)`
				);
		}
		if (position == 'top') {
			axis = axisTop(scale).ticks(nticks).tickSize(ticklength).tickPadding(tickspace);
			select(axisGroup)
				.call(axis)
				.style(
					'transform',
					`translate(${plotPadding.left + axisLeftWidth}px, ${plotPadding.top}px)`
				);
		}
		if (position == 'left') {
			axis = axisLeft(scale).ticks(nticks).tickSize(ticklength).tickPadding(tickspace);
			select(axisGroup)
				.call(axis)
				.style(
					'transform',
					`translate(${plotPadding.left + axisLeftWidth}px, ${plotPadding.top}px)`
				);
		}
		if (position == 'right') {
			axis = axisRight(scale).ticks(nticks).tickSize(ticklength).tickPadding(tickspace);
			select(axisGroup)
				.call(axis)
				.style(
					'transform',
					`translate(${width + plotPadding.left + axisLeftWidth}px, ${plotPadding.top}px)`
				);
		}
		select(axisGroup)
			// .transition(t)
			.call(axis)
			.style('font-size', `${tickfontsize}px`)
			.style('font-family', 'system-ui, sans-serif');

		// DO GRIDLINES
		if (gridlines) {
			select(axisGroup).selectAll('.gridline').remove(); // Remove all existing gridlines
			if (position == 'bottom') {
				select(axisGroup)
					.selectAll('.tick')
					.append('line')
					.attr('class', 'gridline')
					.attr('y1', -plotPadding.top) // Start at top of plot area
					.attr('y2', -(height - plotPadding.bottom)); // End at bottom of plot area
			} else if (position == 'top') {
				select(axisGroup)
					.selectAll('.tick')
					.append('line')
					.attr('class', 'gridline')
					.attr('y1', 0) // Start at axis
					.attr('y2', height - plotPadding.top - plotPadding.bottom); // End at bottom of plot area
			} else if (position == 'left') {
				select(axisGroup)
					.selectAll('.tick')
					.append('line')
					.attr('class', 'gridline')
					.attr('x1', 0) // Start at axis
					.attr('x2', width - plotPadding.right - plotPadding.left + axisLeftWidth); // End at right edge of plot area
			} else if (position == 'right') {
				select(axisGroup)
					.selectAll('.tick')
					.append('line')
					.attr('class', 'gridline')
					.attr('x1', 0) // Start at axis
					.attr('x2', -(width + plotPadding.left - axisLeftWidth - plotPadding.right)); // End at left edge of plot area
			}
			selectAll('.gridline')
				.style('stroke', 'grey')
				.style('stroke-width', '1px')
				.style('stroke-dasharray', '4')
				.style('stroke-opacity', '0.8');
		} else {
			select(axisGroup).selectAll('.gridline').remove(); // Remove gridlines if disabled
		}

		//TODO: find a better way to put the label (especially the y label) so it isn't taken over by the tick text
		//DO THE LABEL
		// Remove existing label
		select(axisGroup).select('.axis-label').remove();
		//add in the label
		let labelElement = select(axisGroup)
			.append('text')
			.attr('class', 'axis-label')
			.style('font-size', `${labelfontsize}px`)
			.style('font-family', 'system-ui, sans-serif')
			.style('text-anchor', 'middle')
			.style('fill', 'black')
			.text(label);

		if (position == 'bottom') {
			labelElement.attr('x', width / 2).attr('y', 45); // Position below the ticks
		} else if (position == 'top') {
			labelElement.attr('x', width / 2).attr('y', -30); // Position above the ticks
		} else if (position == 'left') {
			labelElement
				.attr('transform', `rotate(-90)`)
				.attr('x', -height / 2)
				.attr('y', -40); // Position to the left of the ticks
		} else if (position == 'right') {
			labelElement
				.attr('transform', `rotate(90)`)
				.attr('x', height / 2)
				.attr('y', -40); // Position to the right of the ticks
		}
	});
</script>

{#key (position, height, width, plotPadding, axisLeftWidth, scale, nticks, gridlines)}
	<g bind:this={axisGroup} class={'axis-' + position} />
{/key}
