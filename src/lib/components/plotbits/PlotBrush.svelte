<script>
	// PlotBrush — rubber-band zoom overlay for an xy plot.
	//
	// Renders inside the plot's SVG, translated to the plot area origin. A drag
	// draws a selection box; on release it calls `onZoom({ x0,y0,x1,y1 })` with the
	// corners in plot user-units (top-left origin). A double-click calls `onReset`.
	// When `zoomed` is true a small "reset" affordance shows in the bottom-right.
	//
	// The hit rect sits BELOW the data layers so their hover-tooltips keep working.
	// It only STARTS the drag (pointerdown); tracking then moves to WINDOW-level
	// listeners for the duration of the gesture. That's essential: without them the
	// drag would break the instant the cursor crossed a data point (SVG pointer
	// capture is unreliable), which is exactly what happens on a dense scatter.

	import { brushIsSignificant } from './helpers/brushHelpers.js';

	let {
		plotwidth,
		plotheight,
		zoomed = false,
		onZoom,
		onReset
	} = $props();

	let hitEl = $state(null);
	// Live drag in plot user-units, or null when idle.
	let drag = $state(null);

	// Convert a pointer event to plot-area local user-units, correcting for any
	// CSS scaling applied to the SVG (canvas zoom / preview scale) by measuring
	// the hit rect's rendered size against its user-unit size.
	function toLocal(e) {
		const r = hitEl.getBoundingClientRect();
		const sx = r.width > 0 ? r.width / plotwidth : 1;
		const sy = r.height > 0 ? r.height / plotheight : 1;
		const x = Math.max(0, Math.min(plotwidth, (e.clientX - r.left) / sx));
		const y = Math.max(0, Math.min(plotheight, (e.clientY - r.top) / sy));
		return { x, y };
	}

	function onWindowMove(e) {
		if (!drag) return;
		const { x, y } = toLocal(e);
		drag = { ...drag, x1: x, y1: y };
	}

	function endDrag() {
		window.removeEventListener('pointermove', onWindowMove);
		window.removeEventListener('pointerup', onWindowUp);
		window.removeEventListener('pointercancel', onWindowUp);
	}

	function onWindowUp() {
		endDrag();
		if (!drag) return;
		const box = drag;
		drag = null;
		if (brushIsSignificant(box)) onZoom?.(box);
	}

	function onPointerDown(e) {
		if (e.button !== 0) return;
		// Keep the gesture on the plot: don't let the workflow canvas / plot card
		// start a pan or a node/card move underneath us.
		e.stopPropagation();
		e.preventDefault();
		const { x, y } = toLocal(e);
		drag = { x0: x, y0: y, x1: x, y1: y };
		// Track on the window so the drag survives crossing over points/lines and
		// releasing anywhere — no dependency on SVG pointer capture.
		window.addEventListener('pointermove', onWindowMove);
		window.addEventListener('pointerup', onWindowUp);
		window.addEventListener('pointercancel', onWindowUp);
	}

	// Drop listeners if we unmount mid-drag.
	$effect(() => endDrag);

	const rect = $derived(
		drag
			? {
					x: Math.min(drag.x0, drag.x1),
					y: Math.min(drag.y0, drag.y1),
					w: Math.abs(drag.x1 - drag.x0),
					h: Math.abs(drag.y1 - drag.y0)
				}
			: null
	);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<g class="plot-brush">
	<rect
		bind:this={hitEl}
		class="brush-hit"
		x="0"
		y="0"
		width={plotwidth}
		height={plotheight}
		fill="transparent"
		onpointerdown={onPointerDown}
		ondblclick={(e) => {
			e.stopPropagation();
			onReset?.();
		}}
	/>

	{#if rect}
		<rect
			class="brush-selection"
			x={rect.x}
			y={rect.y}
			width={rect.w}
			height={rect.h}
		/>
	{/if}

	{#if zoomed && !drag}
		<!-- Bottom-right corner: legends default to top-right, so this stays clear. -->
		<g
			class="brush-reset"
			transform="translate({plotwidth - 52}, {plotheight - 24})"
			onpointerdown={(e) => {
				e.stopPropagation();
				onReset?.();
			}}
			role="button"
			tabindex="-1"
			aria-label="Reset zoom"
		>
			<rect x="0" y="0" width="46" height="18" rx="4" />
			<text x="23" y="13">reset</text>
		</g>
	{/if}
</g>

<style>
	.brush-hit {
		cursor: crosshair;
	}
	.brush-selection {
		fill: color-mix(in srgb, var(--color-accent) 12%, transparent);
		stroke: var(--color-accent);
		stroke-width: 1;
		stroke-dasharray: 4 3;
		pointer-events: none;
	}
	.brush-reset {
		cursor: pointer;
	}
	.brush-reset rect {
		fill: var(--surface-card, #fff);
		stroke: var(--color-accent);
		stroke-width: 1;
		opacity: 0.92;
	}
	.brush-reset text {
		fill: var(--color-accent);
		font-size: 11px;
		text-anchor: middle;
		dominant-baseline: middle;
		user-select: none;
	}
	.brush-reset:hover rect {
		fill: color-mix(in srgb, var(--color-accent) 14%, var(--surface-card, #fff));
	}
</style>
