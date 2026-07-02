<script>
	// @ts-nocheck
	// Visual layer for the guided tour: a highlight ring around the current
	// target (no heavy dimming, so popovers/modals the step spawns stay usable)
	// plus a tooltip card. Hands-on steps auto-advance when their predicate is
	// met; passive steps show a Next button. Mounted once (in +page).
	import { untrack } from 'svelte';
	import { tourState, nextStep, prevStep, stopTour, finishTour } from '$lib/core/tourRunner.svelte.js';

	const step = $derived(
		tourState.activeTour ? (tourState.activeTour.steps[tourState.index] ?? null) : null
	);
	const total = $derived(tourState.activeTour?.steps?.length ?? 0);
	const isLast = $derived(total > 0 && tourState.index === total - 1);

	// title/body may be plain strings OR functions of live app state, so the
	// tooltip updates as the user changes things (e.g. switching views).
	const titleText = $derived(typeof step?.title === 'function' ? step.title() : (step?.title ?? ''));
	const bodyHtml = $derived(typeof step?.body === 'function' ? step.body() : (step?.body ?? ''));

	let targetRect = $state(null); // {top,left,width,height} or null → centered
	let tooltipPos = $state({ left: 0, top: 0 });
	let tooltipEl = $state(null);
	let trackCleanup = [];

	// "Wire these ports" hint visuals (set from a step's `wire` descriptor): a ring
	// around each source/target port dot + an animated dashed edge between them.
	// Viewport coords, recomputed every reposition so they track pan/zoom.
	let wireRings = $state([]); // [{cx,cy}] port-dot centres
	let wireEdges = $state([]); // [{from:{x,y}, to:{x,y}}]

	// True while the canvas is actively panning/zooming — disables the position
	// glide so the ring/tooltip snap to the moving target instead of lagging.
	// Auto-clears ~160ms after the last canvas move, restoring the glide.
	let liveTracking = $state(false);
	let liveTrackTimer = 0;
	function markLiveTracking() {
		liveTracking = true;
		clearTimeout(liveTrackTimer);
		liveTrackTimer = setTimeout(() => {
			liveTracking = false;
		}, 160);
	}

	function resolveTarget(t) {
		if (!t) return null;
		try {
			return typeof t === 'function' ? t() : document.querySelector(t);
		} catch {
			return null;
		}
	}

	const GAP = 12;
	const MARGIN = 8;

	// Menus/popovers a hands-on step may ask the user to click into — the tooltip
	// must never cover these. (Native <dialog>s render in the top layer ABOVE the
	// tooltip, so they don't need avoiding.)
	const OBSTACLE_SELECTORS = '.add-data-menu, .np-menu, .palette-menu, .ws-palette, .help-menu';

	function rectBox(r) {
		return { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height };
	}
	function overlaps(a, b) {
		return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
	}
	function obstacleBoxes() {
		return [...document.querySelectorAll(OBSTACLE_SELECTORS)]
			.map((el) => el.getBoundingClientRect())
			.filter((r) => r.width > 0 && r.height > 0)
			.map(rectBox);
	}

	function clamp(left, top, ttW, ttH) {
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		return {
			left: Math.max(MARGIN, Math.min(left, vw - ttW - MARGIN)),
			top: Math.max(MARGIN, Math.min(top, vh - ttH - MARGIN))
		};
	}

	// Candidate tooltip position for a placement relative to the target rect.
	function placeAdjacent(rect, place, ttW, ttH) {
		let left, top;
		if (place === 'bottom') {
			top = rect.top + rect.height + GAP;
			left = rect.left + rect.width / 2 - ttW / 2;
		} else if (place === 'top') {
			top = rect.top - GAP - ttH;
			left = rect.left + rect.width / 2 - ttW / 2;
		} else if (place === 'right') {
			left = rect.left + rect.width + GAP;
			top = rect.top + rect.height / 2 - ttH / 2;
		} else {
			left = rect.left - GAP - ttW;
			top = rect.top + rect.height / 2 - ttH / 2;
		}
		return clamp(left, top, ttW, ttH);
	}

	// Safe screen anchors used when no adjacent placement is clear of obstacles.
	function placeScreen(anchor, ttW, ttH) {
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		if (anchor === 'screen-bottom') return { left: (vw - ttW) / 2, top: vh - ttH - 16 };
		if (anchor === 'screen-top') return { left: (vw - ttW) / 2, top: 16 };
		if (anchor === 'screen-left') return { left: 16, top: (vh - ttH) / 2 };
		if (anchor === 'screen-right') return { left: vw - ttW - 16, top: (vh - ttH) / 2 };
		return { left: (vw - ttW) / 2, top: (vh - ttH) / 2 }; // center
	}

	// Pick a tooltip position that covers neither the target nor any open
	// popover. Try the step's preferred side, then the other sides, then a few
	// safe screen anchors; fall back to the preferred side if nothing is clear.
	function pickTooltipPos(rect, s, ttW, ttH) {
		if (!rect) {
			const sp = s?.placement;
			const anchor = typeof sp === 'string' && sp.startsWith('screen') ? sp : 'center';
			return placeScreen(anchor, ttW, ttH);
		}
		const targetBox = rectBox(rect);
		const obstacles = obstacleBoxes();
		const clearOf = (pos) => {
			const box = { left: pos.left, top: pos.top, right: pos.left + ttW, bottom: pos.top + ttH };
			if (overlaps(box, targetBox)) return false;
			return !obstacles.some((o) => overlaps(box, o));
		};
		const hint = s?.placement && s.placement !== 'auto' ? s.placement : null;
		const order = [...new Set([hint, 'bottom', 'top', 'right', 'left'].filter(Boolean))];
		let fallback = null;
		for (const p of order) {
			const pos = placeAdjacent(rect, p, ttW, ttH);
			if (!fallback) fallback = pos;
			if (clearOf(pos)) return pos;
		}
		for (const a of ['screen-bottom', 'screen-top', 'screen-left', 'screen-right', 'center']) {
			const pos = placeScreen(a, ttW, ttH);
			if (clearOf(pos)) return pos;
		}
		return fallback ?? placeScreen('center', ttW, ttH);
	}

	function sameRect(a, b) {
		if (!a || !b) return a === b;
		return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
	}

	const elCenter = (el) => {
		const r = el.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	};

	// Cubic bezier between two viewport points (mirrors WorkflowEdges' wire shape).
	function wirePath(a, b) {
		const dx = Math.max(30, Math.abs(b.x - a.x) / 2);
		return `M ${a.x},${a.y} C ${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
	}

	// Resolve a step's `wire` descriptor into port-dot centres (to ring) + edges
	// (to animate). `from` is a single source dot; `to` is one dot or an array.
	function updateWire(s) {
		const w = s?.wire;
		if (!w) {
			if (wireRings.length) wireRings = [];
			if (wireEdges.length) wireEdges = [];
			return;
		}
		let fromEl = null;
		let toEls = [];
		try {
			fromEl = typeof w.from === 'function' ? w.from() : null;
			const t = typeof w.to === 'function' ? w.to() : null;
			toEls = (Array.isArray(t) ? t : [t]).filter(Boolean);
		} catch {
			fromEl = null;
			toEls = [];
		}
		const rings = [];
		const edges = [];
		const fromPt = fromEl ? elCenter(fromEl) : null;
		if (fromPt) rings.push({ cx: fromPt.x, cy: fromPt.y });
		for (const te of toEls) {
			const toPt = elCenter(te);
			rings.push({ cx: toPt.x, cy: toPt.y });
			if (fromPt) edges.push({ from: fromPt, to: toPt });
		}
		wireRings = rings;
		wireEdges = edges;
	}

	function updateRect(s) {
		const el = resolveTarget(s?.target);
		let next = null;
		if (el) {
			const r = el.getBoundingClientRect();
			next = { top: r.top, left: r.left, width: r.width, height: r.height };
		}
		if (!sameRect(next, targetRect)) targetRect = next;
		const ttW = tooltipEl?.offsetWidth || 320;
		const ttH = tooltipEl?.offsetHeight || 160;
		tooltipPos = pickTooltipPos(next, s, ttW, ttH);
		updateWire(s);
	}

	function clearTrack() {
		for (const fn of trackCleanup) fn();
		trackCleanup = [];
	}

	// Position the spotlight without a continuous rAF loop (which would peg the
	// renderer). Recompute now, on the next frame, after panel/view transitions
	// settle, and on resize/scroll. The tour's targets are fixed chrome (navbar,
	// + button, prompt), so they don't move once settled.
	function track(s) {
		clearTrack();
		const onChange = () => updateRect(s);
		// All pending timeouts for THIS step, so a step change cancels every one of
		// them. Critical: pointerup fires before the "Next" click, so without this
		// the pointerup-scheduled repositions stay bound to the OLD step and fire
		// ~60ms into the next step's glide, yanking the tooltip back (the "starts
		// twice" jump).
		const timers = new Set();
		const schedule = (ms) => {
			const id = setTimeout(() => {
				timers.delete(id);
				onChange();
			}, ms);
			timers.add(id);
		};
		// Targets inside the canvas move when the user pans/zooms, which changes the
		// .canvas-inner inline transform — that fires neither scroll nor resize. A
		// MutationObserver on that transform is the TRIGGER; the actual following is
		// a short rAF loop that runs only while the canvas is moving (plus a ~160ms
		// tail so the FINAL settled frame is captured — a single coalesced update
		// lands a frame stale and never corrects). The loop self-stops when idle, so
		// there's no perpetual rAF. During the loop we SNAP (glide disabled) so the
		// ring doesn't rubber-band behind the moving target.
		let followRaf = 0;
		const followLoop = () => {
			onChange();
			if (liveTracking) {
				followRaf = requestAnimationFrame(followLoop);
			} else {
				followRaf = 0;
				onChange(); // one last update after the glide is re-enabled
			}
		};
		const onCanvasMove = () => {
			markLiveTracking();
			if (!followRaf) followRaf = requestAnimationFrame(followLoop);
		};
		const observed = new Set();
		const observers = [];
		const attachCanvasObservers = () => {
			for (const el of document.querySelectorAll('.canvas-inner')) {
				if (observed.has(el)) continue;
				observed.add(el);
				const mo = new MutationObserver(onCanvasMove);
				mo.observe(el, { attributes: true, attributeFilter: ['style'] });
				observers.push(mo);
			}
		};

		onChange();
		const raf = requestAnimationFrame(() => {
			onChange();
			attachCanvasObservers();
		});
		attachCanvasObservers();
		schedule(360);
		schedule(720);
		schedule(1500);
		// View switches (beforeShow) mount .canvas-inner a tick late; re-attach once
		// the switch settles so live tracking works on the first canvas step too.
		const reattachTimer = setTimeout(attachCanvasObservers, 420);
		// A click usually opens/closes a menu the step points into; re-position
		// shortly after so the tooltip dodges the freshly-opened popover.
		const onPointerUp = () => {
			schedule(60);
			schedule(220);
		};
		// Canvas zoom (ctrl/⌘+wheel) and wheel-pan are instant, so recompute right
		// after the wheel — this reliably keeps the port rings + demo edges glued to
		// the moving dots (the MutationObserver loop alone can leave them a step
		// stale during rapid zoom). A trailing tick catches the settled frame.
		const onWheel = () => {
			markLiveTracking();
			onChange();
			schedule(40);
		};
		window.addEventListener('resize', onChange);
		window.addEventListener('scroll', onChange, true);
		window.addEventListener('pointerup', onPointerUp, true);
		window.addEventListener('wheel', onWheel, { passive: true, capture: true });
		trackCleanup.push(() => {
			cancelAnimationFrame(raf);
			cancelAnimationFrame(followRaf);
			clearTimeout(reattachTimer);
			clearTimeout(liveTrackTimer);
			liveTracking = false;
			observers.forEach((o) => o.disconnect());
			timers.forEach(clearTimeout);
			timers.clear();
			window.removeEventListener('resize', onChange);
			window.removeEventListener('scroll', onChange, true);
			window.removeEventListener('pointerup', onPointerUp, true);
			window.removeEventListener('wheel', onWheel, true);
		});
	}

	// On step change: run beforeShow once, then (re)position. The whole body is
	// untracked so this effect depends ONLY on tourState.index — track()/updateRect
	// both read AND write targetRect, which would otherwise self-invalidate the
	// effect into an infinite flush loop.
	$effect(() => {
		tourState.index; // sole dependency — re-run on step change
		untrack(() => {
			const s = step;
			clearTrack();
			targetRect = null;
			if (!s) return;
			try {
				s.beforeShow?.();
			} catch (e) {
				console.warn('[tour] beforeShow failed', e);
			}
			track(s);
		});
		return clearTrack;
	});

	// Hands-on advancement: re-evaluates whenever the predicate's reactive deps change.
	$effect(() => {
		const s = step;
		if (!s?.advance?.when) return;
		let ok = false;
		try {
			ok = !!s.advance.when();
		} catch {
			ok = false;
		}
		if (ok) untrack(() => nextStep());
	});

	// Event-based advancement (advance on a DOM event on a target).
	$effect(() => {
		const s = step;
		if (!s?.advance?.event) return;
		const sel = s.advance.target ?? s.target;
		const el = typeof sel === 'function' ? sel() : sel ? document.querySelector(sel) : null;
		if (!el) return;
		const handler = () => untrack(() => nextStep());
		el.addEventListener(s.advance.event, handler, { once: true });
		return () => el.removeEventListener(s.advance.event, handler);
	});

	function onKey(e) {
		if (!tourState.activeTour) return;
		if (e.key === 'Escape') {
			e.stopPropagation();
			stopTour();
		}
	}

	const showNext = $derived(step?.advance?.on === 'next');

	// Fade the tooltip in when a tour opens, and only enable the position-glide
	// transition AFTER the first placement — otherwise the card would slide in
	// from the top-left corner (its 0,0 default) on the very first step. Once
	// `shown` is true it stays true for the whole tour, so step-to-step moves glide.
	let shown = $state(false);
	$effect(() => {
		if (!tourState.activeTour) {
			shown = false;
			return;
		}
		let raf1 = 0;
		let raf2 = 0;
		raf1 = requestAnimationFrame(() => {
			raf2 = requestAnimationFrame(() => {
				shown = true;
			});
		});
		return () => {
			cancelAnimationFrame(raf1);
			cancelAnimationFrame(raf2);
		};
	});
</script>

<svelte:window onkeydown={onKey} />

{#if step}
	{#if targetRect}
		<!-- The ring element persists across steps so it glides to each new target.
		     Only the pulse overlay is keyed, so the attention pulse replays per step
		     without recreating (and re-popping) the ring itself. -->
		<div
			class="tour-ring"
			class:tracking={liveTracking}
			style="top:{targetRect.top - 6}px; left:{targetRect.left - 6}px; width:{targetRect.width +
				12}px; height:{targetRect.height + 12}px;"
		>
			{#key tourState.index}
				<span class="tour-ring-pulse"></span>
			{/key}
		</div>
	{:else if step.dim !== false}
		<div class="tour-backdrop"></div>
	{/if}

	{#if wireRings.length || wireEdges.length}
		<svg class="tour-wire-layer" aria-hidden="true">
			{#each wireEdges as e, i (`e_${i}`)}
				<path
					class="tour-wire"
					d={wirePath(e.from, e.to)}
					marker-end="url(#tour-wire-arrow)"
				/>
			{/each}
			{#each wireRings as r, i (`pr_${i}`)}
				<circle class="tour-wire-ring" cx={r.cx} cy={r.cy} r="11" />
			{/each}
			<defs>
				<marker
					id="tour-wire-arrow"
					viewBox="0 0 10 10"
					refX="8"
					refY="5"
					markerWidth="7"
					markerHeight="7"
					orient="auto-start-reverse"
				>
					<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-accent)" />
				</marker>
			</defs>
		</svg>
	{/if}

	<div
		class="tour-tooltip"
		class:shown
		class:tracking={liveTracking}
		bind:this={tooltipEl}
		style="transform: translate3d({tooltipPos.left}px, {tooltipPos.top}px, 0);"
		role="dialog"
		aria-label="Guided tour"
	>
		<div class="tour-progress">
			<span>{tourState.activeTour?.name}</span>
			<span>Step {tourState.index + 1} of {total}</span>
		</div>
		<h3 class="tour-title">{titleText}</h3>
		<!-- title/body are static, developer-authored copy from src/lib/tours/*.js
		     (never user input), so @html is safe and lets steps use <strong> etc. -->
		<p class="tour-body">{@html bodyHtml}</p>
		<div class="tour-actions">
			<button
				class="tour-btn tour-skip"
				type="button"
				data-testid="tour-skip"
				onclick={stopTour}
			>
				{isLast ? 'Close' : 'Skip'}
			</button>
			<span class="tour-spacer"></span>
			{#if tourState.index > 0}
				<button class="tour-btn" type="button" data-testid="tour-back" onclick={prevStep}>Back</button
				>
			{/if}
			{#if showNext}
				<button
					class="tour-btn tour-primary"
					type="button"
					data-testid="tour-next"
					onclick={nextStep}
				>
					{isLast ? 'Done' : 'Next'}
				</button>
			{:else}
				<span class="tour-hint">↑ do this to continue</span>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* The big dim is a STATIC 9999px box-shadow — its SPREAD is never animated
	   (animating a full-screen-spread shadow repaints the whole screen each frame
	   and janks). Position (top/left/width/height) does transition so the spotlight
	   glides between targets; the attention pulse lives on the cheap pulse child. */
	.tour-ring {
		position: fixed;
		z-index: 100000;
		border-radius: var(--radius-lg);
		pointer-events: none;
		box-shadow:
			0 0 0 3px var(--color-accent),
			0 0 0 9999px rgba(0, 0, 0, 0.28);
		transition:
			top 0.32s cubic-bezier(0.22, 0.61, 0.36, 1),
			left 0.32s cubic-bezier(0.22, 0.61, 0.36, 1),
			width 0.32s cubic-bezier(0.22, 0.61, 0.36, 1),
			height 0.32s cubic-bezier(0.22, 0.61, 0.36, 1);
	}

	/* Small accent ring that pulses a few times when a step appears. It's a keyed
	   child so the pulse replays per step while the ring itself persists and
	   glides. Animates only a ≤8px shadow → negligible paint cost. */
	.tour-ring-pulse {
		position: absolute;
		inset: -3px;
		border-radius: 10px;
		pointer-events: none;
		animation: tour-pulse 1.4s ease-in-out 3;
	}

	@keyframes tour-pulse {
		0% {
			box-shadow: 0 0 0 0 rgba(77, 159, 227, 0.45);
		}
		100% {
			box-shadow: 0 0 0 8px rgba(77, 159, 227, 0);
		}
	}

	.tour-backdrop {
		position: fixed;
		inset: 0;
		z-index: 100000;
		background: rgba(0, 0, 0, 0.32);
		pointer-events: none;
	}

	/* "Wire these ports" demo layer: rings on the source/target dots + an animated
	   dashed edge between them. Full-screen, click-through (the user wires the real
	   dots underneath). */
	.tour-wire-layer {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		z-index: 100000;
		pointer-events: none;
		overflow: visible;
	}
	.tour-wire {
		fill: none;
		stroke: var(--color-accent);
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-dasharray: 7 6;
		animation: tour-wire-flow 0.6s linear infinite;
	}
	@keyframes tour-wire-flow {
		to {
			stroke-dashoffset: -13;
		}
	}
	.tour-wire-ring {
		fill: none;
		stroke: var(--color-accent);
		stroke-width: 2.5;
		animation: tour-wire-pulse 1.4s ease-in-out infinite;
	}
	@keyframes tour-wire-pulse {
		0%,
		100% {
			opacity: 0.55;
			r: 10;
		}
		50% {
			opacity: 1;
			r: 13;
		}
	}

	.tour-tooltip {
		position: fixed;
		left: 0;
		top: 0;
		z-index: 100001;
		width: 320px;
		max-width: calc(100vw - 16px);
		box-sizing: border-box;
		background: var(--surface-card);
		border-radius: 10px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
		padding: 0.85rem var(--space-6) var(--space-5);
		pointer-events: auto;
		font-size: var(--font-lg);
		color: var(--color-lightness-20, #2a2a2a);
		/* Positioned via translate3d (GPU-composited). Until the card has been
		   shown once it stays invisible with NO transform transition, so the
		   first placement snaps to the right spot instead of sliding in from 0,0. */
		opacity: 0;
		transition: opacity 0.2s ease;
		will-change: transform, opacity;
	}

	.tour-tooltip.shown {
		opacity: 1;
		transition:
			transform 0.32s cubic-bezier(0.22, 0.61, 0.36, 1),
			opacity 0.2s ease;
	}

	/* While the canvas is actively panning/zooming, snap to the moving target
	   instead of gliding (the glide would visibly trail behind). Selectors are
	   specific enough to beat .tour-tooltip.shown. */
	.tour-ring.tracking {
		transition: none;
	}
	.tour-tooltip.tracking,
	.tour-tooltip.shown.tracking {
		transition: opacity 0.2s ease;
	}

	.tour-progress {
		display: flex;
		justify-content: space-between;
		font-size: var(--font-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted, #666);
		margin-bottom: 0.35rem;
	}

	.tour-title {
		margin: 0 0 0.35rem 0;
		font-size: 1rem;
	}

	.tour-body {
		margin: 0 0 var(--space-5) 0;
		font-size: var(--font-body);
		line-height: 1.5;
		color: var(--color-lightness-30, #444);
	}

	.tour-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.tour-spacer {
		flex: 1 1 auto;
	}

	.tour-btn {
		font: inherit;
		font-size: var(--font-md);
		padding: 0.35rem 0.7rem;
		border: 1px solid var(--color-lightness-85, #ddd);
		border-radius: var(--radius-md);
		background: var(--surface-card);
		cursor: pointer;
	}

	.tour-btn:hover {
		background: var(--color-lightness-95, #f4f4f4);
	}

	.tour-primary {
		border-color: var(--color-accent);
		background: var(--color-accent);
		color: #fff;
	}

	.tour-primary:hover {
		filter: brightness(0.96);
		background: var(--color-accent);
	}

	.tour-skip {
		border-color: transparent;
		color: var(--color-text-muted, #666);
		padding-left: 0;
	}
	.tour-skip:hover {
		background: transparent;
		color: var(--color-lightness-25, #333);
	}

	.tour-hint {
		font-size: var(--font-sm);
		color: var(--color-accent);
		font-weight: 600;
	}

	/* Optional "Tip: …" line emitted by wiringHint() in @html body content.
	   @html isn't style-scoped, so target it globally. */
	:global(.tour-body .tour-tip) {
		display: inline-block;
		margin-top: 0.4rem;
		font-size: var(--font-sm);
		color: var(--color-text-muted, #666);
	}

	/* Honour users who prefer reduced motion: snap instead of glide/pulse. */
	@media (prefers-reduced-motion: reduce) {
		.tour-ring,
		.tour-tooltip,
		.tour-tooltip.shown {
			transition: opacity 0.2s ease;
		}
		.tour-ring-pulse {
			animation: none;
		}
	}
</style>
