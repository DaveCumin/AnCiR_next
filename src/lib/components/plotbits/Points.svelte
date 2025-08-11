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
				dataIN?.colour ??
				getPaletteColor(this.parentData.parentPlot.data.length - 1) ??
				getPaletteColor(0);
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
		which
	} = $props();

	let beforeIdx = $derived.by(() => {
		//find the x point before the limit
		let xlims = xscale.domain();
		for (let i = 1; i < x.length; i++) {
			if (x[i] >= Math.min(xlims[0], xlims[1])) {
				return i - 1;
			}
		}
		return 0;
	});

	let afterIdx = $derived.by(() => {
		//find the x point after the limit
		let xlims = xscale.domain();
		for (let i = x.length - 2; i >= 0; i--) {
			if (x[i] <= Math.max(xlims[0], xlims[1])) {
				return i + 1;
			}
		}
		return x.length - 1;
	});

	//MAKE THE POINTS PATH
	let points = $derived.by(() => {
		let out = '';
		for (let p = beforeIdx; p <= afterIdx; p++) {
			//only include the point if it's within the y limits
			if (y[p] >= yscale.domain()[0] && y[p] <= yscale.domain()[1] && x[p] && y[p]) {
				out += `M${xscale(x[p])} ${yscale(y[p])} m-${pointsData.radius} 0 a${pointsData.radius} ${pointsData.radius} 0 1 0 ${2 * pointsData.radius} 0 a${pointsData.radius} ${pointsData.radius} 0 1 0 -${2 * pointsData.radius} 0 `;
			}
		}

		return out;
	});

	let qt = $derived.by(() => {
		if (!tooltip) return null;
		const tree = quadtree()
			.x((d) => xscale(d.x) + xoffset)
			.y((d) => yscale(d.y) + yoffset)
			.addAll(
				x
					.map((xVal, i) => ({
						x: xVal,
						y: y[i],
						index: i
					}))
					.filter(
						(d) =>
							d.index >= beforeIdx &&
							d.index <= afterIdx &&
							d.y >= yscale.domain()[0] &&
							d.y <= yscale.domain()[1]
					)
			);
		return tree;
	});
	function handleHover(e) {
		if (!tooltip) return;
		const mouseX = e.offsetX;
		const mouseY = e.offsetY;
		const closest = qt.find(mouseX, mouseY, pointsData.radius * 2);
		if (closest && closest.index >= 0) {
			let content = `(${x[closest.index].toFixed(2)}, ${y[closest.index].toFixed(2)})`;
			if (xtype == 'time') {
				content = `(${new Date(x[closest.index]).toLocaleString()}, ${y[closest.index].toFixed(2)})`;
			}
			const event = new CustomEvent('tooltip', {
				detail: {
					visible: true,
					x: mouseX + 10, // Offset to avoid cursor overlap
					y: mouseY + 10,
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
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Colour</p>
				<ColourPicker bind:value={pointsData.colour} />
			</div>
			<div class="control-input">
				<p>Radius</p>
				<NumberWithUnits step="0.2" min={0.1} bind:value={pointsData.radius} />
			</div>
		</div>
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
