<script module>
	import { line, curveBundle } from 'd3-shape';
	import ColourPicker, { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { isValidStroke } from '$lib/components/plotbits/helpers/misc.js';

	export class LineClass {
		colour = $state(getPaletteColor(0));
		strokeWidth = $state(3);
		stroke = $state('solid');
		draw = $state(true);

		constructor(dataIN, parent) {
			this.parentData = parent;
			this.colour =
				dataIN?.colour ?? getPaletteColor(parent.parentPlot.data.length) ?? getPaletteColor(0);
			this.strokeWidth = dataIN?.strokeWidth ?? 3;
			this.stroke = dataIN?.stroke ?? 'solid';
			this.draw = dataIN?.draw ?? true;
		}

		toJSON() {
			return {
				colour: this.colour,
				strokeWidth: this.strokeWidth,
				stroke: this.stroke,
				draw: this.draw
			};
		}

		static fromJSON(json) {
			return new LineClass({
				colour: json.colour,
				strokeWidth: json.strokeWidth,
				stroke: json.stroke,
				draw: json.draw
			});
		}
	}
</script>

<script>
	import { quadtree } from 'd3-quadtree';

	let {
		lineData = $bindable(),
		x,
		y,
		xscale,
		yscale,
		yoffset = 0,
		xoffset = 0,
		which,
		title = 'Line',
		tooltip = false,
		xtype = 'number',
		dataLabel = '',
		dataColour = '',
		xLabel = 'x',
		yLabel = 'y'
	} = $props();
	let width = $derived(xscale.range()[1]);
	let height = $derived(yscale.range()[0]);
	let clipKey = $derived(`line-${xoffset}-${yoffset}-${width}-${height}`);

	let qt;

	let theline = $derived.by(() => {
		if (!lineData?.draw || !x || !y) return null;

		//filter out the NaNs and data outside the plot limits
		const xlims = xscale.domain();
		const [minX, maxX] = [Math.min(...xlims), Math.max(...xlims)];
		const ylims = yscale.domain();
		const [minY, maxY] = [Math.min(...ylims), Math.max(...ylims)];

		const filteredData = x
			.map((xVal, i) => ({ x: xVal, y: y[i] }))
			.filter(
				(d) =>
					d.x >= minX && d.x <= maxX && d.y != null && d.x != null && !isNaN(d.y) && !isNaN(d.x)
			);

		//No Line if only 1 or fewer points
		if (filteredData.length < 2) return null;

		let lineGenerator = line()
			.x((d) => xscale(d.x))
			.y((d) => yscale(d.y));

		//Can add more line options (curves) here later
		// eg:
		// lineGenerator = lineGenerator.curve(curveBundle.beta(0.5));

		//Set up the quadtree for hovering
		if (tooltip) {
			qt = quadtree()
				.x((d) => xscale(d.x) + xoffset)
				.y((d) => yscale(d.y) + yoffset)
				.addAll(filteredData);
		}

		return lineGenerator(filteredData);
	});

	//HELPER FUNCTION
	function safeFormat(value, dp, type) {
		//if time then return the time
		if (type === 'time') {
			try {
				return new Date(value).toLocaleString(); // works even if value is invalid date
			} catch (e) {
				return value;
			}
		}

		//else try as a number
		try {
			return value.toFixed(dp); // will throw if value isn't a number
		} catch (e) {
			//otherwise just return the value as is
			return value;
		}
	}

	function handleHover(e) {
		const dp = 3;
		if (!tooltip || !qt) return;
		const mouseX = e.offsetX;
		const mouseY = e.offsetY;
		const closest = qt.find(mouseX, mouseY);

		if (closest) {
			const colourDot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dataColour || lineData.colour};margin-right:4px;vertical-align:middle;"></span>`;
			const name = dataLabel ? `${colourDot}<strong>${dataLabel}</strong><br/>` : '';
			const xLbl = xLabel || 'x';
			const yLbl = yLabel || 'y';
			const content = `${name}<span style="opacity:0.7">${xLbl}:</span> ${safeFormat(closest.x, dp, xtype)}<br/><span style="opacity:0.7">${yLbl}:</span> ${safeFormat(closest.y, dp)}`;

			//make sure the tooltip stays 'in bounds'
			const srcRect = e.srcElement.getBoundingClientRect();
			const xPos = mouseX + 180 > srcRect.width ? mouseX - 190 : mouseX + 10;
			const yPos = mouseY < 20 ? mouseY + 40 : mouseY + 10;
			const event = new CustomEvent('tooltip', {
				detail: {
					visible: true,
					x: xPos,
					y: yPos,
					content: content
				},
				bubbles: true
			});
			e.target.dispatchEvent(event);
		} else {
			e.target.dispatchEvent(
				new CustomEvent('tooltip', {
					detail: { visible: false },
					bubbles: true
				})
			);
		}
	}

	function handleMouseLeave(e) {
		if (!tooltip) return;
		e.target.dispatchEvent(
			new CustomEvent('tooltip', {
				detail: { visible: false },
				bubbles: true
			})
		);
	}
</script>

{#snippet controls(lineData)}
	<div class="control-component">
		<div class="control-component-title">
			<p>{title}</p>
			<button
				class="icon"
				onclick={(e) => {
					e.stopPropagation();
					lineData.draw = !lineData.draw;
				}}
			>
				{#if !lineData.draw}
					<Icon name="eye-slash" width={16} height={16} />
				{:else}
					<Icon name="eye" width={16} height={16} className="visible" />
				{/if}
			</button>
		</div>
		{#if lineData.draw}
			<div class="control-input-horizontal">
				<div class="control-input" style="max-width: 1.5rem;">
					<p style="color:{'white'};">Col</p>
					<ColourPicker bind:value={lineData.colour} />
				</div>
				<div class="control-input">
					<p>Width</p>
					<NumberWithUnits step="0.2" min={0.1} bind:value={lineData.strokeWidth} />
				</div>
				<div class="control-input">
					<p>Stroke</p>
					<div style="border: {lineData.stroke === -1 ? '1' : '0'}px solid red;">
						<AttributeSelect
							onChange={(value) => {
								if (isValidStroke(value)) {
									lineData.stroke = value;
								} else {
									lineData.stroke = -1;
								}
							}}
							options={['solid', '5, 5', '2, 2', '5, 2']}
							optionsDisplay={['Solid', 'Dashed', 'Dotted', 'Dashed & Dotted']}
							other={true}
							placeholder={'eg 5, 5'}
						/>
					</div>
				</div>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet plot(lineData)}
	{#if theline && lineData?.draw}
		<clipPath id={clipKey}>
			<rect x={xoffset} y={yoffset} {width} {height} />
		</clipPath>
		<g clip-path="url(#{clipKey})">
			<path
				d={theline}
				fill="none"
				stroke={lineData.colour}
				stroke-width={lineData.strokeWidth}
				style="transform: translate({xoffset}px, {yoffset}px); stroke-dasharray: {lineData.stroke}; pointer-events: visibleStroke;"
				onmousemove={(e) => {
					handleHover(e);
				}}
				onmouseleave={handleMouseLeave}
			/>
		</g>
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(lineData)}
{:else if which === 'controls'}
	{@render controls(lineData)}
{/if}
