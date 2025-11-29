<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';
	import Hist from '$lib/components/plotBits/Hist.svelte';
	import { scaleLinear } from 'd3-scale';
	import { getPlotById } from '$lib/core/Plot.svelte';
	import DateTimeHrs from '$lib/components/inputs/DateTimeHrs.svelte';

	let _annotationCounter = 0;

	export function deleteAnnotation(plotid, annotationid) {
		getPlotById(plotid).plot.annotations = getPlotById(plotid).plot.annotations.filter(
			(ann) => ann.id !== annotationid
		);
	}

	export class AnnotationClass {
		parentData = $state();
		id;
		name = $state('');
		startTime = $state(1);
		duration = $state(1);
		colour = $state('#0000FFFF'); // Default to blue

		// Derive endTime to avoid circular updates
		endTime = $derived(this.startTime + this.duration);

		// Convert hour offset to milliseconds timestamp
		startDateTime = $derived.by(() => {
			return (this.parentData?.startTime ?? 0) + this.startTime * 3600000;
		});

		endDateTime = $derived.by(() => {
			return (this.parentData?.startTime ?? 0) + this.endTime * 3600000;
		});

		constructor(parent, dataIN) {
			this.parentData = parent;
			this.id = _annotationCounter++;

			if (dataIN) {
				this.name = dataIN.name || 'annotation ' + this.id;
				this.startTime = Number(dataIN.startTime) || 1;
				this.duration = Number(dataIN.endTime - dataIN.startTime) || 1;
				this.colour = dataIN.colour || '#0000FF';
			} else {
				this.name = 'annotation ' + this.id;
				this.startTime = 1;
				this.duration = 1;
				this.colour = '#0000FF';
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
		annotation.startDateTime = annotation.parentData.startTime + annotation.startTime * 3600000;
	}

	function changedEndTime(newend) {
		const newEndTime = Number(newend) || 0;
		annotation.duration = Math.max(0, newEndTime - annotation.startTime);
		annotation.endDateTime = annotation.parentData.startTime + annotation.endTime * 3600000;
	}

	function changedDuration() {
		annotation.duration = Number(annotation.duration);
		annotation.endDateTime = annotation.parentData.startTime + annotation.endTime * 3600000;
	}

	function changedStartDateTime(dt) {
		annotation.startTime = (dt - annotation.parentData.startTime) / 3600000;
		annotation.endDateTime = annotation.parentData.startTime + annotation.endTime * 3600000;
	}

	function changedEndDateTime(dt) {
		const newEndTimeHrs = (dt - annotation.parentData.startTime) / 3600000;
		annotation.duration = Math.max(0, newEndTimeHrs - annotation.startTime);
	}

	function handleHover(e) {
		const mouseX = e.offsetX;
		const mouseY = e.offsetY;

		if (annotation.name != '') {
			const event = new CustomEvent('tooltip', {
				detail: {
					visible: true,
					x: mouseX + 10,
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
	<div
		class="control-component-title-icons"
		style="
    margin-bottom: -1rem;
    z-index: 9999;
    margin-top: 0.25rem;
"
	>
		<button
			class="icon"
			onclick={() => deleteAnnotation(annotation.parentData.parentBox.id, annotation.id)}
		>
			<Icon name="minus" width={16} height={16} className="menu-icon" />
		</button>
	</div>
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
			<p>Start (hours)</p>
			<NumberWithUnits step="0.1" bind:value={annotation.startTime} onInput={changedStartTime} />
		</div>

		<div class="control-input">
			<p>End (hours)</p>
			<NumberWithUnits
				step="0.1"
				value={annotation.endTime}
				onInput={(val) => changedEndTime(val)}
			/>
		</div>

		<div class="control-input">
			<p>Duration</p>
			<NumberWithUnits
				min="0.1"
				step="0.1"
				bind:value={annotation.duration}
				onInput={changedDuration}
			/>
		</div>
	</div>
	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Start Date/Time</p>
			<DateTimeHrs bind:value={annotation.startDateTime} onChange={changedStartDateTime} />
		</div>

		<div class="control-input">
			<p>End Date/Time</p>
			<DateTimeHrs bind:value={annotation.endDateTime} onChange={changedEndDateTime} />
		</div>
	</div>
{/snippet}

{#snippet plot(annotation)}
	{#if annotation.duration > 0}
		{@const outDay = Math.floor(annotation.startTime / annotation.parentData.periodHrs) + 1}
		{@const outHr = annotation.startTime % annotation.parentData.periodHrs}
		{@const yOffset =
			(outDay - 1) * (annotation.parentData.eachplotheight + annotation.parentData.spaceBetween)}
		<g
			class="annotations"
			transform="translate({annotation.parentData.padding.left}, {annotation.parentData.padding
				.top + yOffset})"
			onmousemove={(e) => {
				handleHover(e);
			}}
			onmouseleave={handleMouseLeave}
		>
			<Hist
				xStart={[outHr]}
				xEnd={[outHr + annotation.duration]}
				y={[50]}
				xscale={scaleLinear()
					.domain([0, annotation.parentData.periodHrs * annotation.parentData.doublePlot])
					.range([0, annotation.parentData.plotwidth])}
				yscale={scaleLinear().domain([0, 100]).range([annotation.parentData.eachplotheight, 0])}
				colour={annotation.colour}
				yoffset={annotation.parentData.spaceBetween}
			/>
		</g>
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(annotation)}
{:else if which === 'controls'}
	{@render controls(annotation)}
{/if}
