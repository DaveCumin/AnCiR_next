<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	export class AxisClass {
		label = $state('');
		gridlines = $state(true);
		nticks = $state(5);
		manualTicks = $state(null);

		constructor(dataIN, parent) {
			this.label = dataIN?.label ?? '';
			this.gridlines = dataIN?.gridlines ?? true;
			this.nticks = dataIN?.nticks ?? 5;
			this.manualTicks = dataIN?.manualTicks ?? null;
		}

		toJSON() {
			return {
				label: this.label,
				gridlines: this.gridlines,
				nticks: this.nticks,
				manualTicks: this.manualTicks
			};
		}

		static fromJSON(json) {
			return new AxisClass({
				label: json?.label ?? '',
				gridlines: json?.gridlines ?? true,
				nticks: json?.nticks ?? 5,
				manualTicks: json?.manualTicks ?? null
			});
		}
	}
</script>

<script>
	// @ts-nocheck
	import { select, selectAll } from 'd3-selection';
	import { axisBottom, axisLeft, axisTop, axisRight } from 'd3-axis';

	import { timeFormat } from 'd3-time-format';
	import { scaleTime } from 'd3-scale';
	import { transition } from 'd3-transition';

	let {
		axisData = $bindable(),
		height, //height of the plot
		width, //width of the plot
		plotPadding = { top: 0, right: 0, bottom: 0, left: 0 },
		position, //where the axis should be (x or y etc)
		scale, //the d3s scale to use
		which,
		title = 'Axis'
	} = $props();

	let axisGroup;

	let ticklength = 6;
	let tickspace = 4; // space between the ticks and the numbers
	let tickfontsize = 15;
	let labelfontsize = 16;
	let labelBuffer = 16; // Additional spacing between largest tick label and axis label

	$effect(() => {
		height;
		width;
		plotPadding;

		if (!scale) return; // scale not ready yet — avoid rendering a broken axis

		//Set a transition
		// const t = transition().duration(10); //Doesn't look good without a similar transition for the line/points/etc... hard to do.

		// DO THE SCALES
		let axis;
		if (position == 'bottom') {
			if (axisData.manualTicks) {
				axis = axisBottom(scale).tickValues(axisData.manualTicks);
			} else {
				axis = axisBottom(scale).ticks(axisData.nticks);
			}
			axis = axis.tickSize(ticklength).tickPadding(tickspace);
			select(axisGroup)
				.call(axis)
				.style('transform', `translate(${plotPadding.left}px, ${height + plotPadding.top}px)`);
		}
		if (position == 'top') {
			if (axisData.manualTicks) {
				axis = axisTop(scale).tickValues(axisData.manualTicks);
			} else {
				axis = axisTop(scale).ticks(axisData.nticks);
			}
			axis = axis.tickSize(ticklength).tickPadding(tickspace);
			select(axisGroup)
				.call(axis)
				.style('transform', `translate(${plotPadding.left}px, ${plotPadding.top}px)`);
		}
		if (position == 'left') {
			if (axisData.manualTicks) {
				axis = axisLeft(scale).tickValues(axisData.manualTicks);
			} else {
				axis = axisLeft(scale).ticks(axisData.nticks);
			}
			axis = axis.tickSize(ticklength).tickPadding(tickspace);
			select(axisGroup)
				.call(axis)
				.style('transform', `translate(${plotPadding.left}px, ${plotPadding.top}px)`);
		}
		if (position == 'right') {
			if (axisData.manualTicks) {
				axis = axisRight(scale).tickValues(axisData.manualTicks);
			} else {
				axis = axisRight(scale).ticks(axisData.nticks);
			}
			axis = axis.tickSize(ticklength).tickPadding(tickspace);
			select(axisGroup)
				.call(axis)
				.style('transform', `translate(${width + plotPadding.left}px, ${plotPadding.top}px)`);
		}
		if (!axis) return; // position didn't match any known value

		select(axisGroup)
			// .transition(t)
			.call(axis)
			.style('font-size', `${tickfontsize}px`)
			.style('font-family', 'system-ui, sans-serif');

		// DO GRIDLINES
		if (axisData.gridlines) {
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
			.text(axisData.label);

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

{#snippet controls(axisData)}
	<div class="control-component">
		<div class="control-component-title">
			<p>{title}</p>
		</div>
		<div class="control-input-vertical">
			<div class="control-input">
				<p>Label</p>
				<input bind:value={axisData.label} />
			</div>
			<div class="control-input">
				<p>N Ticks</p>
				<NumberWithUnits step="1" min="1" bind:value={axisData.nticks} />
			</div>
		</div>
		<div class="control-input-vertical">
			<div class="control-input-checkbox">
				<input type="checkbox" bind:checked={axisData.gridlines} />
				<p>Grid</p>
			</div>
		</div>
	</div>
{/snippet}

{#snippet plot(axisData)}
	{#key (position, height, width, plotPadding, scale, axisData.nticks, axisData.gridlines)}
		<g bind:this={axisGroup} class={'axis-' + position} />
	{/key}
{/snippet}

{#if which === 'plot'}
	{@render plot(axisData)}
{:else if which === 'controls'}
	{@render controls(axisData)}
{/if}
