<script module>
	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';
	import { colourForCategory, colourForCategoryLabel } from '$lib/plots/seriesColour.js';
	import { resolveColour } from '$lib/plots/appearanceIdentity.js';
	import { greyForIndex } from '$lib/plots/seriesAppearance.js';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { isValidStroke } from '$lib/components/plotbits/helpers/misc.js';
	import {
		detectOutliersZScore,
		outlierRemovalMethodDisplay,
		outlierRemovalMethodOptions
	} from '$lib/processes/OutlierRemoval.svelte';
	import { jitterOffset } from '$lib/components/plotbits/helpers/jitter.js';
	import { darkenColour } from '$lib/components/plotbits/helpers/colourShade.js';
	import { median, quantileType7 } from '$lib/utils/sampleStats.js';
	import { isInvalidValue } from '$lib/utils/stats.js';
	import { isMissingCategory } from '$lib/utils/chisquare.js';

	export const boxplotDefaultOutlierMethod = 'iqr';
	const boxplotOutlierMethodOptions = [...outlierRemovalMethodOptions];
	const boxplotOutlierMethodDisplay = [...outlierRemovalMethodDisplay];

	/** The box fill's opacity when none is saved (every session so far saved this). */
	export const BOX_FILL_OPACITY_DEFAULT = 0.3;

	/**
	 * The fill opacity a box is drawn with: the saved value clamped to [0, 1]; anything that
	 * is not a finite number (a hand-edited or corrupt session) draws the default rather than
	 * an opaque or invisible box.
	 * @param {unknown} v
	 */
	export function boxFillOpacity(v) {
		const n = typeof v === 'number' ? v : Number.NaN;
		if (!Number.isFinite(n)) return BOX_FILL_OPACITY_DEFAULT;
		return Math.min(1, Math.max(0, n));
	}

	export class BoxClass {
		// A style object every Boxplot series carries, so it opts ITSELF into the multi-select
		// panel and the AI editor (sharedControls.js), as LineClass and PointsClass do.
		static sharedStyle = true;
		static descriptors = {
			colour: { input: 'color', label: 'Stroke', group: 'Box' },
			fillColour: { input: 'color', label: 'Fill', group: 'Box' },
			fillOpacity: { label: 'Fill opacity', step: 0.05, min: 0, group: 'Box' },
			strokeWidth: { label: 'Stroke width', step: 0.2, min: 0.1, group: 'Box' },
			stroke: {
				input: 'select',
				options: ['solid', '5, 5', '2, 2', '5, 2'],
				label: 'Stroke style',
				group: 'Box'
			},
			draw: { label: 'Show', group: 'Box' },
			boxWidth: { label: 'Box width', step: 0.1, min: 0.1, group: 'Box' },
			whiskerWidth: { label: 'Whisker width', step: 0.1, min: 0.1, group: 'Box' },
			medianColour: { input: 'color', label: 'Median colour', group: 'Box' },
			medianWidth: { label: 'Median width', step: 0.2, min: 0.1, group: 'Box' },
			showOutliers: { label: 'Show outliers', group: 'Outliers' },
			outlierSize: { label: 'Outlier size', step: 0.5, min: 1, group: 'Outliers' },
			outlierMethod: {
				input: 'select',
				options: boxplotOutlierMethodOptions,
				label: 'Outlier method',
				group: 'Outliers'
			},
			iqrMultiplier: { label: 'IQR multiplier', step: 0.1, min: 0.1, group: 'Outliers' },
			zThreshold: { label: 'Z-score threshold', step: 0.1, min: 1, group: 'Outliers' }
		};

		// Resolved at READ time, not stored. A series is constructed with y.refId === -1
		// and wired afterwards, so resolving in the constructor pinned nothing and the
		// identity map never engaged on the interactive path. `#explicitColour` is null
		// while the colour is automatic, which is also what toJSON writes.
		#explicitColour = $state(null);

		get colour() {
			const parent = this.parentData;
			const ref = parent?.y?.refId ?? parent?.column?.refId ?? null;
			const colId = typeof ref === 'number' && ref >= 0 ? ref : null;
			const siblings = parent?.parentPlot?.data;
			const index = Array.isArray(siblings) ? Math.max(0, siblings.indexOf(parent)) : 0;
			return resolveColour(this.#explicitColour, colId, index);
		}
		set colour(v) {
			this.#explicitColour = v;
		}
		// Fill: same read-time resolution as `colour` above — resolving it in the
		// constructor snapshotted the pre-wiring fallback (palette colour 0) for EVERY series.
		#explicitFill = $state(null);
		get fillColour() {
			return this.#explicitFill ?? this.colour;
		}
		set fillColour(v) {
			this.#explicitFill = v;
		}
		fillOpacity = $state(BOX_FILL_OPACITY_DEFAULT);
		strokeWidth = $state(2);
		stroke = $state('solid');
		draw = $state(true);
		showOutliers = $state(true);
		outlierSize = $state(3);
		outlierMethod = $state(boxplotDefaultOutlierMethod);
		iqrMultiplier = $state(1.5);
		zThreshold = $state(3);
		whiskerWidth = $state(0.5);
		boxWidth = $state(0.8);
		medianWidth = $state(2);
		medianColour = $state('#000000');

		constructor(dataIN, parent) {
			this.parentData = parent;
			// Colour follows the COLUMN (see plots/seriesColour.js). A saved string is a CHOICE
			// and kept: since v72.4 an automatic colour is saved as null. Sessions saved before
			// that wrote every colour out, and the ones that were only the automatic colour for
			// the series' own place are released when the session loads, where its version is
			// known (plots/legacyAutoColours.js). Releasing here, without the version, either
			// swallowed a real pick or (comparing against the wrong place) kept an automatic one.
			// A BoxClass passed in (BoxClass.fromJSON, then the constructor) gives its OWN
			// explicit colours: reading its getters would turn an automatic colour into a pick.
			const own = dataIN instanceof BoxClass;
			const savedColour = own ? dataIN.#explicitColour : dataIN?.colour;
			this.#explicitColour = typeof savedColour === 'string' ? savedColour : null;
			// Fill follows the STROKE unless one was chosen. Saved as null when it follows (from
			// v82.49); older sessions wrote the RESOLVED fill, and the ones that only followed are
			// released at load (legacyAutoColours.js) like the stroke.
			const savedFill = own ? dataIN.#explicitFill : dataIN?.fillColour;
			this.#explicitFill = typeof savedFill === 'string' ? savedFill : null;
			this.fillOpacity = dataIN?.fillOpacity ?? BOX_FILL_OPACITY_DEFAULT;
			this.strokeWidth = dataIN?.strokeWidth ?? 2;
			this.stroke = dataIN?.stroke ?? 'solid';
			this.draw = dataIN?.draw ?? true;
			this.showOutliers = dataIN?.showOutliers ?? true;
			this.outlierSize = dataIN?.outlierSize ?? 3;
			this.outlierMethod =
				dataIN?.outlierMethod === 'boxplot'
					? 'iqr'
					: (dataIN?.outlierMethod ?? boxplotDefaultOutlierMethod);
			this.iqrMultiplier = dataIN?.iqrMultiplier ?? 1.5;
			this.zThreshold = dataIN?.zThreshold ?? 3;
			this.whiskerWidth = dataIN?.whiskerWidth ?? 0.5;
			this.boxWidth = dataIN?.boxWidth ?? 0.8;
			this.medianWidth = dataIN?.medianWidth ?? 2;
			this.medianColour = dataIN?.medianColour ?? '#000000';
		}

		toJSON() {
			return {
				colour: this.#explicitColour,
				// null while the fill follows the stroke (as `colour` is null while automatic), so
				// a reload, an undo or a copy keeps following it.
				fillColour: this.#explicitFill,
				fillOpacity: this.fillOpacity,
				strokeWidth: this.strokeWidth,
				stroke: this.stroke,
				draw: this.draw,
				showOutliers: this.showOutliers,
				outlierSize: this.outlierSize,
				outlierMethod: this.outlierMethod,
				iqrMultiplier: this.iqrMultiplier,
				zThreshold: this.zThreshold,
				whiskerWidth: this.whiskerWidth,
				boxWidth: this.boxWidth,
				medianWidth: this.medianWidth,
				medianColour: this.medianColour
			};
		}

		static fromJSON(json) {
			return new BoxClass({
				colour: json.colour,
				fillColour: json.fillColour,
				fillOpacity: json.fillOpacity,
				strokeWidth: json.strokeWidth,
				stroke: json.stroke,
				draw: json.draw,
				showOutliers: json.showOutliers,
				outlierSize: json.outlierSize,
				outlierMethod: json.outlierMethod,
				iqrMultiplier: json.iqrMultiplier,
				zThreshold: json.zThreshold,
				whiskerWidth: json.whiskerWidth,
				boxWidth: json.boxWidth,
				medianWidth: json.medianWidth,
				medianColour: json.medianColour
			});
		}
	}

	// The IQR rule is applied here with the box's own (type-7) quartiles, so the whiskers end
	// at the most extreme data within multiplier x IQR of the quartiles that are DRAWN.
	// OutlierRemoval's detectOutliersIQR takes its quartiles as sorted[floor(n/4)] (STAT-22), and
	// using it here put the fences somewhere other than 1.5 IQR from the drawn box.
	function getOutlierMask(validData, outlierSettings = {}, q1, q3) {
		const method = outlierSettings?.method ?? boxplotDefaultOutlierMethod;
		if (method === 'zscore') {
			return detectOutliersZScore(validData, outlierSettings?.zThreshold ?? 3);
		}
		const k = outlierSettings?.iqrMultiplier ?? 1.5;
		const lo = q1 - k * (q3 - q1);
		const hi = q3 + k * (q3 - q1);
		return validData.map((v) => v < lo || v > hi);
	}

	/**
	 * The present values of a group as numbers: the house rule (isInvalidValue) drops null,
	 * blank, whitespace-only and non-numeric text; a real 0 is data.
	 * @param {Array<number|string|null|undefined>} data
	 * @returns {number[]}
	 */
	export function presentValues(data) {
		const out = [];
		for (const d of data ?? []) if (!isInvalidValue(d)) out.push(Number(d));
		return out;
	}

	/**
	 * Box statistics. Median and quartiles are type 7 (R's default, numpy.percentile's
	 * default, and what DescribeData reports): sorted[floor(n * q)] drew [1,2,3,4] as
	 * 2 / 3 / 4 instead of 1.75 / 2.5 / 3.25 (STAT-2).
	 * @param {Array<number|string|null|undefined>} data
	 */
	export function calculateBoxPlotStats(data, outlierSettings = {}) {
		if (!data || data.length === 0) return null;

		const validData = presentValues(data);
		if (validData.length === 0) return null;

		const sorted = [...validData].sort((a, b) => a - b);

		const q1 = quantileType7(sorted, 0.25);
		const q2 = median(sorted);
		const q3 = quantileType7(sorted, 0.75);

		const outlierMask = getOutlierMask(validData, outlierSettings, q1, q3);
		const outliers = validData.filter((_, i) => outlierMask[i]);
		const inliers = validData.filter((_, i) => !outlierMask[i]);
		const sortedInliers = [...inliers].sort((a, b) => a - b);
		const lowerWhisker = sortedInliers[0] ?? sorted[0];
		const upperWhisker = sortedInliers[sortedInliers.length - 1] ?? sorted[sorted.length - 1];

		return {
			q1,
			q2,
			q3,
			lowerWhisker,
			upperWhisker,
			outliers,
			min: sorted[0],
			max: sorted[sorted.length - 1]
		};
	}
</script>

<script>
	let {
		boxPlotData = $bindable(),
		x = [],
		y = [],
		xscale,
		yscale,
		xoffset = 0,
		yoffset = 0,
		which,
		uniqueXValues = [],
		// Colour each box by its CATEGORY rather than by the series. Only meaningful
		// with a single series: with several, colour distinguishes the series and x
		// position distinguishes the category, which is the standard reading of a
		// grouped boxplot. The host plot decides — see seriesColour.js.
		useCategoryColour = false,
		// Greyscale for print. Applied per CATEGORY when the boxes are category-coloured:
		// greying by series position would give a single-series boxplot one grey for all
		// its boxes, i.e. four indistinguishable boxes, which defeats the point.
		monochrome = false,
		seriesIndex = 0,
		totalSeries = 1,
		dodgeEnabled = true,
		// Overlay the raw data points on each box, horizontally jittered. Plot-level
		// options (Boxplotclass.showPoints / pointJitter / pointSize / pointOpacity)
		// passed down as props.
		showPoints = false,
		pointJitter = 0.35,
		pointSize = 2.5,
		pointOpacity = 0.6,
		pointColour = null,
		// Plot-level toggle (Boxplotclass.showBox): with the violin overlay on, a
		// violin-only display needs the box geometry (whiskers, box, median,
		// outlier rings) to hide while the jittered points can stay.
		showBox = true,
		// Controls-mode only: the host plot colours per CATEGORY (single series +
		// categorical x — see categoryColourLabels in plots/seriesColour.js), which
		// overrides the per-series Stroke/Fill. Showing those pickers live would be a
		// lie, so they are replaced with a pointer to the "Box colours" section that
		// actually owns the colours.
		categoryColoursActive = false,
		title = 'Box plot'
	} = $props();

	let width = $derived(xscale.range()[1] - xscale.range()[0]);
	let height = $derived(yscale.range()[0] - yscale.range()[1]);
	let clipKey = $derived(`boxplot-${seriesIndex}-${xoffset}-${yoffset}`);

	// Group y-values by unique x category
	// Claim a palette slot for each category, ONCE, off the render path. Calling
	// colourForCategory while rendering would mutate $state mid-render and throw
	// state_unsafe_mutation; the template therefore only READS
	// (colourForCategoryLabel), falling back to the series colour for the frame
	// before this effect has pinned.
	$effect(() => {
		if (!useCategoryColour) return;
		groupedStats.forEach((group, i) => colourForCategory(group.category, i));
	});

	let groupedStats = $derived.by(() => {
		if (!boxPlotData?.draw || !Array.isArray(x) || !Array.isArray(y)) {
			return [];
		}

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local lookup built and consumed inside this $derived.by body; the returned value is a plain array, so nothing reads this collection reactively
		const groups = new Map();

		x.forEach((cat, i) => {
			const val = y[i];
			// Skip invalid entries — allow x.length !== y.length
			// A blank category is missing (the Boxplot lists no slot for it, so its box would
			// otherwise be drawn at index -1, left of the axis).
			if (isMissingCategory(cat) || isInvalidValue(val)) return;

			if (!groups.has(cat)) {
				groups.set(cat, []);
			}
			groups.get(cat).push(Number(val));
		});

		return Array.from(groups.entries())
			.map(([category, values]) => {
				const stats = calculateBoxPlotStats(values, {
					method: boxPlotData?.outlierMethod,
					iqrMultiplier: boxPlotData?.iqrMultiplier,
					zThreshold: boxPlotData?.zThreshold
				});
				if (!stats) return null;
				// Keep the raw (valid) values so the showPoints overlay can draw them.
				return { category, values, ...stats };
			})
			.filter(Boolean);
	});

	// Find the index of a category in uniqueXValues
	function getCategoryIndex(category) {
		if (category == null) return -1;
		return uniqueXValues.findIndex((val) => String(val) === String(category));
	}

	// Calculate box width based on category spacing
	let boxHalfWidth = $derived.by(() => {
		if (!xscale || uniqueXValues.length === 0) return 20;

		if (uniqueXValues.length === 1) {
			// Single category - use a reasonable width
			const rangeWidth = xscale.range()[1] - xscale.range()[0];
			return Math.max(2, (rangeWidth * 0.2 * boxPlotData.boxWidth) / (2 * totalSeries));
		}

		// Multiple categories - base width on spacing
		const spacing = (xscale.range()[1] - xscale.range()[0]) / uniqueXValues.length;
		return Math.max(2, (spacing * boxPlotData.boxWidth) / (2 * totalSeries));
	});

	let whiskerHalfWidth = $derived(boxHalfWidth * boxPlotData.whiskerWidth);

	let outlierValues = $derived.by(() => {
		if (!groupedStats.length) return [];
		return groupedStats.flatMap((group) => group.outliers ?? []);
	});

	// Calculate dodge offset for multiple series
	let dodgeOffset = $derived.by(() => {
		if (!dodgeEnabled || totalSeries <= 1) return 0;
		const totalWidth = boxHalfWidth * 2 * totalSeries;
		const step = totalWidth / totalSeries;
		return (seriesIndex - (totalSeries - 1) / 2) * step;
	});
</script>

{#snippet controls(boxPlotData)}
	<div class="control-component">
		<div class="control-component-title">
			<p>{title}</p>
			<button
				class="icon"
				onclick={(e) => {
					e.stopPropagation();
					boxPlotData.draw = !boxPlotData.draw;
				}}
			>
				{#if !boxPlotData.draw}
					<Icon name="eye-slash" width={16} height={16} />
				{:else}
					<Icon name="eye" width={16} height={16} className="visible" />
				{/if}
			</button>
		</div>
		{#if boxPlotData.draw}
			{#if categoryColoursActive}
				<p class="category-colour-note">Per-category colours are in use; see Box colours below.</p>
			{:else}
				<!-- Plain columns, not .control-input-swatch: each swatch heads one of the panel's
				     two columns, so it lines up with the rows below. -->
				<div class="control-input-horizontal">
					<div class="control-input">
						<p>Stroke</p>
						<ColourPicker bind:value={boxPlotData.colour} />
					</div>
					<div class="control-input">
						<p>Fill</p>
						<ColourPicker bind:value={boxPlotData.fillColour} />
					</div>
				</div>
			{/if}
			<!-- Outside the per-category branch: category colours replace the fill COLOUR, but the
			     boxes are still drawn with this opacity. -->
			<div class="control-input-horizontal">
				<ControlInput label="Fill opacity">
					<NumberWithUnits step="0.05" min={0} max={1} bind:value={boxPlotData.fillOpacity} />
				</ControlInput>
			</div>
			<div class="control-input-horizontal">
				<ControlInput label="Stroke width">
					<NumberWithUnits step="0.2" min={0.1} bind:value={boxPlotData.strokeWidth} />
				</ControlInput>
				<div class="control-input">
					<p>Stroke style</p>
					<div class="stroke-field" class:invalid={boxPlotData.stroke === -1}>
						<AttributeSelect
							value={boxPlotData.stroke}
							onChange={(value) => {
								if (isValidStroke(value)) {
									boxPlotData.stroke = value;
								} else {
									boxPlotData.stroke = -1;
								}
							}}
							options={['solid', '5, 5', '2, 2', '5, 2']}
							optionsDisplay={['Solid', 'Dashed', 'Dotted', 'Dashed & dotted']}
							other={true}
							placeholder="eg 5, 5"
						/>
					</div>
					{#if boxPlotData.stroke === -1}
						<span class="field-error" role="alert">
							<Icon name="alert-triangle" width={12} height={12} />
							Invalid pattern
						</span>
					{/if}
				</div>
			</div>
			<div class="control-input-horizontal">
				<ControlInput label="Box width">
					<NumberWithUnits step="0.1" min={0.1} max={1} bind:value={boxPlotData.boxWidth} />
				</ControlInput>
				<ControlInput label="Whisker width">
					<NumberWithUnits step="0.1" min={0.1} max={1} bind:value={boxPlotData.whiskerWidth} />
				</ControlInput>
			</div>
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Median colour</p>
					<ColourPicker bind:value={boxPlotData.medianColour} />
				</div>
				<ControlInput label="Median width">
					<NumberWithUnits step="0.2" min={0.1} bind:value={boxPlotData.medianWidth} />
				</ControlInput>
			</div>
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Outlier method</p>
					<AttributeSelect
						bind:value={boxPlotData.outlierMethod}
						options={boxplotOutlierMethodOptions}
						optionsDisplay={boxplotOutlierMethodDisplay}
					/>
				</div>
				{#if boxPlotData.outlierMethod === 'iqr'}
					<ControlInput label="IQR multiplier">
						<NumberWithUnits step="0.1" min={0.1} max={5} bind:value={boxPlotData.iqrMultiplier} />
					</ControlInput>
				{:else if boxPlotData.outlierMethod === 'zscore'}
					<ControlInput label="Z-score threshold">
						<NumberWithUnits step="0.1" min={1} max={10} bind:value={boxPlotData.zThreshold} />
					</ControlInput>
				{/if}
			</div>
			<div class="control-input-horizontal">
				<ControlInput label="Show outliers">
					<input type="checkbox" bind:checked={boxPlotData.showOutliers} />
				</ControlInput>
				{#if boxPlotData.showOutliers}
					<ControlInput label="Outlier size">
						<NumberWithUnits step="0.5" min={1} bind:value={boxPlotData.outlierSize} />
					</ControlInput>
				{/if}
			</div>
			{#if outlierValues.length > 0}
				<div>
					<p>Outliers</p>
					<div class="removed-values-list">
						{#each outlierValues as value, i (i)}
							<div class="removed-value-row">
								<span class="removed-value-number">{i + 1}:</span>
								<span class="removed-value">{parseFloat(value.toFixed(2))}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		{/if}
	</div>
{/snippet}

{#snippet plot(boxPlotData)}
	{#if groupedStats.length > 0 && boxPlotData?.draw}
		<!-- Clip to the plot area. The <g> below is already translated by
		     (xoffset, yoffset), so the clip rect lives in that translated local
		     space and must start at 0,0 — using (xoffset, yoffset) here would
		     double-count the offset and clip off the first category's box. -->
		<clipPath id={clipKey}>
			<rect x="0" y="0" {width} {height} />
		</clipPath>

		<g clip-path="url(#{clipKey})" style="transform: translate({xoffset}px, {yoffset}px);">
			{#each groupedStats as group, gi (gi)}
				{@const categoryIdx = getCategoryIndex(group.category)}
				{@const xCenter = xscale(categoryIdx) + dodgeOffset}
				{@const categoryColour = useCategoryColour
					? monochrome
						? greyForIndex(categoryIdx, uniqueXValues.length)
						: colourForCategoryLabel(group.category)
					: null}
				{@const boxColour = categoryColour ?? boxPlotData.colour}
				{@const boxFill = categoryColour ?? boxPlotData.fillColour}

				{#if showBox}
					<!-- Lower whisker -->
					<line
						x1={xCenter}
						y1={yscale(group.lowerWhisker)}
						x2={xCenter}
						y2={yscale(group.q1)}
						stroke={boxColour}
						stroke-width={boxPlotData.strokeWidth}
						stroke-dasharray={boxPlotData.stroke}
					/>
					<line
						x1={xCenter - whiskerHalfWidth}
						y1={yscale(group.lowerWhisker)}
						x2={xCenter + whiskerHalfWidth}
						y2={yscale(group.lowerWhisker)}
						stroke={boxColour}
						stroke-width={boxPlotData.strokeWidth}
					/>

					<!-- Box -->
					<!-- The fill is translucent (the saved fillOpacity, 0.3 by default), so a box
					     filled in its own outline colour still shows its outline, median and
					     points. Only the FILL is translucent: the outline, whiskers, median and
					     outlier rings stay opaque. -->
					<rect
						x={xCenter - boxHalfWidth}
						y={yscale(group.q3)}
						width={boxHalfWidth * 2}
						height={yscale(group.q1) - yscale(group.q3)}
						fill={boxFill}
						fill-opacity={boxFillOpacity(boxPlotData.fillOpacity)}
						stroke={boxColour}
						stroke-width={boxPlotData.strokeWidth}
						stroke-dasharray={boxPlotData.stroke}
					/>

					<!-- Median -->
					<line
						x1={xCenter - boxHalfWidth}
						y1={yscale(group.q2)}
						x2={xCenter + boxHalfWidth}
						y2={yscale(group.q2)}
						stroke={boxPlotData.medianColour}
						stroke-width={boxPlotData.medianWidth}
					/>

					<!-- Upper whisker -->
					<line
						x1={xCenter}
						y1={yscale(group.q3)}
						x2={xCenter}
						y2={yscale(group.upperWhisker)}
						stroke={boxColour}
						stroke-width={boxPlotData.strokeWidth}
						stroke-dasharray={boxPlotData.stroke}
					/>
					<line
						x1={xCenter - whiskerHalfWidth}
						y1={yscale(group.upperWhisker)}
						x2={xCenter + whiskerHalfWidth}
						y2={yscale(group.upperWhisker)}
						stroke={boxColour}
						stroke-width={boxPlotData.strokeWidth}
					/>

					<!-- Outliers -->
					{#if boxPlotData.showOutliers}
						{#each group.outliers as outlier, oi (oi)}
							<circle
								cx={xCenter}
								cy={yscale(outlier)}
								r={boxPlotData.outlierSize}
								fill="none"
								stroke={boxColour}
								stroke-width={boxPlotData.strokeWidth}
							/>
						{/each}
					{/if}
				{/if}

				<!-- Raw data points, horizontally jittered. Deterministic per point (see
				     helpers/jitter.js) so re-renders and reloaded sessions draw identically.
				     Inside the clipped <g>, so they respect the y limits exactly as the
				     boxes do. Drawn LAST in the group — above the box fill, median line
				     and outlier rings — with a darker same-hue stroke so semi-transparent
				     points still read against a fill of the same colour. -->
				{#if showPoints}
					{#each group.values as value, vi (vi)}
						<circle
							cx={xCenter + jitterOffset(seriesIndex, categoryIdx, vi) * boxHalfWidth * pointJitter}
							cy={yscale(value)}
							r={pointSize}
							fill={pointColour ?? boxColour}
							fill-opacity={pointOpacity}
							stroke={darkenColour(pointColour ?? boxColour, 0.35)}
							stroke-width={0.8}
						/>
					{/each}
				{/if}
			{/each}
		</g>
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(boxPlotData)}
{:else if which === 'controls'}
	{@render controls(boxPlotData)}
{/if}

<style>
	.category-colour-note {
		margin: 0 0 var(--space-2);
		font-size: var(--font-xs);
		font-style: italic;
		color: var(--color-text-muted);
	}

	.removed-values-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 150px;
		overflow-y: auto;
		border: 1px solid #e1e9f6;
		border-radius: var(--radius-sm);
		padding: 4px;
	}

	.removed-value-row {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: var(--font-xs);
	}

	.removed-value-number {
		color: var(--color-lightness-35);
		min-width: 24px;
		flex-shrink: 0;
	}

	.removed-value {
		width: 70px;
		font-size: var(--font-xs);
		padding: 1px 4px;
	}

	/* Invalid stroke pattern: pair the colour cue with a real outline + an icon and
	   text message, so the error isn't conveyed by colour alone (WCAG 1.4.1). */
	.stroke-field.invalid {
		outline: 1px solid var(--color-error);
		border-radius: 2px;
	}
	.field-error {
		display: flex;
		align-items: center;
		gap: 3px;
		margin-top: var(--space-1);
		color: var(--color-error);
		font-size: var(--font-xs);
	}
</style>
