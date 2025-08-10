<script module>
	import { line } from 'd3-shape';
	import ColourPicker, { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import Icon from '$lib/icons/Icon.svelte';

	export class LineClass {
		colour = $state(getPaletteColor(1));
		strokeWidth = $state(3);
		draw = $state(true);

		constructor(dataIN, N) {
			this.parentData = parent;
			console.log(parent);
			this.colour = dataIN?.colour ?? getPaletteColor(N) ?? getPaletteColor(1);
			this.strokeWidth = dataIN?.strokeWidth ?? 3;
			this.draw = dataIN?.draw ?? true;
		}

		toJSON() {
			return {
				colour: this.colour,
				strokeWidth: this.strokeWidth,
				draw: this.draw
			};
		}

		static fromJSON(json) {
			return new LineClass({
				colour: json.colour,
				strokeWidth: json.strokeWidth,
				draw: json.draw
			});
		}
	}
</script>

<script>
	let { lineData = $bindable(), x, y, xscale, yscale, yoffset = 0, xoffset = 0, which } = $props();

	let width = $derived(xscale.range()[1]);
	let height = $derived(yscale.range()[0]);
	let clipKey = $derived(`line-${xoffset}-${yoffset}-${width}-${height}`);

	let theline = $derived.by(() => {
		if (!lineData?.draw || !x || !y) return null;

		const xlims = xscale.domain();
		const [minX, maxX] = [Math.min(...xlims), Math.max(...xlims)];
		const filteredData = x
			.map((xVal, i) => ({ x: xVal, y: y[i] }))
			.filter((d) => d.x >= minX && d.x <= maxX && d.y != null);

		if (filteredData.length < 2) return null;

		const lineGenerator = line()
			.x((d) => xscale(d.x))
			.y((d) => yscale(d.y));

		return lineGenerator(filteredData);
	});
</script>

{#snippet controls(lineData)}
	<div class="control-component">
		<div class="control-component-title">
			<p>Line</p>
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
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Colour</p>
				<ColourPicker bind:value={lineData.colour} />
			</div>
			<div class="control-input">
				<p>Width</p>
				<NumberWithUnits step="0.2" min={0.1} bind:value={lineData.strokeWidth} />
			</div>
		</div>
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
				style="transform: translate({xoffset}px, {yoffset}px);"
			/>
		</g>
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(lineData)}
{:else if which === 'controls'}
	{@render controls(lineData)}
{/if}
