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
