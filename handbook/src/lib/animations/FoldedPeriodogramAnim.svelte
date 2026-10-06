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
	import {
		C,
		setupCanvas,
		seededRNG,
		initPalette,
		observeResize,
		seekBar
	} from '$lib/animUtils.js';
	import {
		cosineFit,
		binFold,
		makeRecord,
		medianSpacing,
		periodGrid,
		phaseOf
	} from '$lib/foldStats.js';

	// Design height of the box (a min-height via --anim-h in app.css).
	let { height = '1000px' } = $props();

	/* ── data ─────────────────────────────────────────────────────────────── */
	const DAYS = 8;
	const TRUE_P = 24;
	const RECORD = makeRecord(seededRNG(7), { days: DAYS, period: TRUE_P });
	const SPAN = DAYS * 24;
	// The sampling interval, read from the data. It is the bin size (one sample
	// per bin per cycle) and the step of the trial period: the binned methods
	// fold at a whole number of bins, so these are the periods they can test.
	const DT = medianSpacing(RECORD.t);
	const BIN = DT;

	const PMIN = 10;
	const PMAX = 32;
	const GRID = periodGrid(PMIN, PMAX, DT);
	const LAST = GRID.length - 1;
	const I_TRUE = GRID.findIndex((p) => Math.abs(p - TRUE_P) < 1e-9);
	const SWEEP_RATE = 2.4; // hours of trial period per second of play, at speed 1
	const dtLabel = `${+DT.toFixed(3)} h`;
	const fmtP = (p) => `${+p.toFixed(3)} h`;

	/* ── state ────────────────────────────────────────────────────────────── */
	let idx = $state(I_TRUE); // index into GRID of the current trial period
	let playing = $state(false);
	let overlay = $state('both'); // 'cosine' | 'means' | 'both'
	let bout = $state(false);
	// The span of GRID indices the sweep (or the slider) has visited.
	let revLo = $state(null);
	let revHi = $state(null);

	let cRaw = $state();
	let cFold = $state();
	let cPgram = $state();

	const T = $derived(GRID[idx]);

	const data = $derived.by(() => {
		const y = bout ? RECORD.bout : RECORD.sine;
		return { t: RECORD.t, y, yMax: Math.max(...y) * 1.06 };
	});

	// Every statistic at every trial period on the grid, computed once per shape.
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

		ctx.strokeStyle = C.navy;
		ctx.lineWidth = 1.2;
		ctx.beginPath();
		data.t.forEach((x, i) => {
			const px = X(x),
				py = Y(data.y[i]);
			i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
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
		ctx.strokeStyle = C.grid;
		ctx.lineWidth = 1;
		for (let h = 1; h < fold.nBins; h++) {
			const x0 = X(h * fold.width);
			ctx.beginPath();
			ctx.moveTo(x0, Tp);
			ctx.lineTo(x0, Tp + ph);
			ctx.stroke();
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

		// The overlays stay inside the plot frame (round caps would poke out).
		ctx.save();
		ctx.beginPath();
		ctx.rect(L, Tp, pw, ph);
		ctx.clip();
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
		ctx.restore();

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

		// One point per trial period on the grid, joined by lines: the statistics
		// exist only at these periods.
		const series = [
			{ ys: curves.chi, color: C.gold, width: 2, dash: [], r: 3.4 },
			{ ys: curves.enr, color: C.green, width: 1.6, dash: [5, 4], r: 2 },
			{ ys: curves.ls, color: C.navy, width: 2, dash: [], r: 2.6 }
		];
		const swept = revLo !== null && revHi > revLo;
		if (swept) {
			for (const s of series) {
				ctx.strokeStyle = s.color;
				ctx.lineWidth = s.width;
				ctx.setLineDash(s.dash);
				ctx.beginPath();
				let open = false;
				for (let i = revLo; i <= revHi; i++) {
					const v = s.ys[i];
					if (!Number.isFinite(v)) {
						open = false;
						continue;
					}
					open ? ctx.lineTo(X(GRID[i]), Y(v)) : ctx.moveTo(X(GRID[i]), Y(v));
					open = true;
				}
				ctx.stroke();
				ctx.setLineDash([]);
				ctx.fillStyle = s.color;
				for (let i = revLo; i <= revHi; i++) {
					const v = s.ys[i];
					if (!Number.isFinite(v)) continue;
					ctx.beginPath();
					ctx.arc(X(GRID[i]), Y(v), s.r, 0, 2 * Math.PI);
					ctx.fill();
				}
			}
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
		if (!swept) {
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

		// Statistic markers on the cursor, above the hint box, ringed so they
		// stand out from the swept points.
		for (const s of series) {
			const v = s.ys[idx];
			if (!Number.isFinite(v)) continue;
			ctx.fillStyle = s.color;
			ctx.strokeStyle = C.surface;
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(X(T), Y(v), 4.2, 0, 2 * Math.PI);
			ctx.fill();
			ctx.stroke();
		}

		frame(ctx, L, Tp, pw, ph);
		const ticks =
			pw < 300 ? [12, 16, 20, 24, 28, 32] : [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32];
		xTicks(ctx, ticks, X, Tp + ph);
		yTicks(ctx, [0, 0.25, 0.5, 0.75, 1], Y, L, (v) => String(v));
		axisLabels(ctx, L, Tp, pw, ph, `Trial period (h), in steps of ${dtLabel}`, 'Share of variance');
	}

	function drawAll() {
		drawRaw();
		drawFold();
		drawPgram();
	}

	// Redraw whenever anything the panels read changes.
	$effect(() => {
		// Reading these registers them as dependencies of the drawing.
		void [idx, overlay, data, curves, fit, fold, revLo, revHi, cRaw, cFold, cPgram];
		drawAll();
	});

	/* ── transport ────────────────────────────────────────────────────────── */
	// The sweep steps through GRID one sampling interval at a time; `speed` is
	// the shared Speed slider's multiplier (0.2 to 4, as the other animations).
	let raf = null;
	let lastTs = null;
	let accum = 0;
	let speed = 1;

	function reveal(i) {
		revLo = revLo === null ? i : Math.min(revLo, i);
		revHi = revHi === null ? i : Math.max(revHi, i);
	}

	function stop() {
		playing = false;
		cancelAnimationFrame(raf);
	}

	function tick(ts) {
		if (!playing) return;
		if (lastTs === null) lastTs = ts;
		const dt = Math.min(0.1, (ts - lastTs) / 1000);
		lastTs = ts;
		accum += (dt * speed * SWEEP_RATE) / DT;
		const steps = Math.floor(accum);
		accum -= steps;
		if (steps) {
			idx = Math.min(LAST, idx + steps);
			reveal(idx);
		}
		if (idx >= LAST) {
			playing = false;
			return;
		}
		raf = requestAnimationFrame(tick);
	}

	function togglePlay() {
		if (playing) {
			stop();
			return;
		}
		// A sweep starts at the short end unless one is part-way through.
		if (revLo !== 0 || revHi !== idx || idx >= LAST) {
			idx = 0;
			revLo = null;
			revHi = null;
			reveal(0);
		}
		playing = true;
		lastTs = null;
		accum = 0;
		raf = requestAnimationFrame(tick);
	}

	function reset() {
		stop();
		idx = I_TRUE;
		revLo = null;
		revHi = null;
		accum = 0;
	}

	// The progress bar is the sweep's timeline: seeking puts the sweep at that
	// point, with every trial period before it already drawn.
	function seek(p) {
		idx = Math.round(p * LAST);
		revLo = 0;
		revHi = idx;
		lastTs = null;
		accum = 0;
	}

	function onSlide(e) {
		stop();
		idx = +e.currentTarget.value;
		reveal(idx);
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

	// How far the sweep has run from the short end (the seek bar's fill).
	const progress = $derived(revLo === 0 && revHi !== null ? revHi / LAST : 0);

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
		{/if}
	</div>

	<div class="viz-row one-col fz-raw-row">
		<div class="chart-panel">
			<h3>Raw record, 8 days at {dtLabel}: each band is one {fmtP(T)} trial cycle</h3>
			<canvas bind:this={cRaw}></canvas>
		</div>
	</div>

	<div class="viz-row two-col fz-main-row">
		<div class="chart-panel">
			<h3>Folded at {fmtP(T)} ({fold.nBins} phase bins of {dtLabel})</h3>
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
		The trial period steps by the sampling interval ({dtLabel}), so every fold is a whole number of
		bins and each point is the value AnCiR reports at that period.
	</p>

	<div class="fz-readout" aria-live="polite">
		<span><span class="fz-lab">Trial period</span> {fmtP(T)} ({fold.nBins} bins)</span>
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
			<button class="btn" onclick={togglePlay}>{playing ? '⏸ Pause' : '▶ Play'}</button>
			<button class="btn secondary" onclick={reset}>&#8634; Reset</button>
			<div class="progress-wrap" use:seekBar={{ onseek: seek, label: 'Sweep progress' }}>
				<div class="progress-fill" style:width={progress * 100 + '%'}></div>
			</div>
			<div class="speed-wrap">
				<span>Speed</span>
				<input
					type="range"
					min="0.2"
					max="4"
					step="0.1"
					value="1"
					oninput={(e) => {
						speed = +e.target.value;
					}}
				/>
			</div>
		</div>
		<div class="controls fz-options">
			<label class="fz-slider">
				<span>Trial period</span>
				<input
					type="range"
					min="0"
					max={LAST}
					step="1"
					value={idx}
					oninput={onSlide}
					aria-label="Trial period"
					aria-valuetext={fmtP(T)}
				/>
				<span class="fz-val">{fmtP(T)}</span>
			</label>
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
		min-width: 3.2em;
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
</style>
