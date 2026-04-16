<script module>
	import ColourPicker, { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import Icon from '$lib/icons/Icon.svelte';

	export class PointsClass {
		colour = $state(getPaletteColor(0));
		radius = $state(4);
		draw = $state(true);

		constructor(dataIN, parent) {
			this.parentData = parent;
			this.colour =
				dataIN?.colour ?? getPaletteColor(parent.parentPlot.data.length) ?? getPaletteColor(0);
			this.radius = dataIN?.radius ?? 4;
			this.draw = dataIN?.draw ?? true;
		}

		toJSON() {
			return {
				colour: this.colour,
				radius: this.radius,
				draw: this.draw
			};
		}

		static fromJSON(json) {
			return new PointsClass({
				colour: json.colour,
				radius: json.radius,
				draw: json.draw
			});
		}
	}
</script>

<script>
	import { quadtree } from 'd3-quadtree';

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
		yLabel = 'y'
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
		let out = '';
		filteredData.forEach((p) => {
			out += `M${xscale(p.x)} ${yscale(p.y)} m-${pointsData.radius} 0 a${pointsData.radius} ${pointsData.radius} 0 1 0 ${2 * pointsData.radius} 0 a${pointsData.radius} ${pointsData.radius} 0 1 0 -${2 * pointsData.radius} 0 `;
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
		if (!tooltip) return;
		const mouseX = e.offsetX;
		const mouseY = e.offsetY;
		const closest = qt.find(mouseX, mouseY, pointsData.radius * 2);

		if (closest) {
			const colourDot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dataColour || pointsData.colour};margin-right:4px;vertical-align:middle;"></span>`;
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
