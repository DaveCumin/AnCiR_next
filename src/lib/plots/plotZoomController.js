// plotZoomController.js
//
// Shared brush + wheel zoom behaviour for point plots, driven by a per-plot
// adapter (see zoomAdapters.js) so it doesn't care what each plot names its
// axis-limit fields or how it builds its scales. The component owns `svgEl`
// (bind:this) and its props; it passes a `ctx()` accessor that returns the live
// values at event time.
//
// ctx() -> { plot, brushable, zoomMode, svgEl, adapter }
//   plot     : the outer Plot (has .plot with parentBox/padding/plotwidth/height)
//   brushable: full-size interactive plot (vs embedded preview)
//   zoomMode : Zoom toggled on for this plot
//   svgEl    : the plot's <svg> element
//   adapter  : { axes: [{ orient:'x'|'y', scale():d3scale, set(lims) }], reset() }

import { toLimitNumber, zoomLimitsAroundPoint } from '$lib/components/plotbits/helpers/brushHelpers.js';

export function createPlotZoom(ctx) {
	// Pointer client coords -> plot-area local user-units, correcting for the CSS
	// scale the workspace applies to the SVG.
	function localFromEvent(e, p, svgEl) {
		const rect = svgEl?.getBoundingClientRect();
		if (!rect) return null;
		const sx = rect.width > 0 ? rect.width / p.parentBox.width : 1;
		const sy = rect.height > 0 ? rect.height / p.parentBox.height : 1;
		return {
			x: (e.clientX - rect.left) / sx - p.padding.left,
			y: (e.clientY - rect.top) / sy - p.padding.top
		};
	}

	// PlotBrush gives the box already in plot-area local user-units.
	function applyBrushZoom(box) {
		const { plot, adapter } = ctx();
		if (!adapter?.axes || !plot?.plot) return;
		for (const ax of adapter.axes) {
			const s = ax.scale();
			const lo = ax.orient === 'x' ? Math.min(box.x0, box.x1) : Math.min(box.y0, box.y1);
			const hi = ax.orient === 'x' ? Math.max(box.x0, box.x1) : Math.max(box.y0, box.y1);
			const a = toLimitNumber(s.invert(lo));
			const b = toLimitNumber(s.invert(hi));
			ax.set([Math.min(a, b), Math.max(a, b)]);
		}
	}

	function handleWheelZoom(e) {
		const { plot, brushable, zoomMode, svgEl, adapter } = ctx();
		if (!brushable || !adapter?.axes || !plot?.plot) return;
		// Plain wheel only zooms in Zoom mode; otherwise let it bubble so the
		// workspace pans. Shift+wheel always zooms (power-user shortcut).
		if (!zoomMode && !e.shiftKey) return;
		const p = plot.plot;
		const loc = localFromEvent(e, p, svgEl);
		if (!loc) return;
		if (loc.x < 0 || loc.x > p.plotwidth || loc.y < 0 || loc.y > p.plotheight) return;
		e.preventDefault();
		e.stopPropagation();
		const factor = e.deltaY > 0 ? 1.1 : 0.9; // out : in
		for (const ax of adapter.axes) {
			const s = ax.scale();
			const px = ax.orient === 'x' ? loc.x : loc.y;
			ax.set(zoomLimitsAroundPoint(s.domain(), toLimitNumber(s.invert(px)), factor));
		}
	}

	function resetZoom() {
		ctx().adapter?.reset();
	}

	return { applyBrushZoom, handleWheelZoom, resetZoom };
}
