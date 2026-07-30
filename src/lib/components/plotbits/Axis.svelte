<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';

	export class AxisClass {
		// UI metadata for the multi-select shared-options panel (sharedControls.js).
		static descriptors = {
			label: { label: 'Label' },
			gridlines: { label: 'Gridlines' },
			nticks: { label: 'Ticks' },
			manualTicks: { skip: true }
		};
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

		/**
		 * Build an axis from a saved axis object, falling back to per-plot defaults.
		 * Every plot's constructor did this by hand for each of its axes:
		 *   new AxisClass({ label: saved?.label ?? '<default>',
		 *                   gridlines: saved?.gridlines ?? <default>,
		 *                   nticks: saved?.nticks ?? 5 })
		 * @param {any} saved - e.g. dataIN?.xAxis (may be undefined)
		 * @param {{label?: string, gridlines?: boolean}} [defaults]
		 */
		static withDefaults(saved, { label = '', gridlines = true } = {}) {
			return new AxisClass({
				label: saved?.label ?? label,
				gridlines: saved?.gridlines ?? gridlines,
				nticks: saved?.nticks ?? 5
			});
		}
	}
</script>

<script>
	// @ts-nocheck
	import { resolveStyle } from '$lib/plots/figureStyle.js';
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
		tickFormat = null, // optional custom tick formatter, e.g. (d) => String(d)
		which,
		title = 'Axis',
		// This figure's style (core/Plot.svelte -> Plot.style), passed by the plot that
		// renders this axis. A PROP rather than context on purpose: Axis is rendered from
		// four different host components, and a facet child carries its OWN style, so
		// "nearest ancestor" is not the same thing as "the figure this axis belongs to".
		// Absent in the controls branch and in tests, where the defaults apply.
		figureStyle = null
	} = $props();

	let axisGroup;

	let ticklength = 6;
	let tickspace = 4; // space between the ticks and the numbers
	let labelBuffer = 16; // Additional spacing between largest tick label and axis label

	// resolveStyle tolerates null and returns the defaults, so an axis with no style
	// still renders rather than coming out unstyled.
	const resolved = $derived(resolveStyle(figureStyle));
	const tickfontsize = $derived(resolved.sizes.tick);
	const labelfontsize = $derived(resolved.sizes.axisLabel);

	// Inner ticks only, applied in one place for all four positions.
	//
	// d3's `tickSize` sets the OUTER tick size as well as the inner one, and the
	// outer size is what makes the domain path turn a stub in at each end:
	// a bottom axis rendered `M0,6V0H446V6`, i.e. a 6px vertical at x=0 and
	// another at x=446. Those two stubs read as ticks but belong to the domain
	// line, so no tick-scale setting removes them. It shows up worst on a
	// categorical axis, where the real ticks sit one per category (`manualTicks`)
	// and the end stubs mark nothing at all.
	//
	// `tickSizeOuter(0)` leaves a plain domain line with ticks only where there
	// is something to tick. Kept as a single helper because the previous
	// duplicate-per-branch version is exactly why the outer size went unnoticed.
	const configureTicks = (a) =>
		a.tickSizeInner(ticklength).tickSizeOuter(0).tickPadding(tickspace);

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
			axis = configureTicks(axis);
			if (tickFormat) axis = axis.tickFormat(tickFormat);
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
			axis = configureTicks(axis);
			if (tickFormat) axis = axis.tickFormat(tickFormat);
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
			axis = configureTicks(axis);
			if (tickFormat) axis = axis.tickFormat(tickFormat);
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
			axis = configureTicks(axis);
			if (tickFormat) axis = axis.tickFormat(tickFormat);
			select(axisGroup)
				.call(axis)
				.style('transform', `translate(${width + plotPadding.left}px, ${plotPadding.top}px)`);
		}
		if (!axis) return; // position didn't match any known value

		select(axisGroup)
			// .transition(t)
			.call(axis)
			.style('font-size', `${tickfontsize}px`)
			.style('font-family', resolved.fontFamily);

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
			.style('font-family', resolved.fontFamily)
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
			<ControlInput label="Label">
				<input bind:value={axisData.label} />
			</ControlInput>
			<ControlInput label="N Ticks">
				<NumberWithUnits step="1" min="1" bind:value={axisData.nticks} />
			</ControlInput>
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
