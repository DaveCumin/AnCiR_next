<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';
	import Hist from '$lib/components/plotbits/Hist.svelte';
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
		// Absolute start timestamp (ms). Anchoring to absolute time means the
		// annotation stays at the same real-world moment when the actogram's
		// start time is changed; the rendered hour-offset updates instead.
		startMs = $state(0);
		duration = $state(1);
		colour = $state('#0000FFFF'); // Default to blue

		// Hour offset from the actogram's start — used by the renderer.
		startTime = $derived.by(() => {
			return (this.startMs - (this.parentData?.startTime ?? 0)) / 3600000;
		});
		endTime = $derived(this.startTime + this.duration);

		startDateTime = $derived(this.startMs);
		endDateTime = $derived(this.startMs + this.duration * 3600000);

		// Calculate segments for rendering (handles period wrapping)
		segments = $derived.by(() => {
			const period = this.parentData?.periodHrs ?? 24;
			const segments = [];

			const start = this.startTime;
			const end = this.endTime;

			if (this.duration <= 0) return segments;

			// Calculate which periods this annotation spans
			const startPeriod = Math.floor(start / period);
			const endPeriod = Math.floor(end / period);

			// Create a segment for each period the annotation touches
			for (let p = startPeriod; p <= endPeriod; p++) {
				const periodStart = p * period;
				const periodEnd = (p + 1) * period;

				// Calculate the overlap with this period
				const segmentStart = Math.max(start, periodStart);
				const segmentEnd = Math.min(end, periodEnd);

				if (segmentEnd > segmentStart) {
					// Calculate display position within the period
					const displayStart = segmentStart % period;
					const displayDuration = segmentEnd - segmentStart;

					segments.push({
						period: p,
						startHr: displayStart,
						duration: displayDuration,
						yOffset: p * (this.parentData.eachplotheight + this.parentData.spaceBetween)
					});
				}
			}

			return segments;
		});

		constructor(parent, dataIN) {
			this.parentData = parent;
			this.id = _annotationCounter++;

			const parentStart = parent?.startTime ?? 0;

			if (dataIN) {
				this.name = dataIN.name || 'annotation ' + this.id;
				this.colour = dataIN.colour || '#0000FF';

				if (dataIN.startMs != null) {
					// New format — absolute timestamp in ms.
					this.startMs = Number(dataIN.startMs);
				} else if (dataIN.startTime != null) {
					// Legacy format — hour offset from parent.startTime at save time.
					this.startMs = parentStart + Number(dataIN.startTime) * 3600000;
				} else {
					this.startMs = parentStart + 3600000;
				}

				if (dataIN.duration != null) {
					this.duration = Number(dataIN.duration);
				} else if (dataIN.endTime != null && dataIN.startTime != null) {
					this.duration = Math.max(0, Number(dataIN.endTime) - Number(dataIN.startTime));
				} else {
					this.duration = 1;
				}
			} else {
				this.name = 'annotation ' + this.id;
				this.startMs = parentStart + 3600000;
				this.duration = 1;
				this.colour = '#0000FF';
			}
		}

		toJSON() {
			return {
				name: this.name,
				startMs: this.startMs,
				duration: this.duration,
				// Kept for backward compatibility with any older readers.
				startTime: this.startTime,
				endTime: this.endTime,
				colour: this.colour
			};
		}

		static fromJSON(json, parent) {
			return new AnnotationClass(parent, {
				name: json.name,
				startMs: json.startMs,
				startTime: json.startTime,
				endTime: json.endTime,
				duration: json.duration,
				colour: json.colour
			});
		}
	}
</script>

<script>
	let { annotation, which } = $props();

	function parentStart() {
		return annotation.parentData?.startTime ?? 0;
	}

	function changedStartTime(val) {
		// "Start (hours)" is hour-offset from the actogram's start. Convert
		// back to an absolute ms timestamp before storing.
		annotation.startMs = parentStart() + Number(val) * 3600000;
	}

	function changedEndTime(val) {
		const newEndHrs = Number(val) || 0;
		annotation.duration = Math.max(0, newEndHrs - annotation.startTime);
	}

	function changedDuration() {
		annotation.duration = Number(annotation.duration);
	}

	function changedStartDateTime(dt) {
		annotation.startMs = Number(dt);
	}

	function changedEndDateTime(dt) {
		annotation.duration = Math.max(0, (Number(dt) - annotation.startMs) / 3600000);
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
			<NumberWithUnits step="0.1" value={annotation.startTime} onInput={changedStartTime} />
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
			<DateTimeHrs value={annotation.startDateTime} onChange={changedStartDateTime} />
		</div>

		<div class="control-input">
			<p>End Date/Time</p>
			<DateTimeHrs value={annotation.endDateTime} onChange={changedEndDateTime} />
		</div>
	</div>
{/snippet}

{#snippet plot(annotation)}
	{#each annotation.segments as segment}
		<g
			class="annotations"
			transform="translate({annotation.parentData.padding.left}, {annotation.parentData.padding
				.top + segment.yOffset})"
			onmousemove={(e) => {
				handleHover(e);
			}}
			onmouseleave={handleMouseLeave}
		>
			<Hist
				xStart={[segment.startHr]}
				xEnd={[segment.startHr + segment.duration]}
				y={[50]}
				xscale={scaleLinear()
					.domain([0, annotation.parentData.periodHrs * annotation.parentData.doublePlot])
					.range([0, annotation.parentData.plotwidth])}
				yscale={scaleLinear().domain([0, 100]).range([annotation.parentData.eachplotheight, 0])}
				colour={annotation.colour}
				yoffset={annotation.parentData.spaceBetween}
			/>
		</g>
	{/each}
{/snippet}

{#if which === 'plot'}
	{@render plot(annotation)}
{:else if which === 'controls'}
	{@render controls(annotation)}
{/if}
