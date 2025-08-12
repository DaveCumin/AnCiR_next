<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';
	import Hist from '$lib/components/plotBits/Hist.svelte';
	import { scaleLinear } from 'd3-scale';

	let _annotationCounter = 0;

	export class AnnotationClass {
		parentData = $state();
		id;
		name = $state('');
		startTime = $state(1);
		duration = $state(1);
		colour = $state('#0000FFFF'); // Default to blue

		// Derive endTime to avoid circular updates
		endTime = $derived(this.startTime + this.duration);

		path = $derived.by(() => {
			const xScale = scaleLinear()
				.domain([0, this.parentData.periodHrs * this.parentData.doublePlot])
				.range([0, this.parentData.plotwidth]);

			return `M${xScale(this.startTime)} 0 L${xScale(this.endTime)} 0`;
		});

		constructor(parent, dataIN) {
			this.parentData = parent;
			this.id = _annotationCounter++;

			if (dataIN) {
				this.name = dataIN.name || '';
				this.startTime = Number(dataIN.startTime) || 1;
				this.duration = Number(dataIN.endTime - dataIN.startTime) || 1;
				this.colour = dataIN.colour || '#0000FF';
			}
		}

		toJSON() {
			return {
				name: this.name,
				startTime: this.startTime,
				endTime: this.endTime,
				duration: this.duration,
				colour: this.colour
			};
		}

		static fromJSON(json, parent) {
			return new AnnotationClass(parent, {
				name: json.name,
				startTime: json.startTime,
				endTime: json.endTime,
				colour: json.colour
			});
		}
	}
</script>

<script>
	let { annotation, which } = $props();

	function changedStartTime() {
		annotation.startTime = Number(annotation.startTime);
		// endTime updates automatically via $derived
	}

	function changedEndTime(event) {
		const newEndTime = Number(event.target.value) || 0;
		annotation.duration = Math.max(0, newEndTime - annotation.startTime);
	}

	function changedDuration() {
		annotation.duration = Number(annotation.duration);
		// endTime updates automatically via $derived
	}
</script>

{#snippet controls(annotation)}
	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Name:</p>
			<input bind:value={annotation.name} />
		</div>
	</div>
	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Start:</p>
			<NumberWithUnits step="0.1" bind:value={annotation.startTime} onInput={changedStartTime} />
		</div>
		<div class="control-input">
			<p>Duration:</p>
			<NumberWithUnits step="0.1" bind:value={annotation.duration} onInput={changedDuration} />
		</div>
	</div>
	<div class="control-input-horizontal">
		<div class="control-input">
			<p>End:</p>
			<NumberWithUnits step="0.1" value={annotation.endTime} onInput={changedEndTime} />
		</div>

		<div class="control-component-input-icons">
			<ColourPicker bind:value={annotation.colour} />
		</div>
	</div>
{/snippet}

{#snippet plot(annotation)}
	<g
		class="annotations"
		style="transform: translate({annotation.parentData.padding.left}px, {annotation.parentData
			.padding.top}px);"
		onmousemove={(e) => console.log(annotation.name)}
	>
		<Hist
			x={[annotation.startTime, annotation.endTime - 1]}
			y={[50, 50]}
			xscale={scaleLinear()
				.domain([0, annotation.parentData.periodHrs * annotation.parentData.doublePlot])
				.range([0, annotation.parentData.plotwidth])}
			yscale={scaleLinear().domain([0, 100]).range([annotation.parentData.eachplotheight, 0])}
			colour={annotation.colour}
			yoffset={0}
		/>
	</g>
{/snippet}

{#if which === 'plot'}
	{@render plot(annotation)}
{:else if which === 'controls'}
	{@render controls(annotation)}
{/if}
