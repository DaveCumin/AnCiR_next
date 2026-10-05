/* ═══════════════════════════════════════════════════════════════════
   animUtils.js — Canvas utilities for Svelte animation components
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Shared colour palette. Hardcoded values match app.css :root variables
 * and serve as fallbacks before initPalette() is called.
 * Call initPalette() in onMount to read live values from global CSS.
 */
export const C = {
	navy: '#003b71',
	navyDk: '#002a52',
	blue: '#4a90d9',
	blueLt: '#eaf2fb',
	gold: '#e6a817',
	goldLt: '#fef9e7',
	green: '#137333',
	greenLt: '#e6f4ea',
	red: '#c5221f',
	purple: '#7c3aed',
	bg: '#f0f4fa',
	surface: '#ffffff',
	text: '#1a202c',
	muted: '#6b7280',
	border: '#dde3ee',
	grid: '#e5e8f0',
	axis: '#9ca3af',
	data1: '#04050A',
	data2: '#be796b80'
};

/**
 * Read all animation palette colours from the document's computed CSS custom
 * properties (defined in app.css :root). Call once in each component's
 * onMount so canvas drawings always reflect the global stylesheet.
 */
export function initPalette() {
	const s = getComputedStyle(document.documentElement);
	const v = (name) => s.getPropertyValue(name).trim();
	C.navy = v('--navy') || C.navy;
	C.navyDk = v('--navy-dk') || C.navyDk;
	C.blue = v('--color-info') || C.blue;
	C.blueLt = v('--color-info-bg') || C.blueLt;
	C.gold = v('--color-warning') || C.gold;
	C.goldLt = v('--color-warning-bg') || C.goldLt;
	C.green = v('--color-success') || C.green;
	C.greenLt = v('--color-success-bg') || C.greenLt;
	C.red = v('--color-error') || C.red;
	C.bg = v('--panel-bg') || C.bg;
	C.surface = v('--surface') || C.surface;
	C.text = v('--text') || C.text;
	C.muted = v('--muted') || C.muted;
	C.border = v('--border') || C.border;
	C.grid = v('--grid') || C.grid;
	C.axis = v('--axis') || C.axis;
	C.data1 = v('--data1') || C.data1;
	C.data2 = v('--data2') || C.data2;
}

/**
 * Per-canvas drawing scale. The handbook always draws at 1 (one drawing unit is
 * one CSS pixel). The standalone presentation pages set the CSS custom property
 * --anim-graphic-scale on the animation root so that labels, line widths and
 * paddings grow with the graphic instead of staying at handbook size on a
 * 1920-wide slide. setupCanvas() reads it; canvasSize() reports the canvas in
 * drawing units so the draw code never needs to know the scale.
 */
const graphicScales = new WeakMap();

function readGraphicScale(canvas) {
	const raw = getComputedStyle(canvas).getPropertyValue('--anim-graphic-scale');
	const k = parseFloat(raw);
	return Number.isFinite(k) && k > 0 ? k : 1;
}

/**
 * Size a canvas's backing store to its CSS box at device-pixel resolution and
 * set the context transform so draw code works in drawing units.
 * Returns the context and the canvas size in drawing units.
 */
export function setupCanvas(canvas) {
	const d = window.devicePixelRatio || 1;
	const k = readGraphicScale(canvas);
	graphicScales.set(canvas, k);
	const cssW = canvas.offsetWidth || 400;
	const cssH = canvas.offsetHeight || 200;
	canvas.width = Math.round(cssW * d);
	canvas.height = Math.round(cssH * d);
	const ctx = canvas.getContext('2d');
	ctx.setTransform(d * k, 0, 0, d * k, 0, 0);
	return { ctx, W: cssW / k, H: cssH / k };
}

/** The canvas's current size in drawing units (CSS pixels divided by the scale). */
export function canvasSize(canvas) {
	const k = graphicScales.get(canvas) ?? 1;
	return { W: canvas.offsetWidth / k, H: canvas.offsetHeight / k };
}

/**
 * Call `callback` whenever any of `elements` changes size, or the device pixel
 * ratio changes (window dragged to another screen, browser zoom). A
 * ResizeObserver catches what a window 'resize' listener misses: a sidebar
 * toggling, or an embedding page resizing the iframe the animation lives in.
 * Returns a function that stops observing.
 */
export function observeResize(elements, callback) {
	const targets = elements.filter(Boolean);
	const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => callback());
	for (const el of targets) ro?.observe(el);

	let dprQuery = null;
	const onDprChange = () => {
		watchDpr();
		callback();
	};
	function watchDpr() {
		dprQuery?.removeEventListener('change', onDprChange);
		dprQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null;
		dprQuery?.addEventListener('change', onDprChange);
	}
	watchDpr();

	return () => {
		ro?.disconnect();
		dprQuery?.removeEventListener('change', onDprChange);
	};
}

