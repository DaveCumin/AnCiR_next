<script module>
	import ColourPicker, { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { POINT_SHAPES, POINT_SHAPE_LABELS, getPointPath } from './pointShapes.js';

	export class PointsClass {
		colour = $state(getPaletteColor(0));
		radius = $state(4);
		shape = $state('circle');
		draw = $state(true);

		constructor(dataIN, parent) {
			this.parentData = parent;
			this.colour =
				dataIN?.colour ?? getPaletteColor(parent.parentPlot.data.length) ?? getPaletteColor(0);
			this.radius = dataIN?.radius ?? 4;
			this.shape = POINT_SHAPES.includes(dataIN?.shape) ? dataIN.shape : 'circle';
			this.draw = dataIN?.draw ?? true;
		}

		toJSON() {
			return {
				colour: this.colour,
				radius: this.radius,
				shape: this.shape,
				draw: this.draw
			};
		}

		static fromJSON(json) {
			return new PointsClass({
				colour: json.colour,
				radius: json.radius,
				shape: json.shape,
				draw: json.draw
			});
		}
	}
</script>

<script>
	import { quadtree } from 'd3-quadtree';
	import {
		buildAggregatedContent,
		computeTooltipPosition,
		dispatchTooltip,
		hideTooltip
	} from '$lib/components/plotbits/helpers/tooltipHelpers.js';

	let {
		pointsData = $bindable(),
		x,
		y,
		xscale,
		yscale,
		yoffset,
		xoffset,
		tooltip = false,
		xtype = 'number',
		which,
		dataLabel = '',
		dataColour = '',
		xLabel = 'x',
		yLabel = 'y',
		// When provided, the tooltip aggregates and displays the y value at the
		// hovered x for every sibling series. Shape: [{label, colour, findYAt(x)}]
		siblings = null
	} = $props();

	let qt;

	//MAKE THE POINTS PATH
	let points = $derived.by(() => {
		//filter out the NaNs and data outside the plot limits
		const xlims = xscale.domain();
		const [minX, maxX] = [Math.min(...xlims), Math.max(...xlims)];
		const ylims = yscale.domain();
		const [minY, maxY] = [Math.min(...ylims), Math.max(...ylims)];

		const filteredData = x
			.map((xVal, i) => ({ x: xVal, y: y[i] }))
			.filter(
				(d) =>
					d.x >= minX &&
					d.x <= maxX &&
					d.y >= minY &&
					d.y <= maxY &&
					d.y != null &&
					d.x != null &&
					!isNaN(d.y) &&
					!isNaN(d.x)
			);

		if (!pointsData?.draw || !x || !y) return null;
		const shape = pointsData.shape || 'circle';
		let out = '';
		filteredData.forEach((p) => {
			out += getPointPath(shape, xscale(p.x), yscale(p.y), pointsData.radius) + ' ';
		});

		//Set up the quadtree for hovering
		if (tooltip) {
			qt = quadtree()
				.x((d) => xscale(d.x) + xoffset)
				.y((d) => yscale(d.y) + yoffset)
				.addAll(filteredData);
		}

		return out;
	});

	function handleHover(e) {
		if (!tooltip || !qt) return;
		const mouseX = e.offsetX;
		const mouseY = e.offsetY;
		const closest = qt.find(mouseX, mouseY, pointsData.radius * 2);

		if (!closest) {
			hideTooltip(e.target);
			return;
		}

		const series = siblings
			? siblings.map((s) => ({
					label: s.label,
					colour: s.colour,
					yValue: s.findYAt ? s.findYAt(closest.x) : null
				}))
			: [
					{
						label: dataLabel,
						colour: dataColour || pointsData.colour,
						yValue: closest.y,
						yLabel
					}
				];

		const content = buildAggregatedContent({
			xLabel: xLabel || 'x',
			xValue: closest.x,
			xtype,
			series
		});

		const srcRect = e.srcElement.getBoundingClientRect();
		const { x: xPos, y: yPos } = computeTooltipPosition(mouseX, mouseY, srcRect);
		dispatchTooltip(e.target, { visible: true, x: xPos, y: yPos, content });
	}

	function handleMouseLeave(e) {
		if (!tooltip) return;
		hideTooltip(e.target);
	}
</script>

{#snippet controls(pointsData)}
	<div class="control-component">
		<div class="control-component-title">
			<p>Points</p>
			<button
				class="icon"
				onclick={(e) => {
					e.stopPropagation();
					pointsData.draw = !pointsData.draw;
				}}
			>
				{#if !pointsData.draw}
					<Icon name="eye-slash" width={16} height={16} />
				{:else}
					<Icon name="eye" width={16} height={16} className="visible" />
				{/if}
			</button>
		</div>
		{#if pointsData.draw}
			<div class="control-input-horizontal">
				<div class="control-input" style="max-width: 1.5rem;">
					<p style="color:{'white'};">Col</p>

					<ColourPicker bind:value={pointsData.colour} />
				</div>
				<div class="control-input">
					<p>Radius</p>
					<NumberWithUnits step="0.2" min={0.1} bind:value={pointsData.radius} />
				</div>
			</div>
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Shape</p>
					<AttributeSelect
						bind:value={pointsData.shape}
						options={POINT_SHAPES}
						optionsDisplay={POINT_SHAPE_LABELS}
					/>
				</div>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet plot(pointsData)}
	{#if pointsData?.draw}
		<path
			d={points}
			fill={pointsData.colour}
			stroke="none"
			style={`transform: translate( ${xoffset}px, ${yoffset}px );`}
			onmousemove={(e) => {
				handleHover(e);
			}}
			onmouseleave={handleMouseLeave}
		/>
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(pointsData)}
{:else if which === 'controls'}
	{@render controls(pointsData)}
{/if}
