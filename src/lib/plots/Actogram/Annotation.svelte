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

	function changedEndTime(newend) {
		const newEndTime = Number(newend) || 0;
		annotation.duration = Math.max(0, newEndTime - annotation.startTime);
		console.log('changedEndTime', newEndTime, annotation.duration);
	}

	function changedDuration() {
		annotation.duration = Number(annotation.duration);
		// endTime updates automatically via $derived
	}

	function handleHover(e) {
		const mouseX = e.offsetX;
		const mouseY = e.offsetY;

		if (annotation.name != '') {
			const event = new CustomEvent('tooltip', {
				detail: {
					visible: true,
					x: mouseX + 10, // Offset to avoid cursor overlap
					y: mouseY + 10,
					content: annotation.name
				},
				bubbles: true
			});

			e.target.dispatchEvent(event);
		}
	}

	function handleMouseLeave(e) {
		e.target.dispatchEvent(
			new CustomEvent('tooltip', {
				detail: { visible: false },
				bubbles: true
			})
		);
	}
</script>

{#snippet controls(annotation)}
	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Name</p>
			<input bind:value={annotation.name} />
		</div>

		<div class="control-color">
			<ColourPicker bind:value={annotation.colour} />
		</div>
	</div>
	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Start</p>
			<NumberWithUnits step="0.1" bind:value={annotation.startTime} onInput={changedStartTime} />
		</div>

		<div class="control-input">
			<p>End</p>
			<NumberWithUnits
				step="0.1"
				value={annotation.endTime}
				onInput={(val) => changedEndTime(val)}
			/>
		</div>

		<div class="control-input">
			<p>Duration</p>
			<NumberWithUnits step="0.1" bind:value={annotation.duration} onInput={changedDuration} />
		</div>
	</div>
{/snippet}

{#snippet plot(annotation)}
	<g
		class="annotations"
		transform="translate({annotation.parentData.padding.left}, {annotation.parentData.padding.top})"
		onmousemove={(e) => {
			handleHover(e);
		}}
		onmouseleave={handleMouseLeave}
	>
		<Hist
			xStart={[annotation.startTime]}
			xEnd={[annotation.endTime]}
			y={[50]}
			xscale={scaleLinear()
				.domain([0, annotation.parentData.periodHrs * annotation.parentData.doublePlot])
				.range([0, annotation.parentData.plotwidth])}
			yscale={scaleLinear().domain([0, 100]).range([annotation.parentData.eachplotheight, 0])}
			colour={annotation.colour}
			yoffset={annotation.parentData.spaceBetween}
		/>
	</g>
{/snippet}

{#if which === 'plot'}
	{@render plot(annotation)}
{:else if which === 'controls'}
	{@render controls(annotation)}
{/if}
