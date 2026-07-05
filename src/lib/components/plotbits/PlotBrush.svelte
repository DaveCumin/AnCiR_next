<script>
	// PlotBrush — rubber-band zoom overlay for an xy plot.
	//
	// Listens for pointerdown on the plot's <svg> (passed in as `svgEl`) rather
	// than on a covering hit-rect. That means a drag can START anywhere over the
	// plot — including directly on a data point — and there's no overlay to block
	// hover-tooltips. The drag then tracks on WINDOW listeners so it survives the
	// cursor crossing points and releasing anywhere. Renders the selection box; on
	// release calls `onZoom({x0,y0,x1,y1})` in plot user-units. Double-click on the
	// plot calls `onReset` (the selection toolbar's Reset is the primary reset).
	//
	// This component is only mounted while Zoom mode is on, so its listeners exist
	// only then — nothing to gate at the DOM level.

	import { brushIsSignificant } from './helpers/brushHelpers.js';

	let { svgEl, padding, plotwidth, plotheight, onZoom, onReset } = $props();

	// Live drag in plot user-units (0..plotwidth, 0..plotheight), or null when idle.
	let drag = $state(null);

	// Client px -> plot-area local user-units, correcting for any CSS scaling of the
	// SVG (canvas zoom / preview scale) by comparing its rendered size to the SVG's
	// user-unit size (plot area + padding on each side = the viewBox dimensions).
	function toLocal(clientX, clientY) {
		if (!svgEl) return null;
		const r = svgEl.getBoundingClientRect();
		const padL = padding?.left ?? 0;
		const padT = padding?.top ?? 0;
		const userW = plotwidth + padL + (padding?.right ?? 0);
		const userH = plotheight + padT + (padding?.bottom ?? 0);
		const sx = r.width > 0 ? r.width / userW : 1;
		const sy = r.height > 0 ? r.height / userH : 1;
		return { x: (clientX - r.left) / sx - padL, y: (clientY - r.top) / sy - padT };
	}
	const clampX = (x) => Math.max(0, Math.min(plotwidth, x));
	const clampY = (y) => Math.max(0, Math.min(plotheight, y));

	function onWindowMove(e) {
		if (!drag) return;
		const l = toLocal(e.clientX, e.clientY);
		if (!l) return;
		drag = { ...drag, x1: clampX(l.x), y1: clampY(l.y) };
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

	function onSvgPointerDown(e) {
		if (e.button !== 0) return;
		const l = toLocal(e.clientX, e.clientY);
		if (!l) return;
		// Only start inside the plotting region (ignore axes / margins / legend).
		if (l.x < 0 || l.x > plotwidth || l.y < 0 || l.y > plotheight) return;
		// Don't let the workspace/card start a pan or move, and stop native drag.
		e.preventDefault();
		e.stopPropagation();
		const x = clampX(l.x);
		const y = clampY(l.y);
		drag = { x0: x, y0: y, x1: x, y1: y };
		window.addEventListener('pointermove', onWindowMove);
		window.addEventListener('pointerup', onWindowUp);
		window.addEventListener('pointercancel', onWindowUp);
	}
	function onSvgDblClick(e) {
		e.stopPropagation();
		onReset?.();
	}

	// Attach to the SVG for as long as this component is mounted (i.e. Zoom mode
	// is on). Re-runs if svgEl changes; always tears down its own listeners.
	$effect(() => {
		const el = svgEl;
		if (!el) return;
		el.addEventListener('pointerdown', onSvgPointerDown);
		el.addEventListener('dblclick', onSvgDblClick);
		return () => {
			el.removeEventListener('pointerdown', onSvgPointerDown);
			el.removeEventListener('dblclick', onSvgDblClick);
			endDrag();
		};
	});

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

{#if rect}
	<rect class="brush-selection" x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
{/if}

<style>
	.brush-selection {
		fill: color-mix(in srgb, var(--color-accent) 12%, transparent);
		stroke: var(--color-accent);
		stroke-width: 1;
		stroke-dasharray: 4 3;
		pointer-events: none;
	}
</style>
