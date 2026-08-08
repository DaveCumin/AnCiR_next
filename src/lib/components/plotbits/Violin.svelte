<script>
	// Violin overlay for the boxplot: a symmetric KDE outline per category,
	// drawn BEHIND the box and the jittered points (the host renders Violins
	// before Boxes). Options live on Boxplotclass (plot-level) and arrive as
	// props; per-series colour resolution mirrors Box.svelte exactly so a violin
	// never disagrees with the box it sits under.
	import { colourForCategory, colourForCategoryLabel } from '$lib/plots/seriesColour.js';
	import { greyForIndex } from '$lib/plots/seriesAppearance.js';
	import { violinCurve, violinOutline } from '$lib/components/plotbits/helpers/violin.js';

	let {
		// The series' BoxClass — used ONLY for colour resolution (`colour` follows
		// the column via resolveColour) and the per-series eye toggle (`draw`), so
		// violin and box always share an identity. Never mutated here.
		boxPlotData,
		x = [],
		y = [],
		xscale,
		yscale,
		xoffset = 0,
		yoffset = 0,
		uniqueXValues = [],
		// Same semantics as Box.svelte: category colouring only ever with a single
		// series, monochrome greys per category when category-coloured.
		useCategoryColour = false,
		monochrome = false,
		seriesIndex = 0,
		totalSeries = 1,
		dodgeEnabled = true,
		bandwidth = null, // null/0 = Silverman auto
		violinWidth = 0.8, // max width as a fraction of the category slot
		violinOpacity = 0.3
	} = $props();

	let width = $derived(xscale.range()[1] - xscale.range()[0]);
	let height = $derived(yscale.range()[0] - yscale.range()[1]);
	let clipKey = $derived(`violin-${seriesIndex}-${xoffset}-${yoffset}`);

	// Group y-values by category, exactly as Box.svelte does, and attach each
	// group's violin curve (null when gated: n < VIOLIN_MIN_N or degenerate).
	let groupedCurves = $derived.by(() => {
		if (!boxPlotData?.draw || !Array.isArray(x) || !Array.isArray(y)) return [];

		const groups = new Map();
		x.forEach((cat, i) => {
			const val = y[i];
			if (cat == null || val == null || isNaN(val)) return;
			if (!groups.has(cat)) groups.set(cat, []);
			groups.get(cat).push(val);
		});

		return Array.from(groups.entries())
			.map(([category, values]) => {
				const curve = violinCurve(values, { bandwidth });
				return curve ? { category, curve } : null;
			})
			.filter(Boolean);
	});

	// Claim palette slots off the render path — same rationale as Box.svelte:
	// colourForCategory mutates $state and would throw state_unsafe_mutation if
	// called while rendering. Idempotent alongside Box's identical claim.
	$effect(() => {
		if (!useCategoryColour) return;
		groupedCurves.forEach((group, i) => colourForCategory(group.category, i));
	});

	function getCategoryIndex(category) {
		if (category == null) return -1;
		return uniqueXValues.findIndex((val) => String(val) === String(category));
	}

	// Half-width of the widest point of the violin, mirroring Box's boxHalfWidth
	// so violinWidth and boxWidth share one unit (fraction of the category slot).
	let violinHalfWidth = $derived.by(() => {
		if (!xscale || uniqueXValues.length === 0) return 20;
		if (uniqueXValues.length === 1) {
			const rangeWidth = xscale.range()[1] - xscale.range()[0];
			return Math.max(2, (rangeWidth * 0.2 * violinWidth) / (2 * totalSeries));
		}
		const spacing = (xscale.range()[1] - xscale.range()[0]) / uniqueXValues.length;
		return Math.max(2, (spacing * violinWidth) / (2 * totalSeries));
	});

	let dodgeOffset = $derived.by(() => {
		if (!dodgeEnabled || totalSeries <= 1) return 0;
		const totalWidth = violinHalfWidth * 2 * totalSeries;
		const step = totalWidth / totalSeries;
		return (seriesIndex - (totalSeries - 1) / 2) * step;
	});
</script>

{#if groupedCurves.length > 0 && boxPlotData?.draw}
	<!-- Clip to the plot area; the <g> is translated by (xoffset, yoffset), so
	     the clip rect lives in that local space and starts at 0,0 (see the
	     matching comment in Box.svelte). -->
	<clipPath id={clipKey}>
		<rect x="0" y="0" {width} {height} />
	</clipPath>

	<g clip-path="url(#{clipKey})" style="transform: translate({xoffset}px, {yoffset}px);">
		{#each groupedCurves as group}
			{@const categoryIdx = getCategoryIndex(group.category)}
			{@const xCenter = xscale(categoryIdx) + dodgeOffset}
			{@const categoryColour = useCategoryColour
				? monochrome
					? greyForIndex(categoryIdx, uniqueXValues.length)
					: colourForCategoryLabel(group.category)
				: null}
			{@const violinColour = categoryColour ?? boxPlotData.colour}
			{@const outline = violinOutline(group.curve, {
				xCenter,
				halfWidthPx: violinHalfWidth,
				yscale
			})}

			<polygon
				points={outline.map(([px, py]) => `${px},${py}`).join(' ')}
				fill={violinColour}
				fill-opacity={violinOpacity}
				stroke={violinColour}
				stroke-width={1}
			/>
		{/each}
	</g>
{/if}
