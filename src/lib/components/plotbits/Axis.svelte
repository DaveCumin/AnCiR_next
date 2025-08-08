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
		position, //where the axis should be (x or y etc)
		scale, //the d3s scale to use
		nticks, //number of ticks
		gridlines = true, //whether to show gridlines or not
		label = '',
		autoScaleVals = { top: 45, bottom: -45, left: 30, right: -30 }
	} = $props();

	let axisGroup;

	let ticklength = 6;
	let tickspace = 4; // space between the ticks and the numbers
	let tickfontsize = 15;
	let labelfontsize = 16;
	let labelBuffer = 10; // Additional spacing between largest tick label and axis label

	$effect(() => {
		height;
		width;
		plotPadding;

		//Set a transition
		// const t = transition().duration(10); //Doesn't look good without a similar transition for the line/points/etc... hard to do.

		// DO THE SCALES
		let axis;
		if (position == 'bottom') {
			axis = axisBottom(scale).ticks(nticks).tickSize(ticklength).tickPadding(tickspace);
			select(axisGroup)
				.call(axis)
				.style('transform', `translate(${plotPadding.left}px, ${height + plotPadding.top}px)`);
		}
		if (position == 'top') {
			axis = axisTop(scale).ticks(nticks).tickSize(ticklength).tickPadding(tickspace);
			select(axisGroup)
				.call(axis)
				.style('transform', `translate(${plotPadding.left}px, ${plotPadding.top}px)`);
		}
		if (position == 'left') {
			axis = axisLeft(scale).ticks(nticks).tickSize(ticklength).tickPadding(tickspace);
			select(axisGroup)
				.call(axis)
				.style('transform', `translate(${plotPadding.left}px, ${plotPadding.top}px)`);
		}
		if (position == 'right') {
			axis = axisRight(scale).ticks(nticks).tickSize(ticklength).tickPadding(tickspace);
			select(axisGroup)
				.call(axis)
				.style('transform', `translate(${width + plotPadding.left}px, ${plotPadding.top}px)`);
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
					.attr('y2', -height); // End at bottom of plot area
			} else if (position == 'top') {
				select(axisGroup)
					.selectAll('.tick')
					.append('line')
					.attr('class', 'gridline')
					.attr('y1', 0) // Start at axis
					.attr('y2', height); // End at bottom of plot area
			} else if (position == 'left') {
				select(axisGroup)
					.selectAll('.tick')
					.append('line')
					.attr('class', 'gridline')
					.attr('x1', 0) // Start at axis
					.attr('x2', width); // End at right edge of plot area
			} else if (position == 'right') {
				select(axisGroup)
					.selectAll('.tick')
					.append('line')
					.attr('class', 'gridline')
					.attr('x1', 0) // Start at axis
					.attr('x2', -width); // End at left edge of plot area
			}
			selectAll('.gridline')
				.style('stroke', 'grey')
				.style('stroke-width', '1px')
				.style('stroke-dasharray', '4')
				.style('stroke-opacity', '0.8');
		} else {
			select(axisGroup).selectAll('.gridline').remove(); // Remove gridlines if disabled
		}

		//DO THE LABEL

		// Calculate maximum tick label size
		let maxTickSize = 0;
		select(axisGroup)
			.selectAll('.tick text')
			.each(function () {
				const tickRect = this.getBoundingClientRect();
				if (position === 'left' || position === 'right') {
					maxTickSize = Math.max(maxTickSize, tickRect.width);
				} else {
					maxTickSize = Math.max(maxTickSize, tickRect.height);
				}
			});

		// Remove existing label`
		select(axisGroup).select('.axis-label').remove();
		const nolabelRect = axisGroup.getBoundingClientRect();

		// //add in the label
		let labelElement = select(axisGroup)
			.append('text')
			.attr('class', 'axis-label')
			.style('font-size', `${labelfontsize}px`)
			.style('font-family', 'system-ui, sans-serif')
			.style('text-anchor', 'middle')
			.style('fill', 'black')
			.text(label);

		// Position the label based on max tick size
		if (position == 'bottom') {
			labelElement.attr('x', width / 2).attr('y', tickspace + maxTickSize + labelBuffer);
		} else if (position == 'top') {
			labelElement.attr('x', width / 2).attr('y', -(tickspace + maxTickSize + labelBuffer));
		} else if (position == 'left') {
			labelElement
				.attr('transform', `rotate(-90)`)
				.attr('x', -height / 2)
				.attr('y', -(tickspace + maxTickSize + labelBuffer));
		} else if (position == 'right') {
			labelElement
				.attr('transform', `rotate(90)`)
				.attr('x', height / 2)
				.attr('y', -(tickspace + maxTickSize + labelBuffer));
		}
	});
</script>

{#key (position, height, width, plotPadding, scale, nticks, gridlines)}
	<g bind:this={axisGroup} class={'axis-' + position} />
{/key}
