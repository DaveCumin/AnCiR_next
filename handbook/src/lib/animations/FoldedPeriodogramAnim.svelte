<script>
	// One fold, three summaries: Lomb-Scargle, chi-squared (Sokolove-Bushell)
	// and Enright, shown as different ways of summarising the SAME period-folded
	// cloud of points.
	//
	// cos(wt) and sin(wt) depend on t only through its phase at the trial period,
	// so the least-squares sinusoid fitted to the raw (t, y) series is the same
	// regression, with the same coefficients and residuals, as the sinusoid
	// fitted to the folded (phase, y) cloud. Lomb-Scargle therefore IS "fold,
	// then fit one cosine"; chi-squared and Enright are "fold, then average each
	// phase bin". The statistics come from $lib/foldStats.js, which follows the
	// app's definitions (src/lib/utils/periodogram.js).
	import { onMount } from 'svelte';
	import { C, setupCanvas, seededRNG, initPalette, observeResize } from '$lib/animUtils.js';
	import { cosineFit, binFold, makeRecord, phaseOf } from '$lib/foldStats.js';

	// Design height of the box (a min-height via --anim-h in app.css).
	let { height = '1000px' } = $props();

	/* ── data ─────────────────────────────────────────────────────────────── */
	const DAYS = 8;
	const TRUE_P = 24;
	const BIN = 1; // bin size (h), the sampling interval: one sample per bin per cycle
	const RECORD = makeRecord(seededRNG(7), { days: DAYS, period: TRUE_P });
	const SPAN = DAYS * 24;
	// Days taken out by "Remove a day", in order. Three keeps every trial period
	// in range well defined; beyond that the spectral window of the few days left
	// starts to dominate, which is a different lesson.
	const REMOVE_ORDER = [3, 6, 1];

	const PMIN = 10;
	const PMAX = 32;
	const STEP = 0.05;
	const GRID = Array.from(
		{ length: Math.round((PMAX - PMIN) / STEP) + 1 },
		(_, i) => Math.round((PMIN + i * STEP) * 100) / 100
	);
	const SWEEP_RATE = 2.4; // hours of trial period per second of play

	/* ── state ────────────────────────────────────────────────────────────── */
	let period = $state(TRUE_P);
	let playing = $state(false);
	let overlay = $state('both'); // 'cosine' | 'means' | 'both'
	let removed = $state(0);
	let bout = $state(false);
	// The part of the period axis the sweep (or the slider) has visited.
	let revLo = $state(null);
	let revHi = $state(null);

	let cRaw = $state();
	let cFold = $state();
	let cPgram = $state();

	const snap = (p) => Math.round(p / STEP) * STEP;
	const T = $derived(Math.round(snap(period) * 100) / 100);

	const gone = $derived(new Set(REMOVE_ORDER.slice(0, removed)));
	const data = $derived.by(() => {
		const ys = bout ? RECORD.bout : RECORD.sine;
		const t = [];
		const y = [];
		RECORD.t.forEach((x, i) => {
			if (!gone.has(Math.floor(x / 24))) {
				t.push(x);
				y.push(ys[i]);
			}
		});
		const yMax = Math.max(...ys) * 1.06;
		return { t, y, yMax };
	});

	const curves = $derived.by(() => {
		const { t, y } = data;
		const ls = [];
		const chi = [];
		const enr = [];
		for (const p of GRID) {
			ls.push(cosineFit(t, y, p).r2);
			const f = binFold(t, y, p, BIN);
			chi.push(f.eta2);
			enr.push(f.apShare);
		}
		return { ls, chi, enr };
	});

	const fit = $derived(cosineFit(data.t, data.y, T));
	const fold = $derived(binFold(data.t, data.y, T, BIN));
	const fullCount = $derived(Math.max(...fold.counts));

	/* ── drawing helpers ──────────────────────────────────────────────────── */
	const FONT = '10px Inter, system-ui, sans-serif';

	function frame(ctx, L, Tp, pw, ph) {
		ctx.strokeStyle = C.border;
		ctx.lineWidth = 1;
		ctx.strokeRect(L, Tp, pw, ph);
	}

	function xTicks(ctx, ticks, X, y0, fmt = (v) => String(v)) {
		ctx.fillStyle = C.muted;
		ctx.font = FONT;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		for (const v of ticks) {
			ctx.strokeStyle = C.axis;
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(X(v), y0);
			ctx.lineTo(X(v), y0 + 3);
			ctx.stroke();
			ctx.fillText(fmt(v), X(v), y0 + 5);
		}
	}

	function yTicks(ctx, ticks, Y, x0, fmt = (v) => String(v)) {
		ctx.fillStyle = C.muted;
		ctx.font = FONT;
		ctx.textAlign = 'right';
		ctx.textBaseline = 'middle';
		for (const v of ticks) ctx.fillText(fmt(v), x0 - 5, Y(v));
	}

	function axisLabels(ctx, L, Tp, pw, ph, xLabel, yLabel) {
		ctx.fillStyle = C.muted;
		ctx.font = FONT;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'alphabetic';
		ctx.fillText(xLabel, L + pw / 2, Tp + ph + 29);
		ctx.save();
		ctx.translate(11, Tp + ph / 2);
		ctx.rotate(-Math.PI / 2);
		ctx.fillText(yLabel, 0, 0);
		ctx.restore();
	}

	function hatch(ctx, x0, y0, w, h) {
		ctx.save();
		ctx.beginPath();
		ctx.rect(x0, y0, w, h);
		ctx.clip();
		ctx.fillStyle = C.surface;
		ctx.fillRect(x0, y0, w, h);
		ctx.strokeStyle = C.border;
		ctx.lineWidth = 1;
		for (let s = -h; s < w; s += 7) {
			ctx.beginPath();
			ctx.moveTo(x0 + s, y0 + h);
			ctx.lineTo(x0 + s + h, y0);
			ctx.stroke();
		}
		ctx.restore();
	}

	/* ── panel 1: raw record ──────────────────────────────────────────────── */
	function drawRaw() {
		if (!cRaw) return;
		const { ctx, W, H } = setupCanvas(cRaw);
		ctx.clearRect(0, 0, W, H);
		const L = 40,
			R = 10,
			Tp = 8,
			B = 34,
			pw = W - L - R,
			ph = H - Tp - B;
		if (pw < 20 || ph < 20) return;
		const X = (h) => L + (h / SPAN) * pw;
		const Y = (v) => Tp + ph - (v / data.yMax) * ph;
		ctx.fillStyle = C.bg;
		ctx.fillRect(L, Tp, pw, ph);

		// One band per trial cycle, alternating, so the trial period's chopping
		// of the record is visible.
		for (let k = 0; k * T < SPAN; k++) {
			const x0 = X(k * T);
			const x1 = X(Math.min((k + 1) * T, SPAN));
			if (k % 2 === 0) {
				ctx.fillStyle = 'rgba(0, 59, 113, 0.09)';
				ctx.fillRect(x0, Tp, x1 - x0, ph);
			}
			if (k > 0) {
				ctx.strokeStyle = 'rgba(0, 59, 113, 0.35)';
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(x0, Tp);
				ctx.lineTo(x0, Tp + ph);
				ctx.stroke();
			}
		}
		for (const d of gone) {
			hatch(ctx, X(d * 24), Tp, X(24) - X(0), ph);
			ctx.fillStyle = C.muted;
			ctx.font = FONT;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'top';
			ctx.fillText('removed', X(d * 24 + 12), Tp + 4);
		}

		ctx.strokeStyle = C.navy;
		ctx.lineWidth = 1.2;
		ctx.beginPath();
		let prev = null;
		data.t.forEach((x, i) => {
			const px = X(x),
				py = Y(data.y[i]);
			if (prev !== null && x - prev === 1) ctx.lineTo(px, py);
			else ctx.moveTo(px, py);
			prev = x;
		});
		ctx.stroke();

		frame(ctx, L, Tp, pw, ph);
		const step = pw < 360 ? 48 : 24;
		const ticks = [];
		for (let h = 0; h <= SPAN; h += step) ticks.push(h);
		xTicks(ctx, ticks, X, Tp + ph);
		yTicks(ctx, [0, Math.round(data.yMax / 2 / 10) * 10], Y, L);
		axisLabels(ctx, L, Tp, pw, ph, 'Time (h)', 'Activity');
	}

	/* ── panel 2: the folded cloud ────────────────────────────────────────── */
	function drawFold() {
		if (!cFold) return;
		const { ctx, W, H } = setupCanvas(cFold);
		ctx.clearRect(0, 0, W, H);
		const L = 40,
			R = 10,
			Tp = 8,
			B = 34,
			pw = W - L - R,
			ph = H - Tp - B;
		if (pw < 20 || ph < 20) return;
		const X = (h) => L + (h / T) * pw;
		const Y = (v) => Tp + ph - (v / data.yMax) * ph;
		ctx.fillStyle = C.bg;
		ctx.fillRect(L, Tp, pw, ph);

		// Phase-bin scaffold: a guide for every method, the data for two of them.
		// A thinned bin is tinted, an empty one hatched.
		for (let h = 0; h < fold.nBins; h++) {
			const x0 = X(h * fold.width);
			const x1 = X((h + 1) * fold.width);
			const c = fold.counts[h];
			if (c === 0) hatch(ctx, x0, Tp, x1 - x0, ph);
			else if (c < fullCount) {
				ctx.fillStyle = `rgba(230, 168, 23, ${(0.5 * (1 - c / fullCount)).toFixed(3)})`;
				ctx.fillRect(x0, Tp, x1 - x0, ph);
			}
			if (h > 0) {
				ctx.strokeStyle = C.grid;
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(x0, Tp);
				ctx.lineTo(x0, Tp + ph);
				ctx.stroke();
			}
		}

		// Grand mean.
		ctx.strokeStyle = C.axis;
		ctx.lineWidth = 1;
		ctx.setLineDash([4, 3]);
		ctx.beginPath();
		ctx.moveTo(L, Y(fold.grand));
		ctx.lineTo(L + pw, Y(fold.grand));
		ctx.stroke();
		ctx.setLineDash([]);

		// The points.
		ctx.fillStyle = 'rgba(75, 85, 99, 0.42)';
		data.t.forEach((x, i) => {
			ctx.beginPath();
			ctx.arc(X(phaseOf(x, T)), Y(data.y[i]), 2.1, 0, 2 * Math.PI);
			ctx.fill();
		});

		if (overlay !== 'cosine') {
			ctx.strokeStyle = C.gold;
			ctx.lineWidth = 2.6;
			ctx.lineCap = 'round';
			let last = null;
			for (let h = 0; h < fold.nBins; h++) {
				const m = fold.means[h];
				if (!Number.isFinite(m)) {
					last = null;
					continue;
				}
				const x0 = X(h * fold.width);
				const x1 = X((h + 1) * fold.width);
				ctx.beginPath();
				if (last !== null) ctx.moveTo(x0, Y(last));
				else ctx.moveTo(x0, Y(m));
				ctx.lineTo(x0, Y(m));
				ctx.lineTo(x1, Y(m));
				ctx.stroke();
				last = m;
			}
			ctx.lineCap = 'butt';
		}

		if (overlay !== 'means') {
			const w = (2 * Math.PI) / T;
			ctx.strokeStyle = C.navy;
			ctx.lineWidth = 2.6;
			ctx.beginPath();
			const nSeg = Math.max(60, Math.round(pw / 3));
			for (let s = 0; s <= nSeg; s++) {
				const ph_ = (s / nSeg) * T;
				const v = fit.mean + fit.a * Math.cos(w * ph_) + fit.b * Math.sin(w * ph_);
				const py = Math.min(Tp + ph, Math.max(Tp, Y(v)));
				s ? ctx.lineTo(X(ph_), py) : ctx.moveTo(X(ph_), py);
			}
			ctx.stroke();
		}

		frame(ctx, L, Tp, pw, ph);
		const step = T <= 16 ? 4 : 6;
		const ticks = [];
		for (let h = 0; h <= T + 1e-9; h += step) ticks.push(h);
		xTicks(ctx, ticks, X, Tp + ph);
		yTicks(ctx, [0, Math.round(data.yMax / 2 / 10) * 10], Y, L);
		axisLabels(ctx, L, Tp, pw, ph, 'Time within the trial cycle (h)', 'Activity');
	}

	/* ── panel 3: the periodogram ─────────────────────────────────────────── */
	function drawPgram() {
		if (!cPgram) return;
		const { ctx, W, H } = setupCanvas(cPgram);
		ctx.clearRect(0, 0, W, H);
		const L = 40,
			R = 12,
			Tp = 8,
			B = 34,
			pw = W - L - R,
			ph = H - Tp - B;
		if (pw < 20 || ph < 20) return;
		const X = (p) => L + ((p - PMIN) / (PMAX - PMIN)) * pw;
		const Y = (v) => Tp + ph - Math.max(0, Math.min(1, v)) * ph;
		ctx.fillStyle = C.bg;
		ctx.fillRect(L, Tp, pw, ph);
		ctx.strokeStyle = C.grid;
		ctx.lineWidth = 1;
		for (const v of [0.25, 0.5, 0.75]) {
			ctx.beginPath();
			ctx.moveTo(L, Y(v));
			ctx.lineTo(L + pw, Y(v));
			ctx.stroke();
		}

		// True period.
		ctx.strokeStyle = C.red;
		ctx.lineWidth = 1.2;
		ctx.setLineDash([5, 4]);
		ctx.beginPath();
		ctx.moveTo(X(TRUE_P), Tp);
		ctx.lineTo(X(TRUE_P), Tp + ph);
		ctx.stroke();
		ctx.setLineDash([]);

		const i0 = revLo === null ? -1 : GRID.indexOf(revLo);
		const i1 = revHi === null ? -1 : GRID.indexOf(revHi);
		const series = [
			{ ys: curves.chi, color: C.gold, width: 2.2, dash: [] },
			{ ys: curves.enr, color: C.green, width: 1.8, dash: [6, 4] },
			{ ys: curves.ls, color: C.navy, width: 2.2, dash: [] }
		];
		if (i0 >= 0 && i1 > i0) {
			for (const s of series) {
				ctx.strokeStyle = s.color;
				ctx.lineWidth = s.width;
				ctx.setLineDash(s.dash);
				ctx.beginPath();
				let open = false;
				for (let i = i0; i <= i1; i++) {
					const v = s.ys[i];
					if (!Number.isFinite(v)) {
						open = false;
						continue;
					}
					open ? ctx.lineTo(X(GRID[i]), Y(v)) : ctx.moveTo(X(GRID[i]), Y(v));
					open = true;
				}
				ctx.stroke();
			}
			ctx.setLineDash([]);
		}

		// Cursor at the current trial period, with each statistic marked on it.
		ctx.strokeStyle = C.text;
		ctx.globalAlpha = 0.55;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(X(T), Tp);
		ctx.lineTo(X(T), Tp + ph);
		ctx.stroke();
		ctx.globalAlpha = 1;
		if (!(i0 >= 0 && i1 > i0)) {
			const msg = 'Press Play to sweep the trial period';
			ctx.font = '11px Inter, system-ui, sans-serif';
			const tw = Math.min(pw - 12, ctx.measureText(msg).width + 16);
			ctx.fillStyle = C.surface;
			ctx.globalAlpha = 0.92;
			ctx.fillRect(L + pw / 2 - tw / 2, Tp + ph * 0.86 - 11, tw, 22);
			ctx.globalAlpha = 1;
			ctx.fillStyle = C.muted;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(msg, L + pw / 2, Tp + ph * 0.86, pw - 16);
		}

		// Statistic markers on the cursor, above the hint box.
		const j = GRID.indexOf(T);
		if (j >= 0) {
			for (const s of series) {
				const v = s.ys[j];
				if (!Number.isFinite(v)) continue;
				ctx.fillStyle = s.color;
				ctx.beginPath();
				ctx.arc(X(T), Y(v), 3.6, 0, 2 * Math.PI);
				ctx.fill();
			}
		}

		frame(ctx, L, Tp, pw, ph);
		const ticks =
			pw < 300 ? [12, 16, 20, 24, 28, 32] : [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32];
		xTicks(ctx, ticks, X, Tp + ph);
		yTicks(ctx, [0, 0.25, 0.5, 0.75, 1], Y, L, (v) => String(v));
		axisLabels(ctx, L, Tp, pw, ph, 'Trial period (h)', 'Share of variance');
	}

	function drawAll() {
		drawRaw();
		drawFold();
		drawPgram();
	}

	// Redraw whenever anything the panels read changes.
	$effect(() => {
		// Reading these registers them as dependencies of the drawing.
		void [T, overlay, data, curves, fit, fold, revLo, revHi, cRaw, cFold, cPgram];
		drawAll();
	});

	/* ── transport ────────────────────────────────────────────────────────── */
	let raf = null;
	let lastTs = null;

	function reveal(p) {
		const g = Math.round(snap(p) * 100) / 100;
		revLo = revLo === null ? g : Math.min(revLo, g);
		revHi = revHi === null ? g : Math.max(revHi, g);
	}

	function tick(ts) {
		if (!playing) return;
		if (lastTs === null) lastTs = ts;
		const dt = Math.min(0.1, (ts - lastTs) / 1000);
		lastTs = ts;
		period = Math.min(PMAX, period + dt * SWEEP_RATE);
		reveal(period);
		if (period >= PMAX) {
			playing = false;
			return;
		}
		raf = requestAnimationFrame(tick);
	}

	function togglePlay() {
		if (playing) {
			playing = false;
			cancelAnimationFrame(raf);
			return;
		}
		// A sweep starts at the short end unless one is part-way through.
		if (revLo === null || revHi === null || revLo > PMIN || period >= PMAX - STEP / 2) {
			period = PMIN;
			revLo = null;
			revHi = null;
			reveal(PMIN);
		}
		playing = true;
		lastTs = null;
		raf = requestAnimationFrame(tick);
	}

	function reset() {
		playing = false;
		cancelAnimationFrame(raf);
		period = TRUE_P;
		revLo = null;
		revHi = null;
	}

	function onSlide(e) {
		playing = false;
		cancelAnimationFrame(raf);
		period = +e.currentTarget.value;
		reveal(period);
	}

	onMount(() => {
		initPalette();
		drawAll();
		const stop = observeResize([cRaw, cFold, cPgram], drawAll);
		return () => {
			stop();
			cancelAnimationFrame(raf);
		};
	});

	const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
