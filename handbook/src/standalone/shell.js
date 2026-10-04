// Mounts one handbook animation as a full-window presentation page.
//
// The component is the handbook's own; this shell only gives it a box to
// fill. Canvas animations are laid out in two passes:
//
//   1. Calibrate: mount at the handbook's embed width and the chapter's height
//      and measure the viz rows. That is the design the handbook shows, at
//      graphic scale 1.
//   2. Fit: on every size change (window, iframe, or a text block changing
//      height), give the viz rows the largest box that fits the space left over
//      by the controls, keeping the design's aspect ratio within FIT_SLACK, and
//      set --anim-graphic-scale so canvas text and strokes grow with the
//      graphic. The components redraw through their own ResizeObservers.
//
// SVG animations (MolecularAnim) scale through their viewBox and need no fit.

import { mount, flushSync } from 'svelte';
import '../app.css';
import './standalone.css';

// Border-box width of a handbook .anim-embed at desktop width: #content is
// max-width 900px with 56px side padding in app.css.
const HANDBOOK_EMBED_WIDTH = 788;
// The graphic may stretch this far from the handbook's aspect ratio (either
// way) before it is letterboxed, so a 16:9 slide is filled rather than
// pillarboxed for the sake of a few percent.
const FIT_SLACK = 1.2;
// Canvas text is 9.5 to 11 px at scale 1. Below 0.8 it stops being legible;
// above 2.5 a full-screen graphic's labels outgrow its own titles.
const SCALE_MIN = 0.8;
const SCALE_MAX = 2.5;

export function mountStandalone(Component, props) {
	const target = document.getElementById('anim-root');
	document.body.classList.add('anim-calibrating');
	target.style.width = `${HANDBOOK_EMBED_WIDTH}px`;
	mount(Component, { target, props });
	flushSync();

	const embed = target.querySelector('.anim-embed');
	if (!embed) {
		target.style.width = '';
		document.body.classList.replace('anim-calibrating', 'anim-standalone');
		return;
	}

	const rows = [...embed.children].filter((el) => el.classList.contains('viz-row'));
	const design = rows.map((row) => row.getBoundingClientRect());
	const canvases = [...embed.querySelectorAll('canvas')];
	const designCanvases = canvases.map((c) => [c.offsetWidth, c.offsetHeight]);
	target.style.width = '';
	document.body.classList.replace('anim-calibrating', 'anim-standalone');

	if (rows.length && !embed.querySelector('svg[viewBox]')) {
		fitRows(embed, rows, design, canvases, designCanvases);
	}

	if (new URLSearchParams(location.search).has('autoplay')) autoplay(embed);
}

function fitRows(embed, rows, design, canvases, designCanvases) {
	const designW = Math.max(...design.map((r) => r.width));
	const designHs = design.map((r) => r.height);
	const designH = designHs.reduce((a, b) => a + b, 0);
	if (!designW || !designH) return;
	const aspect = designW / designH;
	const others = [...embed.children].filter((el) => !rows.includes(el));

	for (const row of rows) row.classList.add('anim-fitted-row');

	function fit() {
		const cs = getComputedStyle(embed);
		const availW = embed.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
		let availH = embed.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
		for (const el of [...others, ...rows]) {
			const s = getComputedStyle(el);
			if (s.display === 'none' || s.position === 'absolute') continue;
			availH -= parseFloat(s.marginTop) + parseFloat(s.marginBottom);
			if (!rows.includes(el)) availH -= el.getBoundingClientRect().height;
		}
		availH = Math.max(0, availH);

		const w = Math.min(availW, availH * aspect * FIT_SLACK);
		const h = Math.min(availH, (w / aspect) * FIT_SLACK);
		rows.forEach((row, i) => {
			row.style.width = `${Math.floor(w)}px`;
			row.style.height = `${Math.floor((h * designHs[i]) / designH)}px`;
		});

		// The scale is the one at which every canvas still has at least its
		// handbook size in drawing units. Titles and padding inside the rows do
		// not scale, so the canvases grow or shrink a little faster than the
		// rows; scaling by the row width alone would crop axis labels in short
		// frames. Reading offsetWidth here lays out the rows set just above.
		let fitScale = w / designW;
		canvases.forEach((c, i) => {
			const [dw, dh] = designCanvases[i];
			if (dw > 0) fitScale = Math.min(fitScale, c.offsetWidth / dw);
			if (dh > 0) fitScale = Math.min(fitScale, c.offsetHeight / dh);
		});
		const scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, fitScale));
		embed.style.setProperty('--anim-graphic-scale', scale.toFixed(3));
	}

	fit();
	// Re-fit when the page box changes (window or iframe resize) or when a text
	// block above or below the graphic changes height (step captions rewrap).
	const ro = new ResizeObserver(fit);
	ro.observe(embed);
	for (const el of others) ro.observe(el);
}

// ?autoplay starts the animation once, as if the presenter pressed Play.
function autoplay(embed) {
	const play = [...embed.querySelectorAll('.controls .btn')].find((b) =>
		/play|auto/i.test(b.textContent ?? '')
	);
	play?.click();
}
