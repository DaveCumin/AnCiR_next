<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import AxisLabelInput from '$lib/components/plotbits/AxisLabelInput.svelte';

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

		constructor(dataIN) {
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
				nticks: saved?.nticks ?? 5,
				manualTicks: saved?.manualTicks ?? null
			});
		}
	}
</script>

<script>
	// @ts-nocheck
	import { resolveStyle } from '$lib/plots/figureStyle.js';
	import { axisChrome } from '$lib/components/plotbits/axisLayout.js';
	import {
		parseTickList,
		formatTickList,
		manualTicksToDraw
	} from '$lib/components/plotbits/manualTicks.js';
	import { untrack } from 'svelte';
	import { commitAxisEdit } from '$lib/plots/axisEdits.js';
	import { select, selectAll } from 'd3-selection';
	import { axisBottom, axisLeft, axisTop, axisRight } from 'd3-axis';

	// Side-effect import: d3-transition augments d3-selection's prototype with
	// .transition(). Kept (unbound) so the commented-out transition code below can
	// be re-enabled without a missing-method surprise.
	import 'd3-transition';

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
		// four different host components, and a facet panel reads its generator's style
		// through its own parentBox, so "nearest ancestor" is not the same thing as "the
		// figure this axis belongs to".
		// Absent in the controls branch and in tests, where the defaults apply.
		figureStyle = null,
		// What kind of values the axis shows: 'numeric' offers Auto/Manual ticks; 'time' keeps
		// Auto (manual ticks on a time axis are not built yet); 'categorical' hides the choice,
		// because the plot places one tick per category itself. In the plot branch a stored
		// manual list is drawn only when this is 'numeric'.
		tickMode = 'numeric',
		// The title drawn while the stored label is empty, and the Label box's placeholder. A
		// plot whose natural title depends on its content (the periodogram names its statistic
		// per method) passes it, so an empty label tracks the content and a typed one wins.
		defaultLabel = '',
		// Controls panel only: buttons for the section title (a reset), and the plot's own
		// controls for this axis (limits, log scale, step), rendered in the SAME section so an
		// axis has one section, not an "Axis" and an "Axis controls" pair (UI-22).
		tools = null,
		children = null
	} = $props();

	// The Manual ticks text box. Kept as typed (so "0, 6," is not rewritten mid-entry) and
	// re-read from the axis whenever the stored list changes elsewhere (undo, load, AI edit).
	let tickText = $state(untrack(() => formatTickList(axisData?.manualTicks)));
	const tickParse = $derived(parseTickList(tickText));
	const sameList = (a, b) =>
		Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
	$effect(() => {
		const stored = axisData?.manualTicks;
		if (!Array.isArray(stored)) return;
		const typed = untrack(() => tickParse.values);
		if (!sameList(stored, typed)) tickText = formatTickList(stored);
	});

	// Every control edit is committed through commitAxisEdit (plots/axisEdits.js): one undo step
	// and an unsaved change. The label box is AxisLabelInput. The tick values box previews what is
	// typed on the plot as it is typed (a plain write), then on Enter or blur puts the list from
	// before the edit back and commits the new one, so the step undoes to exactly what was
	// stored. Escape puts it back and commits nothing.
	let ticksAtFocus = null; // the stored manual ticks when the box took focus
	function beginTicksEdit() {
		ticksAtFocus = Array.isArray(axisData.manualTicks) ? [...axisData.manualTicks] : null;
	}
	function commitTicksEdit(text) {
		if (ticksAtFocus) axisData.manualTicks = ticksAtFocus;
		ticksAtFocus = null;
		commitAxisEdit(axisData, 'manualTicks', parseTickList(text).values);
	}
	function ticksKeydown(e) {
		if (e.key === 'Enter') {
			e.currentTarget.blur(); // commits through change
			return;
		}
		if (e.key !== 'Escape' || !ticksAtFocus) return;
		e.preventDefault();
		e.stopPropagation(); // the edit only, not whatever Escape does for the page
		axisData.manualTicks = ticksAtFocus;
		tickText = formatTickList(ticksAtFocus);
		e.currentTarget.value = tickText;
		ticksAtFocus = null;
		e.currentTarget.blur();
	}

	// The tick count: what is typed (or a spinner click) previews on the plot; the change event
	// (Enter, blur, each spinner click) puts the count from before back and commits the new
	// one, coalesced so a run of spinner clicks is one step. Escape puts it back.
	let nticksAtFocus = null;
	function beginNticksEdit() {
		nticksAtFocus = axisData.nticks;
	}
	function commitNticksEdit() {
		const next = axisData.nticks;
		if (nticksAtFocus != null) axisData.nticks = nticksAtFocus;
		commitAxisEdit(axisData, 'nticks', next, { coalesce: true });
		nticksAtFocus = next;
	}
	function nticksKeydown(e) {
		if (e.key === 'Enter') {
			e.target.blur?.(); // commits through change
			return;
		}
		if (e.key !== 'Escape' || nticksAtFocus == null) return;
		e.preventDefault();
		e.stopPropagation(); // the edit only, not whatever Escape does for the page
		axisData.nticks = nticksAtFocus;
		nticksAtFocus = null;
		e.target.blur?.();
	}

	function setTickMode(mode) {
		commitAxisEdit(axisData, 'manualTicks', mode === 'manual' ? tickParse.values : null);
	}
	function onTickInput(text) {
		tickText = text;
		axisData.manualTicks = parseTickList(text).values; // preview; committed on change
	}

	// $state so the effect below re-runs once bind:this hands over the new <g> that the
	// {#key} block creates; a plain let is not reactive in runes mode, so the effect could
	// draw into the old, detached element (ROB-U5).
	let axisGroup = $state();

	// resolveStyle tolerates null and returns the defaults, so an axis with no style
	// still renders rather than coming out unstyled.
	const resolved = $derived(resolveStyle(figureStyle));
	const tickfontsize = $derived(resolved.sizes.tick);
	const labelfontsize = $derived(resolved.sizes.axisLabel);

	// Tick length, tick-to-label gap and label-to-title buffer. In a workflow node the type
	// shrinks by `fontScale` and so does the padding around it (viewBox.scalePadding), so these
	// shrink with it: at full size they put the y title past the node's left edge. At scale 1
	// they are exactly 6, 4 and 16, so the workspace and exports are unchanged.
	const chrome = $derived(axisChrome(resolved.fontScale));
	const ticklength = $derived(chrome.tickLength);
	const tickspace = $derived(chrome.tickPadding); // space between the ticks and the numbers
	const labelBuffer = $derived(chrome.titleBuffer); // between largest tick label and axis label

	// How many screen pixels one SVG unit of this axis covers: the CSS zoom of whatever the plot
	// sits inside (the workflow canvas, the workspace). getBoundingClientRect measures in screen
	// pixels, so the tick labels it reports are magnified by that zoom, and the title's distance
	// from the axis used to depend on the zoom the plot happened to mount at. Dividing it back
	// out keeps the title in the figure's own units.
	//
	// Not getBBox, deliberately: it returns single-precision numbers, while the client rect is
	// what the workspace and exports have always used. A scale within SCREEN_SCALE_SNAP of 1 is
	// taken as exactly 1. Real zooms are whole steps of 10% or more; below that the CTM is layout
	// still settling as the plot mounts (Chrome reported 0.9999957 for a workspace plot on its
	// first frame), and dividing by it would shift the title by 1e-4 px and change the bytes of
	// every workspace axis and export for nothing.
	const SCREEN_SCALE_SNAP = 1e-3;
	function screenScale(el) {
		const m = el?.getScreenCTM?.();
		const k = m ? Math.hypot(m.a, m.b) : 1;
		if (!Number.isFinite(k) || k <= 0 || Math.abs(k - 1) < SCREEN_SCALE_SNAP) return 1;
		return k;
	}

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
	const configureTicks = (a) => a.tickSizeInner(ticklength).tickSizeOuter(0).tickPadding(tickspace);

	// Whether a tick's gridline would coincide with, or crowd, the axis line that crosses this
	// one. A bottom/top axis is crossed by the left axis at x = 0; a left/right axis by the
	// bottom axis at y = height. Within GRID_AXIS_CLEAR px the dashed gridline reads as a
	// doubled axis line (a domain widened slightly to clear a whisker cap puts the lowest
	// tick just above the axis), so it is not drawn.
	const GRID_AXIS_CLEAR = 4;
	function onAxisLine(d) {
		const offset = typeof scale?.bandwidth === 'function' ? scale.bandwidth() / 2 : 0;
		const at = Number(scale(d)) + offset;
		if (!Number.isFinite(at)) return false;
		if (position === 'bottom' || position === 'top') return Math.abs(at) < GRID_AXIS_CLEAR;
		return Math.abs(at - height) < GRID_AXIS_CLEAR;
	}

	$effect(() => {
		height;
		width;
		plotPadding;

		if (!scale) return; // scale not ready yet — avoid rendering a broken axis
		if (!axisGroup) return; // between {#key} teardown and the new <g> binding

		//Set a transition
		// const t = transition().duration(10); //Doesn't look good without a similar transition for the line/points/etc... hard to do.

		// DO THE SCALES
		// Manual ticks (a non-empty list) replace d3's own; values outside the domain are not
		// drawn. Read here, outside the per-position branches, so every redraw tracks them.
		// Only a numeric axis draws them (manualTicksToDraw): a time or categorical axis has no
		// manual entry in its panel, so a list typed while the axis was numeric is kept for
		// when it is numeric again but must not draw meanwhile.
		const manual = manualTicksToDraw(axisData.manualTicks, scale, tickMode);
		const withTicks = (a) => (manual ? a.tickValues(manual) : a.ticks(axisData.nticks));
		let axis;
		if (position == 'bottom') {
			axis = withTicks(axisBottom(scale));
			axis = configureTicks(axis);
			if (tickFormat) axis = axis.tickFormat(tickFormat);
			select(axisGroup)
				.call(axis)
				.style('transform', `translate(${plotPadding.left}px, ${height + plotPadding.top}px)`);
		}
		if (position == 'top') {
			axis = withTicks(axisTop(scale));
			axis = configureTicks(axis);
			if (tickFormat) axis = axis.tickFormat(tickFormat);
			select(axisGroup)
				.call(axis)
				.style('transform', `translate(${plotPadding.left}px, ${plotPadding.top}px)`);
		}
		if (position == 'left') {
			axis = withTicks(axisLeft(scale));
			axis = configureTicks(axis);
			if (tickFormat) axis = axis.tickFormat(tickFormat);
			select(axisGroup)
				.call(axis)
				.style('transform', `translate(${plotPadding.left}px, ${plotPadding.top}px)`);
		}
		if (position == 'right') {
			axis = withTicks(axisRight(scale));
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
			// No gridline where it would lie ON the perpendicular axis line: the tick at the
			// x minimum drew a grey dashed line over the solid y axis (and the y minimum over the
			// x axis), which exported as a visibly broken axis line. See onAxisLine below.
			// Nor at an unlabelled tick: a log axis ticks every 1..9 x 10^k but labels only some
			// of them, and a gridline at each of the ~30 minor ticks buried the plot in dashes. A
			// linear axis labels every tick, so it keeps them all.
			const ticksWithGrid = select(axisGroup)
				.selectAll('.tick')
				.filter(function (d) {
					return !onAxisLine(d) && (this.textContent ?? '').trim() !== '';
				});
			if (position == 'bottom') {
				ticksWithGrid
					.append('line')
					.attr('class', 'gridline')
					.attr('y1', -plotPadding.top) // Start at top of plot area
					.attr('y2', -height); // End at bottom of plot area
			} else if (position == 'top') {
				ticksWithGrid
					.append('line')
					.attr('class', 'gridline')
					.attr('y1', 0) // Start at axis
					.attr('y2', height); // End at bottom of plot area
			} else if (position == 'left') {
				ticksWithGrid
					.append('line')
					.attr('class', 'gridline')
					.attr('x1', 0) // Start at axis
					.attr('x2', width); // End at right edge of plot area
			} else if (position == 'right') {
				ticksWithGrid
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
		const zoom = screenScale(axisGroup);
		select(axisGroup)
			.selectAll('.tick text')
			.each(function () {
				const tickRect = this.getBoundingClientRect();
				if (position === 'left' || position === 'right') {
					maxTickSize = Math.max(maxTickSize, tickRect.width / zoom);
				} else {
					maxTickSize = Math.max(maxTickSize, tickRect.height / zoom);
				}
			});

		// Remove existing label`
		select(axisGroup).select('.axis-label').remove();

		// //add in the label
		let labelElement = select(axisGroup)
			.append('text')
			.attr('class', 'axis-label')
			.style('font-size', `${labelfontsize}px`)
			.style('font-family', resolved.fontFamily)
			.style('text-anchor', 'middle')
			.style('fill', 'black')
			.text(axisData.label || defaultLabel);

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
			{#if tools}
				<div class="control-component-title-icons">
					{@render tools()}
				</div>
			{/if}
		</div>
		<div class="control-input-vertical">
			<ControlInput label="Label">
				<AxisLabelInput {axisData} placeholder={defaultLabel || undefined} />
			</ControlInput>
			{#if tickMode !== 'categorical'}
				<ControlInput label="Ticks">
					<select
						aria-label="Tick placement"
						value={tickMode === 'numeric' && Array.isArray(axisData.manualTicks)
							? 'manual'
							: 'auto'}
						disabled={tickMode !== 'numeric'}
						title={tickMode === 'numeric'
							? 'Auto picks the ticks; Manual draws the values you type'
							: 'Manual ticks are not available on a time axis yet'}
						onchange={(e) => setTickMode(e.currentTarget.value)}
					>
						<option value="auto">Auto</option>
						<option value="manual">Manual</option>
					</select>
				</ControlInput>
			{/if}
			{#if tickMode === 'numeric' && Array.isArray(axisData.manualTicks)}
				<ControlInput label="Tick values">
					<input
						aria-label="Tick values"
						placeholder="0, 6, 12, 18, 24"
						value={tickText}
						onfocus={beginTicksEdit}
						oninput={(e) => onTickInput(e.currentTarget.value)}
						onchange={(e) => commitTicksEdit(e.currentTarget.value)}
						onkeydown={ticksKeydown}
					/>
				</ControlInput>
				{#if tickParse.invalid.length}
					<p class="axis-ticks-message" role="status">
						Ignored (not numbers): {tickParse.invalid.join(', ')}
					</p>
				{/if}
				<p class="axis-ticks-hint">
					{tickParse.values.length
						? 'Values outside the axis range are not drawn.'
						: 'No values yet, so the automatic ticks are shown.'}
				</p>
			{:else}
				<ControlInput label="N ticks">
					<!-- Previews as typed; one step on commit (a run of spinner clicks merges). -->
					<!-- display: contents: only there to catch the commit and Escape; no box. -->
					<span
						style="display: contents"
						onfocusin={beginNticksEdit}
						onchange={commitNticksEdit}
						onkeydown={nticksKeydown}
					>
						<NumberWithUnits
							step="1"
							min="1"
							value={axisData.nticks}
							onInput={(v) => (axisData.nticks = v)}
						/>
					</span>
				</ControlInput>
				{#if tickMode === 'time'}
					<p class="axis-ticks-hint">Manual ticks are not available on a time axis yet.</p>
				{/if}
			{/if}
		</div>
		<div class="control-input-vertical">
			<label class="control-input-checkbox">
				<input
					type="checkbox"
					checked={axisData.gridlines}
					onchange={(e) => commitAxisEdit(axisData, 'gridlines', e.currentTarget.checked)}
				/>
				<span class="ci-label">Grid</span>
			</label>
		</div>
		{@render children?.()}
	</div>
{/snippet}

{#snippet plot()}
	<!-- Only a new position needs a fresh <g>: d3 redraws an axis in place but keeps the old
	     orientation's attributes (a bottom axis's tick `y2` on a left axis drew diagonal ticks).
	     Size, padding, scale, tick count and gridlines are all followed by the $effect above.
	     (This was a comma expression, which keyed on its last operand only: the gridlines.) -->
	{#key position}
		<g bind:this={axisGroup} class={'axis-' + position} />
	{/key}
{/snippet}

{#if which === 'plot'}
	{@render plot()}
{:else if which === 'controls'}
	{@render controls(axisData)}
{/if}

<style>
	/* Global on purpose: a scoped rule would add Svelte's hash class to the axis <g> as well
	   (its class is dynamic), and code and tests that read that class expect it bare. */
	:global(.axis-ticks-message),
	:global(.axis-ticks-hint) {
		margin: 0.2rem 0;
		font-size: var(--font-sm);
	}
	:global(.axis-ticks-message) {
		color: var(--color-error);
	}
	:global(.axis-ticks-hint) {
		color: var(--color-text-muted);
	}
</style>
