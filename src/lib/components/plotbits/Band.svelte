<!--
	A shaded band on a scatterplot, drawn from an OverlayClass `geometry()` result
	(plan 2026-09-13, part B2):

	  - rect segments ({x0,x1} for vertical/repeating, {y0,y1} for horizontal) as
	    full-height / full-width <rect>s. This absorbed NightBand.svelte's rect
	    rendering: a time x axis simply hands in a UTC scale and ms positions, so
	    the maths is the scale's.
	  - a ribbon ({x, lower, upper}) as one d3 `area`, `.defined` on finite
	    lower/upper so a gap in either edge breaks the ribbon rather than bridging it.
	  - an optional EDGE stroke: the two data edges of each shape (never the plot
	    boundary sides of a rect), as <line>s for segments and <path>s for a ribbon.

	Coordinates are absolute (offsets folded in, no transform) so tests and tooling
	can read positions straight off the attributes, as Line.svelte's `rules` does.
	Style comes from the overlay: `fill`, `edge`, `edgeColour`, `edgeWidth`.
-->
<script>
	import { area, line as d3line } from 'd3-shape';

	let { overlay, geometry, xscale, yscale, xoffset = 0, yoffset = 0 } = $props();

	let width = $derived(xscale.range()[1]);
	let height = $derived(yscale.range()[0]);
	let clipKey = $derived(`band-${overlay?.id ?? 0}-${xoffset}-${yoffset}-${width}-${height}`);

	const finite = (v) => typeof v === 'number' && Number.isFinite(v);

	// Ribbon paths over point INDICES so x/lower/upper stay three parallel arrays.
	let ribbon = $derived.by(() => {
		if (geometry?.form !== 'ribbon' || !(geometry.x?.length > 0)) return null;
		const { x, lower, upper } = geometry;
		const idx = x.map((_, i) => i);
		const defined = (i) => finite(x[i]) && finite(lower[i]) && finite(upper[i]);
		const px = (i) => xscale(x[i]) + xoffset;
		const fill = area()
			.x(px)
			.y0((i) => yscale(lower[i]) + yoffset)
			.y1((i) => yscale(upper[i]) + yoffset)
			.defined(defined)(idx);
		if (!fill) return null;
		return {
			fill,
			lower: d3line()
				.x(px)
				.y((i) => yscale(lower[i]) + yoffset)
				.defined(defined)(idx),
			upper: d3line()
				.x(px)
				.y((i) => yscale(upper[i]) + yoffset)
				.defined(defined)(idx)
		};
	});

	// Rect segments in pixel space: {x, y, w, h, edges:[[x1,y1,x2,y2], ...]}.
	let rects = $derived.by(() => {
		if (!geometry || geometry.form === 'ribbon') return [];
		const out = [];
		for (const seg of geometry.segments ?? []) {
			if ('y0' in seg) {
				const top = yscale(seg.y1) + yoffset;
				const bottom = yscale(seg.y0) + yoffset;
				const y = Math.min(top, bottom);
				const h = Math.abs(bottom - top);
				out.push({
					x: xoffset,
					y,
					w: width,
					h,
					edges: [
						[xoffset, bottom, xoffset + width, bottom],
						[xoffset, top, xoffset + width, top]
					]
				});
			} else {
				const left = xscale(seg.x0) + xoffset;
				const right = xscale(seg.x1) + xoffset;
				const x = Math.min(left, right);
				const w = Math.abs(right - left);
				out.push({
					x,
					y: yoffset,
					w,
					h: height,
					edges: [
						[left, yoffset, left, yoffset + height],
						[right, yoffset, right, yoffset + height]
					]
				});
			}
		}
		return out;
	});
</script>

{#if ribbon || rects.length > 0}
	<clipPath id={clipKey}>
		<rect x={xoffset} y={yoffset} {width} {height} />
	</clipPath>
	<g class="overlay-band" clip-path="url(#{clipKey})" style="pointer-events: none;">
		{#if ribbon}
			<path class="band-ribbon" d={ribbon.fill} fill={overlay.fill} stroke="none" />
			{#if overlay.edge}
				<path
					class="band-edge"
					d={ribbon.lower}
					fill="none"
					stroke={overlay.edgeColour}
					stroke-width={overlay.edgeWidth}
				/>
				<path
					class="band-edge"
					d={ribbon.upper}
					fill="none"
					stroke={overlay.edgeColour}
					stroke-width={overlay.edgeWidth}
				/>
			{/if}
		{:else}
			{#each rects as r, i (i)}
				<rect class="band-rect" x={r.x} y={r.y} width={r.w} height={r.h} fill={overlay.fill} />
				{#if overlay.edge}
					{#each r.edges as [x1, y1, x2, y2], j (j)}
						<line
							class="band-edge"
							{x1}
							{y1}
							{x2}
							{y2}
							stroke={overlay.edgeColour}
							stroke-width={overlay.edgeWidth}
						/>
					{/each}
				{/if}
			{/each}
		{/if}
	</g>
{/if}