export function lerp(a, b, t) {
	return a + (b - a) * t;
}

export function seededRNG(seed) {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(1664525, s) + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

export function drawAxes(ctx, padL, padT, plotW, plotH, xLabel, yLabel) {
	ctx.strokeStyle = C.axis;
	ctx.lineWidth = 1.2;
	ctx.beginPath();
	ctx.moveTo(padL, padT);
	ctx.lineTo(padL, padT + plotH);
	ctx.lineTo(padL + plotW, padT + plotH);
	ctx.stroke();

	ctx.fillStyle = C.muted;
	ctx.font = '10px Inter,sans-serif';

	if (xLabel) {
		ctx.textAlign = 'center';
		ctx.fillText(xLabel, padL + plotW / 2, padT + plotH + 28);
	}
	if (yLabel) {
		ctx.save();
		ctx.translate(13, padT + plotH / 2);
		ctx.rotate(-Math.PI / 2);
		ctx.textAlign = 'center';
		ctx.fillText(yLabel, 0, 0);
		ctx.restore();
	}
}

export function drawHGrid(ctx, padL, padT, plotW, plotH, rows) {
	ctx.strokeStyle = C.grid;
	ctx.lineWidth = 0.7;
	for (let r = 0; r <= rows; r++) {
		const y = padT + (r / rows) * plotH;
		ctx.beginPath();
		ctx.moveTo(padL, y);
		ctx.lineTo(padL + plotW, y);
		ctx.stroke();
	}
}

/**
 * Svelte action for an animation's click-to-seek progress bar (`.progress-wrap` holding a
 * `.progress-fill`). Makes the bar an ARIA slider that the keyboard can drive:
 *
 *   click            seek to the clicked fraction of the bar
 *   Right / Up       forward 5%        Left / Down   back 5%
 *   Page Up / Down   forward / back 25%
 *   Home / End       start / end
 *
 * `onseek(p)` receives the target as a fraction in [0, 1]; the animation applies it as a
 * click always did (its own frame rounding included). The animation keeps writing the fill
 * width imperatively; the action reads that width back into aria-valuenow, so a screen
 * reader hears the real position whether it came from playback, a click or a key.
 *
 * Usage: <div class="progress-wrap" use:seekBar={{ onseek: seek }}><div class="progress-fill" ...>
 * Optional `label` (default 'Animation progress').
 */
export function seekBar(node, params) {
	let { onseek, label = 'Animation progress' } = params ?? {};
	const fill = node.querySelector('.progress-fill');
	const clamp01 = (v) => Math.max(0, Math.min(1, v));
	const current = () => clamp01((parseFloat(fill?.style.width) || 0) / 100);

	node.setAttribute('role', 'slider');
	node.setAttribute('tabindex', '0');
	node.setAttribute('aria-label', label);
	node.setAttribute('aria-valuemin', '0');
	node.setAttribute('aria-valuemax', '100');

	function sync() {
		const pct = Math.round(current() * 100);
		node.setAttribute('aria-valuenow', String(pct));
		node.setAttribute('aria-valuetext', `${pct}%`);
	}
	sync();
	const mo = fill && typeof MutationObserver !== 'undefined' ? new MutationObserver(sync) : null;
	mo?.observe(fill, { attributes: true, attributeFilter: ['style'] });

	function onClick(e) {
		const rect = node.getBoundingClientRect();
		if (!(rect.width > 0)) return;
		onseek?.(clamp01((e.clientX - rect.left) / rect.width));
	}
	const KEY_STEPS = {
		ArrowRight: 0.05,
		ArrowUp: 0.05,
		ArrowLeft: -0.05,
		ArrowDown: -0.05,
		PageUp: 0.25,
		PageDown: -0.25
	};
	function onKeydown(e) {
		let target;
		if (e.key === 'Home') target = 0;
		else if (e.key === 'End') target = 1;
		else if (e.key in KEY_STEPS) target = current() + KEY_STEPS[e.key];
		else return;
		e.preventDefault();
		onseek?.(clamp01(target));
	}
	node.addEventListener('click', onClick);
	node.addEventListener('keydown', onKeydown);

	return {
		update(next) {
			({ onseek, label = 'Animation progress' } = next ?? {});
			node.setAttribute('aria-label', label);
		},
		destroy() {
			mo?.disconnect();
			node.removeEventListener('click', onClick);
			node.removeEventListener('keydown', onKeydown);
		}
	};
}
