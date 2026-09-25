<script>
	// @ts-nocheck
	// Hover tooltip for plots. Rendered into <body> so its `position: fixed`
	// placement is relative to the viewport, NOT the zoom/pan-transformed canvas
	// (a `fixed` element nested inside a CSS-transformed ancestor is captured by
	// that transform, which is why plot tooltips drifted when the canvas was
	// panned or zoomed). Coordinates are viewport (clientX/clientY) — see
	// computeTooltipPosition in tooltipHelpers.js.
	let { visible = false, x = 0, y = 0, content = '' } = $props();

	function portal(node) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.parentNode?.removeChild(node);
			}
		};
	}
</script>

{#if visible}
	<div class="tooltip plot-tooltip" use:portal style="left: {x}px; top: {y}px;">
		<!-- `content` is the HTML string built by buildAggregatedContent() in tooltipHelpers.js
		     (colour-swatch spans, <strong> labels, <br/>), so it is markup by design and cannot be
		     rendered as text. The values it interpolates — column names, user-entered labels,
		     formatted values, series colours — are escaped at the point of interpolation there
		     (escapeHtml / safeColour), which is what keeps this {@html} safe. Any OTHER producer
		     of `content` owes the same: today that is CircularPhase.svelte and the Actogram's
		     Annotation.svelte, and both escape. -->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- every producer escapes; see above -->
		{@html content}
	</div>
{/if}

<style>
	/* Inherits the global `.tooltip` look (background, padding, z-index) defined
	   in +page.svelte; allow multi-line content with forced <br/> breaks. */
	.plot-tooltip {
		white-space: nowrap;
	}
</style>