</script>

<div class="anim-embed" style:--anim-h={height}>
	<div class="fz-caption">
		<p>
			<strong>Fold, then summarise.</strong> Each band of the record is one trial cycle; folding
			stacks them on one axis. <strong class="ls">Lomb-Scargle</strong> fits one cosine to the
			folded
			<em>points</em> (the bins are only a guide for it). <strong class="chi">Chi-squared</strong>
			and <strong class="enr">Enright</strong> average each phase bin.
		</p>
		{#if bout}
			<p class="fz-now">
				Narrow bout: the bin means follow the shape, but one cosine cannot, so it explains less and
				Lomb-Scargle also peaks at 12 h (half the period), where a second cosine would catch the
				bout's sharp edges.
			</p>
		{:else if removed}
			<p class="fz-now">
				{removed === 1 ? 'One day' : `${removed} days`} removed: the cosine still fits the points that
				remain. The bins thin unevenly (tinted bins hold fewer points), so each bin mean is noisier and
				the bin-mean curves' floor rises.
			</p>
		{/if}
	</div>

	<div class="viz-row one-col fz-raw-row">
		<div class="chart-panel">
			<h3>Raw record, 8 days at 1 h: each band is one {T.toFixed(2)} h trial cycle</h3>
			<canvas bind:this={cRaw}></canvas>
		</div>
	</div>

	<div class="viz-row two-col fz-main-row">
		<div class="chart-panel">
			<h3>Folded at {T.toFixed(2)} h ({fold.nBins} phase bins)</h3>
			<canvas bind:this={cFold}></canvas>
		</div>
		<div class="chart-panel">
			<h3>Periodogram: share of variance</h3>
			<canvas bind:this={cPgram}></canvas>
		</div>
	</div>

	<div class="legend">
		<div class="legend-item"><span class="fz-dot"></span>Data points</div>
		<div class="legend-item">
			<div class="legend-swatch" style:background={C.navy}></div>
			Fitted cosine, Lomb-Scargle
		</div>
		<div class="legend-item">
			<div class="legend-swatch" style:background={C.gold}></div>
			Bin means, chi-squared
		</div>
		<div class="legend-item">
			<div class="legend-swatch fz-dash-green"></div>
			Enright (same bin means)
		</div>
		<div class="legend-item">
			<div class="legend-swatch fz-dash-red"></div>
			True period (24 h)
		</div>
	</div>

	<p class="fz-note">
		One scale for all three: Lomb-Scargle plots the cosine's R&sup2; (AnCiR's power is (N&minus;1)/2
		&times; R&sup2;), chi-squared Q<sub>p</sub>/N, and Enright A<sub>p</sub>&sup2; over the data's
		variance, which equals the chi-squared share when every bin holds the same number of points. Bin
		means get one free value per bin (a cosine gets two), so their curves sit higher, even on noise.
	</p>

	<div class="fz-readout" aria-live="polite">
		<span><span class="fz-lab">Trial period</span> {T.toFixed(2)} h</span>
		<span
			><span class="fz-lab ls">Lomb-Scargle</span> R&sup2; {fmt(fit.r2, 2)}, power {fmt(
				fit.power,
				1
			)}</span
		>
		<span
			><span class="fz-lab chi">Chi-squared</span> Q<sub>p</sub>
			{fmt(fold.qp, 1)}, df {fold.df}</span
		>
		<span><span class="fz-lab enr">Enright</span> A<sub>p</sub> {fmt(fold.ap, 1)}</span>
	</div>

	<div class="fz-controls">
		<div class="controls">
			<button class="btn" onclick={togglePlay}>{playing ? '⏸ Pause' : '▶ Play sweep'}</button>
			<button class="btn secondary" onclick={reset}>&#8634; Reset</button>
			<label class="fz-slider">
				<span>Trial period</span>
				<input
					type="range"
					min={PMIN}
					max={PMAX}
					step={STEP}
					value={period}
					oninput={onSlide}
					aria-label="Trial period in hours"
				/>
				<span class="fz-val">{T.toFixed(2)} h</span>
			</label>
		</div>
		<div class="controls fz-options">
			<div class="fz-seg" role="group" aria-label="Overlay on the folded cloud">
				{#each [['cosine', 'Cosine'], ['means', 'Bin means'], ['both', 'Both']] as [key, label] (key)}
					<button
						class="btn secondary"
						class:fz-on={overlay === key}
						aria-pressed={overlay === key}
						onclick={() => (overlay = key)}>{label}</button
					>
				{/each}
			</div>
			<button
				class="btn secondary"
				disabled={removed >= REMOVE_ORDER.length}
				onclick={() => (removed = Math.min(REMOVE_ORDER.length, removed + 1))}
				>Remove a day{removed ? ` (${removed} gone)` : ''}</button
			>
			{#if removed}
				<button class="btn secondary" onclick={() => (removed = 0)}>Restore days</button>
			{/if}
			<button
				class="btn secondary"
				class:fz-on={bout}
				aria-pressed={bout}
				onclick={() => (bout = !bout)}>Narrow activity bout</button
			>
		</div>
	</div>
</div>

<style>
	/* The raw record is a short strip; the folded cloud and the periodogram get
	   the height. */
	.fz-raw-row {
		flex-grow: 0.62;
	}
	/* In the handbook (not the standalone pages, which size the rows to the
	   window) the figures keep a working height when the text and controls
	   wrap, as they do on a phone. */
	:global(#content) .fz-raw-row canvas {
		min-height: 120px;
	}
	:global(#content) .fz-main-row canvas {
		min-height: 220px;
	}

	.fz-caption {
		background: var(--color-warning-bg, #fef9e7);
		border: 1px solid var(--color-warning, #e6a817);
		border-left: 4px solid var(--color-warning, #e6a817);
		border-radius: 5px;
		padding: 9px 14px;
		font-size: 0.83rem;
		line-height: 1.55;
		color: var(--text);
		margin-bottom: 8px;
		flex-shrink: 0;
	}
	.fz-caption p + p {
		margin-top: 4px;
	}
	.fz-caption strong {
		color: var(--navy);
	}
	.fz-now {
		font-style: italic;
	}
	.ls {
		color: var(--navy);
	}
	.chi {
		color: #9a6b00;
	}
	.enr {
		color: var(--color-success, #137333);
	}
	strong.chi {
		color: #9a6b00;
	}
	strong.enr {
		color: var(--color-success, #137333);
	}

	.fz-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: rgba(75, 85, 99, 0.55);
		flex-shrink: 0;
	}
	.legend :global(.legend-swatch.fz-dash-green) {
		background: none;
		border-top: 2px dashed var(--color-success, #137333);
		height: 0;
	}
	.legend :global(.legend-swatch.fz-dash-red) {
		background: none;
		border-top: 2px dashed var(--color-error, #c5221f);
		height: 0;
	}

	.fz-note {
		font-size: 0.74rem;
		line-height: 1.45;
		color: var(--muted);
		margin: 2px 2px 6px;
		flex-shrink: 0;
	}

	.fz-readout {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 18px;
		justify-content: center;
		font-size: 0.8rem;
		font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 5px;
		padding: 7px 12px;
		flex-shrink: 0;
	}
	.fz-readout > span {
		white-space: nowrap;
	}
	.fz-lab {
		font-family: var(--font-sans);
		font-weight: 600;
		color: var(--muted);
		margin-right: 3px;
	}

	.fz-slider {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1 1 220px;
		min-width: 0;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--muted);
		white-space: nowrap;
	}
	.fz-slider input {
		flex: 1;
		min-width: 80px;
		accent-color: var(--navy);
		cursor: pointer;
	}
	.fz-val {
		font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
		color: var(--navy);
		min-width: 4.6em;
		text-align: right;
	}

	/* The two control groups sit side by side when there is room (a wide
	   presentation window) and stack otherwise. */
	.fz-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0 8px;
		flex-shrink: 0;
	}
	.fz-controls > .controls {
		flex: 1 1 auto;
	}
	.fz-seg {
		display: inline-flex;
	}
	.fz-seg .btn {
		border-radius: 0;
		margin-left: -1px;
	}
	.fz-seg .btn:first-child {
		border-radius: 5px 0 0 5px;
		margin-left: 0;
	}
	.fz-seg .btn:last-child {
		border-radius: 0 5px 5px 0;
	}
	:global(.anim-embed) .btn.fz-on,
	:global(.anim-embed) .btn.fz-on:hover {
		background: var(--navy);
		border-color: var(--navy);
		color: #fff;
	}
	.btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
