<script>
  import { onMount } from "svelte";
  import { C, setupCanvas, initPalette } from "$lib/animUtils.js";

  let { height = "560px" } = $props();

  // ── Morlet wavelet ────────────────────────────────────────────────────────
  // psi(x) = pi^-1/4 e^{i w0 x} e^{-x^2/2}.  For w0 = 6 the Fourier period that
  // a scale s responds to is FOURIER * s with FOURIER = 4*pi/(w0 + sqrt(2+w0^2))
  // ~= 1.033, so scale and period are near enough interchangeable here.
  const W0 = 6;
  const FOURIER = (4 * Math.PI) / (W0 + Math.sqrt(2 + W0 * W0));
  // Cone of influence: the wavelet's e-folding time is sqrt(2)*s, which in
  // period units is sqrt(2)/FOURIER = 1.369 periods in from each edge.
  const COI = Math.SQRT2 / FOURIER;

  const DT = 1;            // 1 h sampling
  const N = 240;           // 10 days
  const SWITCH = N / 2;    // the period changes at day 5
  const P1 = 24, P2 = 21;

  // ── signal: period changes half way, phase kept continuous ────────────────
  const sig = (() => {
    const out = [];
    let ph = 0;
    for (let i = 0; i < N; i++) {
      ph += (2 * Math.PI * DT) / (i < SWITCH ? P1 : P2);
      out.push(Math.cos(ph));
    }
    const m = out.reduce((a, b) => a + b, 0) / N;
    return out.map((v) => v - m);
  })();

  // ── periods probed, and the precomputed scalogram ─────────────────────────
  const PERIODS = [];
  for (let p = 15; p <= 33; p += 0.5) PERIODS.push(p);
  const NROW = PERIODS.length;

  function cwtRow(period) {
    const scale = period / FOURIER;
    const norm = Math.pow(Math.PI, -0.25) / Math.sqrt(scale);
    const half = Math.ceil((4 * Math.SQRT2 * scale) / DT);
    const out = new Float64Array(N);
    for (let b = 0; b < N; b++) {
      let re = 0, im = 0;
      for (let k = -half; k <= half; k++) {
        const a = b + k;
        if (a < 0 || a >= N) continue;
        const x = (k * DT) / scale;
        const env = norm * Math.exp(-0.5 * x * x);
        re += sig[a] * env * Math.cos(W0 * x);
        im -= sig[a] * env * Math.sin(W0 * x);
      }
      out[b] = (re * re + im * im) * DT;
    }
    return out;
  }

  const SCAL = PERIODS.map(cwtRow);
  const PMAX = Math.max(...SCAL.map((r) => Math.max(...r)));

  // ── animation state ───────────────────────────────────────────────────────
  // frame counts rows revealed; within the current row a probe sweeps in time.
  const STEPS_PER_ROW = 24;
  const TOTAL = NROW * STEPS_PER_ROW;
  let frame = 0, playing = false, raf = null, lastTime = null, accum = 0, speed = 1;
  let cSig, cScal, btnPlay, progFill, progWrap, stepInd;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function resize() {
    if (cSig) setupCanvas(cSig);
    if (cScal) setupCanvas(cScal);
    draw(frame);
  }

  // power -> colour (sequential: pale panel -> accent -> deep navy)
  function heat(v) {
    const t = clamp(Math.sqrt(v / PMAX), 0, 1); // sqrt keeps low power visible
    const stops = [
      [247, 248, 250],
      [186, 214, 238],
      [ 77, 159, 227],
      [ 31,  58,  95],
    ];
    const x = t * (stops.length - 1);
    const i = Math.min(Math.floor(x), stops.length - 2);
    const f = x - i;
    const a = stops[i], b = stops[i + 1];
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(
      a[1] + (b[1] - a[1]) * f
    )},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
  }

  function draw(f) {
    const rowsDone = clamp(Math.floor(f / STEPS_PER_ROW), 0, NROW);
    const within = (f % STEPS_PER_ROW) / STEPS_PER_ROW;
    const curRow = clamp(rowsDone, 0, NROW - 1);
    const probeT = Math.floor(within * N);
    const curPeriod = PERIODS[curRow];

    drawSignal(curPeriod, probeT, f >= TOTAL);
    drawScalogram(rowsDone, within, curRow, f >= TOTAL);

    if (progFill) progFill.style.width = (f / TOTAL) * 100 + "%";
    if (stepInd) {
      stepInd.textContent =
        f >= TOTAL
          ? "Scalogram complete"
          : `Probing period ${curPeriod.toFixed(1)} h`;
    }
  }

  // ── top panel: the signal and the wavelet currently probing it ────────────
  function drawSignal(period, probeT, done) {
    if (!cSig) return;
    const ctx = cSig.getContext("2d");
    const W = cSig.offsetWidth, H = cSig.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const L = 46, R = 14, T = 16, B = 26;
    const pw = W - L - R, ph = H - T - B;
    const X = (i) => L + (i / (N - 1)) * pw;
    const Y = (v) => T + ph / 2 - v * (ph / 2) * 0.86;
    const F = "Inter,system-ui,sans-serif";

    ctx.fillStyle = C.bg; ctx.fillRect(L, T, pw, ph);

    // mark where the period actually changes
    ctx.setLineDash([4, 3]); ctx.strokeStyle = C.red; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(X(SWITCH), T); ctx.lineTo(X(SWITCH), T + ph); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.red; ctx.font = "10px " + F; ctx.textAlign = "center";
    ctx.fillText(`period changes: ${P1} h → ${P2} h`, X(SWITCH), T - 4);

    // signal
    ctx.strokeStyle = C.data1; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < N; i++) { const x = X(i), y = Y(sig[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();

    // the wavelet, drawn at its current scale and position
    if (!done) {
      const scale = period / FOURIER;
      const half = 3 * Math.SQRT2 * scale;
      ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.beginPath();
      let started = false;
      for (let u = probeT - half; u <= probeT + half; u += 0.5) {
        if (u < 0 || u > N - 1) continue;
        const x = (u - probeT) / scale;
        const v = Math.exp(-0.5 * x * x) * Math.cos(W0 * x);
        const px = X(u), py = Y(v * 0.95);
        started ? ctx.lineTo(px, py) : (ctx.moveTo(px, py), (started = true));
      }
      ctx.stroke();
      // its envelope, to make the "width = the period being probed" point
      ctx.strokeStyle = C.gold + "66"; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
      for (const s of [1, -1]) {
        ctx.beginPath(); started = false;
        for (let u = probeT - half; u <= probeT + half; u += 0.5) {
          if (u < 0 || u > N - 1) continue;
          const x = (u - probeT) / scale;
          const v = s * Math.exp(-0.5 * x * x);
          const px = X(u), py = Y(v * 0.95);
          started ? ctx.lineTo(px, py) : (ctx.moveTo(px, py), (started = true));
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.strokeRect(L, T, pw, ph);
    ctx.fillStyle = C.muted; ctx.font = "10px " + F; ctx.textAlign = "center";
    for (let d = 0; d <= 10; d += 2) ctx.fillText("d" + d, X(d * 24), T + ph + 15);
  }

  // ── bottom panel: the scalogram, filling in as the wavelet sweeps ─────────
  function drawScalogram(rowsDone, within, curRow, done) {
    if (!cScal) return;
    const ctx = cScal.getContext("2d");
    const W = cScal.offsetWidth, H = cScal.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const L = 46, R = 14, T = 12, B = 34;
    const pw = W - L - R, ph = H - T - B;
    const F = "Inter,system-ui,sans-serif";
    const X = (i) => L + (i / (N - 1)) * pw;
    // period increases upward
    const Yp = (p) => T + ph - ((p - PERIODS[0]) / (PERIODS[NROW - 1] - PERIODS[0])) * ph;

    ctx.fillStyle = C.surface; ctx.fillRect(L, T, pw, ph);

    const cw = pw / N + 0.6;
    const rh = ph / NROW + 0.6;
    for (let r = 0; r < NROW; r++) {
      if (r > rowsDone) continue;
      const upto = r === rowsDone && !done ? Math.floor(within * N) : N - 1;
      const yTop = Yp(PERIODS[r]) - rh / 2;
      for (let b = 0; b <= upto; b++) {
        ctx.fillStyle = heat(SCAL[r][b]);
        ctx.fillRect(X(b) - cw / 2, yTop, cw, rh);
      }
    }

    // Cone of influence. Hatch the two wedges where the wavelet overruns the
    // record edge, so nothing inside them reads as interpretable signal.
    const wedge = (side) => {
      ctx.beginPath();
      for (let p = PERIODS[0]; p <= PERIODS[NROW - 1]; p += 0.5) {
        const x = side === "L" ? X(COI * p) : X(N - 1 - COI * p);
        const y = Yp(p);
        p === PERIODS[0] ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      const xEnd = side === "L" ? L : L + pw;
      ctx.lineTo(xEnd, Yp(PERIODS[NROW - 1]));
      ctx.lineTo(xEnd, Yp(PERIODS[0]));
      ctx.closePath();
    };

    for (const side of ["L", "R"]) {
      ctx.save();
      wedge(side); ctx.clip();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(L, T, pw, ph);
      ctx.strokeStyle = "rgba(0,0,0,0.20)"; ctx.lineWidth = 1;
      for (let k = -ph; k < pw + ph; k += 7) {
        ctx.beginPath(); ctx.moveTo(L + k, T); ctx.lineTo(L + k - ph, T + ph); ctx.stroke();
      }
      ctx.restore();
    }

    // COI boundary
    ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
    for (const side of ["L", "R"]) {
      ctx.beginPath();
      for (let p = PERIODS[0]; p <= PERIODS[NROW - 1]; p += 0.5) {
        const x = side === "L" ? X(COI * p) : X(N - 1 - COI * p);
        const y = Yp(p);
        p === PERIODS[0] ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // true period, for comparison with the ridge
    if (done) {
      ctx.strokeStyle = C.red; ctx.lineWidth = 1.6; ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(X(0), Yp(P1)); ctx.lineTo(X(SWITCH), Yp(P1));
      ctx.moveTo(X(SWITCH), Yp(P2)); ctx.lineTo(X(N - 1), Yp(P2));
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.red; ctx.font = "10px " + F; ctx.textAlign = "left";
      ctx.fillText("true period", X(4), Yp(P1) - 5);
    }

    // current probe row
    if (!done) {
      ctx.strokeStyle = C.gold; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(L, Yp(PERIODS[curRow])); ctx.lineTo(L + pw, Yp(PERIODS[curRow])); ctx.stroke();
    }

    ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.strokeRect(L, T, pw, ph);

    // axes
    ctx.fillStyle = C.muted; ctx.font = "10px " + F;
    ctx.textAlign = "right";
    for (const p of [16, 20, 24, 28, 32]) ctx.fillText(p + " h", L - 6, Yp(p) + 3);
    ctx.textAlign = "center";
    for (let d = 0; d <= 10; d += 2) ctx.fillText("day " + d, X(d * 24), T + ph + 16);
    ctx.save(); ctx.translate(13, T + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center"; ctx.fillText("period", 0, 0); ctx.restore();
    ctx.textAlign = "center"; ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.font = "9px " + F;
    ctx.fillText("hatched = cone of influence (do not interpret)", L + pw / 2, T + ph + 30);
  }

  function loop(ts) {
    if (!playing) return;
    if (lastTime === null) lastTime = ts;
    const dt = ts - lastTime; lastTime = ts;
    accum += dt * speed * 0.05;
    const steps = Math.floor(accum); accum -= steps;
    frame = Math.min(frame + steps, TOTAL);
    draw(frame);
    if (frame >= TOTAL) { playing = false; btnPlay.textContent = "▶ Play"; return; }
    raf = requestAnimationFrame(loop);
  }
  function toggle() {
    if (frame >= TOTAL) reset();
    playing = !playing;
    btnPlay.textContent = playing ? "⏸ Pause" : "▶ Play";
    if (playing) { lastTime = null; raf = requestAnimationFrame(loop); } else cancelAnimationFrame(raf);
  }
  function reset() {
    playing = false; cancelAnimationFrame(raf);
    frame = 0; lastTime = null; accum = 0;
    btnPlay.textContent = "▶ Play"; draw(0);
  }
  function seek(e) {
    const r = progWrap.getBoundingClientRect();
    frame = Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * TOTAL);
    draw(frame);
  }

  onMount(() => {
    initPalette(); resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); cancelAnimationFrame(raf); };
  });
</script>

<div class="anim-embed" style={height ? `height: ${height}` : undefined}>
  <div class="viz-row one-col">
    <div class="chart-panel">
      <h3>The signal, and the wavelet probing it</h3>
      <canvas bind:this={cSig}></canvas>
    </div>
  </div>
  <div class="viz-row one-col">
    <div class="chart-panel">
      <h3>Scalogram: power at each period, at each time</h3>
      <canvas bind:this={cScal}></canvas>
    </div>
  </div>

  <div class="legend">
    <div class="legend-item"><div class="legend-swatch" style="background: var(--data1)"></div>Signal</div>
    <div class="legend-item"><div class="legend-swatch" style="background: var(--gold)"></div>Morlet wavelet (current scale)</div>
    <div class="legend-item"><div class="legend-swatch" style="background: var(--navy)"></div>High power</div>
    <div class="legend-item"><div class="legend-swatch" style="background: var(--red)"></div>True period</div>
  </div>

  <div class="controls">
    <button class="btn" bind:this={btnPlay} onclick={toggle}>&#9654; Play</button>
    <button class="btn secondary" onclick={reset}>&#8634; Reset</button>
    <div class="progress-wrap" bind:this={progWrap} onclick={seek}>
      <div class="progress-fill" bind:this={progFill}></div>
    </div>
    <div class="speed-wrap">
      <span>Speed</span>
      <input type="range" min="0.2" max="4" step="0.1" value="1" oninput={(e) => { speed = +e.target.value; }} />
    </div>
    <div class="step-indicator" bind:this={stepInd}>Ready</div>
  </div>
</div>
